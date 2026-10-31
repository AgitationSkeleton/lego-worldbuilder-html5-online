// A player for generated missions (src/online/puzzle.js): plays a mission's own solution in
// the game, through the game's own handlers (a unit's menuclick and mapclick, as its action
// buttons and a click on the map call them; the map's tilePosclick for a push; the plan
// icon's doBuild; a building's menuclick; gotoPos), and checks each step did what it should
// and that the goal and the bonus goal are reached.  Each step that acts beside something
// names the tile its unit stands on: the unit is driven there first.
//
// The same player in two places: tools/verify/puzzles.py's runs (tools/verify/bot.js), in the
// test mode's virtual time, the frames stepped as fast as they go; and Screensaver Mode
// (src/online/screensaver.js), at the game's own speed, to watch.  How time goes is the
// caller's:
//   tick(n)       waits n frames of the game (stepping them, in the test mode)
//   start(code)   starts the mission, answering what went wrong or null (by default from a
//                 world map, as the game's own start; the Screensaver's as the panel's Play)
//   focus(unit)   the unit acting now (the Screensaver's camera follows it)
//   stopped()     true to give up at once (the Screensaver closed)
//   stopAfter     a step to stop after, the units left to onStop (a test's)
//   keepLog       the steps' log kept when the mission is won, too
// Answers {ok, why, log, errors}.

import * as L from '../director/lingo.js';

export async function autoplay(rt, ui, code, opts = {}) {
  const tick = async (n) => {
    if (opts.stopped && opts.stopped()) throw STOPPED;
    await opts.tick(n);
  };
  const log = [];
  const fail = (why) => ({ ok: false, why, log: log.slice(-40), errors: rt.errors.slice(0, 3) });
  try {
    return await play();
  } catch (e) {
    if (e === STOPPED) return { ok: false, stopped: true, why: 'stopped', log, errors: [] };
    throw e;
  }

  async function play() {
    rt.errors.length = 0;
    let problem;
    if (opts.start) problem = opts.start(code);
    else {
      if (!/^world \d$/.test(rt.labelAt(rt.frame) || '')) { rt.go('world 1'); await tick(2); }
      problem = ui.random.play(code);
    }
    if (problem) return fail(problem);
    await tick(10);
    if (!ui.random.active) return fail('the mission did not start');
    const p = ui.random.active.puzzle;
    const glob = rt.globals.glob;
    const md = L.gp(glob, 'map_display');
    const P = ([x, y]) => L.list([x + 1, y + 1]);      // the game counts tiles from 1
    const tile = (at) => L.mc(md, 'gettileat', P(at));
    const terrain = (at) => L.gp(tile(at), 'terrain').key;
    const posOf = (u) => { const t = L.gp(u, 'ptile'); return t ? L.gp(t, 'pos').a.map((v) => v - 1).join(',') : 'nowhere (gone)'; };
    const focus = (u) => { if (opts.focus && u) opts.focus(u); };
    // (the units, buildings and monsters the steps name; a monster in a pen of more than a
    // tile wanders, so only those named are looked for)
    const units = {};
    const named = new Set(p.solution.concat(p.bonus).flatMap((s) => [s.unit, s.target]).filter(Boolean));
    const kindOf = {};
    p.pieces.forEach((piece, i) => { kindOf[Object.keys(p.units)[i]] = piece.kind; });
    for (const [name, at] of Object.entries(p.units)) {
      if (!named.has(name)) continue;
      units[name] = L.gp(tile(at), 'occupant');
      if (!units[name] && /^m/.test(name)) {
        // (a monster that roams a pen of its own may have moved off already: the nearest of
        // its kind)
        let best = null, bd = 1e9;
        const size = L.gp(md, 'pmapsize').a;
        for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
          const o = L.gp(tile([x, y]), 'occupant');
          const k = L.gp(o, 'pclass') && L.gp(o, 'pclass').a[1];
          if (!k || String(k.key !== undefined ? k.key : k).toLowerCase() !== kindOf[name]) continue;
          const d = Math.abs(x - at[0]) + Math.abs(y - at[1]);
          if (d < bd) { bd = d; best = o; }
        }
        units[name] = best;
      }
      if (!units[name]) return fail('nothing on the map for ' + name + ' at ' + at);
    }
    // until the unit has stopped and done what it was sent to do
    const idle = async (u, max = 6000) => {
      for (let i = 0; i < max; i++) {
        if (L.gp(u, 'ppath') === undefined && L.gp(u, 'pcheckdestination') === undefined && L.gp(u, 'pmovepixeltime') === undefined && L.gp(u, 'ppushwaiting') === undefined) { await tick(2); return true; }
        await tick(1);
      }
      return false;
    };
    const until = async (test, max = 1500) => {
      for (let i = 0; i < max; i++) { if (test()) return true; await tick(1); }
      return false;
    };
    const cargo = (u) => { const c = L.gp(u, 'pcargo'); const b = c && L.gp(c, 'bricks'); return b ? b.v.reduce((a, n) => a + (typeof n === 'number' ? n : 0), 0) : 0; };
    const energy = (u) => (L.gp(u, 'ptile') ? L.mc(u, 'energystatus') : 'none');
    const where = (u) => ' (at ' + posOf(u) + ', energy ' + energy(u) + ')';
    // (a plan picked up from the map names its unit with a string, the game's own with a symbol)
    const name = (v) => String(v && v.key !== undefined ? v.key : v).toLowerCase();
    const drive = async (u, to) => {
      if (posOf(u) === to.join()) return null;
      focus(u);
      L.mc(u, 'gotopos', P(to));
      if (!(await idle(u))) return 'never got there' + where(u);
      if (posOf(u) !== to.join()) return 'stopped short' + where(u);
      return null;
    };
    // (a plan's icon on the plans bar, landed: a plan just fetched flies there first)
    const planIcon = (what) => {
      for (let c = 1; c < 200; c++) {
        const sp = rt.sprites[c];
        if (!sp) continue;
        for (const inst of sp.scriptInstances) {
          const cls = inst.$ && inst.$.pclass;
          if (inst.script.name === 'build plan icon behavior' && cls && cls.a && name(cls.a[1]) === what && !inst.$.pswoop) return inst;
        }
      }
      return null;
    };
    const steps = p.solution.map((s) => [s, 'goal']).concat(p.bonus.map((s) => [s, 'bonus']));
    let n = 0;
    for (const [s, part] of steps) {
      n++;
      // (a test may stop the player after a step, its units left to it)
      if (opts.stopAfter && n > opts.stopAfter) { if (opts.onStop) opts.onStop(units); return { ok: true, stopped: n - 1, log }; }
      const what = part + ' step ' + n + ' ' + JSON.stringify(s);
      const u = s.unit !== undefined ? units[s.unit] : null;
      if (s.unit !== undefined && !u) return fail('no unit ' + s.unit + ' for ' + what);
      focus(u);
      switch (s.op) {
        case 'go': {
          const why = await drive(u, s.to);
          if (why) return fail(why + ': ' + what);
          break;
        }
        case 'whirl': {
          L.mc(u, 'gotopos', P(s.at));
          if (!(await idle(u))) return fail('never got there' + where(u) + ': ' + what);
          if (posOf(u) !== s.out.join()) return fail('came out elsewhere' + where(u) + ': ' + what);
          break;
        }
        case 'pick': case 'drop': case 'dig': case 'fill': case 'uproot': case 'plant': {
          const why = await drive(u, s.stand);
          if (why) return fail(why + ': ' + what);
          const before = s.op === 'pick' || s.op === 'drop' ? cargo(u) : terrain(s.at);
          L.mc(u, 'menuclick', L.sym(s.op));
          L.mc(u, 'mapclick', L.sym('mouseDown'), P(s.at));
          if (!(await idle(u))) return fail('never did it' + where(u) + ': ' + what);
          if (posOf(u) !== s.stand.join()) return fail('moved off' + where(u) + ': ' + what);
          if (s.op === 'pick' && !cargo(u)) return fail('picked nothing' + where(u) + ': ' + what);
          if (s.op === 'drop' && cargo(u)) return fail('dropped nothing' + where(u) + ': ' + what);
          if (s.op !== 'pick' && s.op !== 'drop' && terrain(s.at) === before) return fail(s.op + ' changed nothing (' + before + ')' + where(u) + ': ' + what);
          break;
        }
        case 'regate': {
          // take up the tree between a monster's den and the yellow ground, back off a tile and
          // plant it where the treebot stood
          let why = await drive(u, s.stand);
          if (why) return fail(why + ': ' + what);
          L.mc(u, 'menuclick', L.sym('uproot'));
          L.mc(u, 'mapclick', L.sym('mouseDown'), P(s.at));
          if (!(await idle(u))) return fail('never took it up' + where(u) + ': ' + what);
          if (!cargo(u)) return fail('took nothing up' + where(u) + ': ' + what);
          why = await drive(u, s.back);
          if (why) return fail(why + ' (backing off): ' + what);
          L.mc(u, 'menuclick', L.sym('plant'));
          L.mc(u, 'mapclick', L.sym('mouseDown'), P(s.stand));
          if (!(await idle(u))) return fail('never planted it' + where(u) + ': ' + what);
          if (!/^tree/.test(terrain(s.stand))) return fail('the way back is not shut (' + terrain(s.stand) + ')' + where(u) + ': ' + what);
          break;
        }
        case 'wander': {
          // a monster left to wander onto the yellow ground: the goal (or the bonus) is waited for
          const goals = () => { const gs = L.gp(glob, 'goals'); const l = gs && L.gp(gs, part); return l && l.a ? l.a.length : -1; };
          const before = goals();
          if (!(await until(() => goals() < before || goals() === 0, 20000))) return fail('the monster never came onto the yellow ground (at ' + posOf(u) + '): ' + what);
          break;
        }
        case 'push': {
          const why = await drive(u, s.stand);
          if (why) return fail(why + ': ' + what);
          const thing = L.gp(tile(s.at), 'occupant') || L.gp(tile(s.at), 'resource');
          if (!thing) return fail('nothing to push: ' + what);
          L.mc(u, 'menuclick', L.sym('push'));
          L.mc(md, 'tileposclick', L.sym('mouseDown'), P(s.at));
          if (!(await idle(u))) return fail('never pushed' + where(u) + ': ' + what);
          const beyond = [2 * s.at[0] - s.stand[0], 2 * s.at[1] - s.stand[1]];
          const there = L.gp(tile(beyond), 'occupant') || L.gp(tile(beyond), 'resource');
          if (there !== thing) return fail('it did not move' + where(u) + ': ' + what);
          if (posOf(u) !== s.at.join()) return fail('the bulldozer stayed' + where(u) + ': ' + what);
          break;
        }
        case 'build': {
          let icon = null;
          for (let wait = 0; wait < 60 && !icon; wait++) {
            icon = planIcon(s.what);
            if (!icon) await tick(1);
          }
          if (!icon) return fail('no plan for ' + s.what + ': ' + what);
          L.mc(icon, 'dobuild', P(s.at));
          await tick(5);
          const made = L.gp(tile(s.at), 'occupant');
          if (!made || name(L.gp(made, 'pclass').a[1]) !== s.what) return fail('not built: ' + what);
          units[s.as] = made;
          focus(made);
          break;
        }
        case 'take': {
          const at = posOf(u).split(',').map(Number);
          L.mc(u, 'menuclick', L.sym('disassemble'));
          await tick(5);
          if (!L.t(L.gp(u, 'pdead'))) return fail('not taken apart: ' + what);
          if (!L.gp(tile(at), 'resource')) return fail('no bricks left: ' + what);
          break;
        }
        case 'color':
          for (let i = 0; i < s.times; i++) L.mc(u, 'menuclick', 'changecolor');
          await tick(1);
          break;
        case 'wait': {
          const tiles = s.made || [s.at];
          if (!(await until(() => tiles.every((t) => L.gp(tile(t), 'resource') !== undefined), 2000))) return fail('nothing made: ' + what);
          await tick(2);
          break;
        }
        case 'recharge': {
          const why = await drive(u, s.stand);
          if (why) return fail(why + ': ' + what);
          if (!(await until(() => energy(u) >= 100, 1500))) return fail('not recharged' + where(u) + ': ' + what);
          break;
        }
        case 'hunt': {
          // (from Rando v3) two defenders built where a monster roams, from the bricks there,
          // which hold their ground for it to come; the other goes to the side of the one it
          // attacks; and back to where they were built after
          const m = units[s.target];
          if (!m) return fail('no monster ' + s.target + ': ' + what);
          const alive = (x) => !L.t(L.gp(x, 'pdead')) && !!L.gp(x, 'ptile');
          const at = (x) => posOf(x).split(',').map(Number);
          const near = (t, r) => { if (!alive(m)) return false; const [mx, my] = at(m); return Math.abs(mx - t[0]) + Math.abs(my - t[1]) <= r; };
          const hunters = [];
          for (const [site, as] of [[s.at, s.as], [s.at2, s.as2]]) {
            // (built when the monster is not on its bricks or beside them)
            if (!(await until(() => !L.gp(tile(site), 'occupant') && !near(site, 2), 8000))) return fail('the site never came free: ' + what);
            const icon = planIcon(s.what);
            if (!icon) return fail('no plan for ' + s.what + ': ' + what);
            L.mc(icon, 'dobuild', P(site));
            // (it is off after the monster at once, if it is near: the new one within 2 of its site)
            let d = null;
            for (let dy = -2; dy <= 2 && !d; dy++) for (let dx = -2; dx <= 2 && !d; dx++) {
              const t = tile([site[0] + dx, site[1] + dy]);
              const o = t && L.gp(t, 'occupant');
              if (o && name(L.gp(o, 'pclass').a[1]) === s.what && !hunters.includes(o) && !Object.values(units).includes(o)) d = o;
            }
            await tick(5);
            if (!d) return fail('not built at ' + site + ' (the ' + kindOf[s.target] + ' at ' + posOf(m) + '): ' + what);
            units[as] = d;
            hunters.push(d);
            focus(d);
          }
          let lastAt = posOf(m);
          const v3 = p.version === 3;
          for (let i = 0; i < (v3 ? 300 : 1500) && alive(m); i++) {
            lastAt = posOf(m);
            if (!hunters.some(alive)) return fail('the ' + s.what + 's were beaten (the ' + kindOf[s.target] + ' at ' + posOf(m) + '): ' + what);
            const [mx, my] = at(m);
            // (Rando v3's missions were made for defenders that wait a minute for it, alone, and
            // then are sent after it; Rando v4's for defenders that hold their ground, the other
            // going to the side of the one it attacks)
            if (v3 && i < 90) { await tick(20); continue; }
            if (v3) {
              for (const d of hunters) {
                if (!alive(d) || L.gp(L.gp(d, 'pattack'), 'target')) continue;
                const [dx0, dy0] = at(d);
                if (Math.abs(mx - dx0) + Math.abs(my - dy0) <= 1 || !(await idle(d, 1))) continue;
                const next = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([ox, oy]) => [mx + ox, my + oy])
                  .filter((t) => tile(t) && !L.gp(tile(t), 'occupant') && ['normal', 'street', 'swamp'].includes(terrain(t)))
                  .sort((a, b) => Math.abs(a[0] - dx0) + Math.abs(a[1] - dy0) - Math.abs(b[0] - dx0) - Math.abs(b[1] - dy0))[0];
                L.mc(d, 'gotopos', P(next || [mx, my]));
              }
              await tick(20);
              continue;
            }
            const engaged = hunters.find((d) => alive(d) && (() => { const [dx0, dy0] = at(d); return Math.abs(mx - dx0) + Math.abs(my - dy0) <= 1; })());
            if (engaged) {
              focus(engaged);
              for (const d of hunters) {
                if (d === engaged || !alive(d) || L.gp(L.gp(d, 'pattack'), 'target')) continue;
                const [dx0, dy0] = at(d);
                if (Math.abs(mx - dx0) + Math.abs(my - dy0) <= 2 || !(await idle(d, 1))) continue;
                // (within 2 of it is enough: a defender goes for what is that near on its own)
                const near2 = [];
                for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) if ((ox || oy) && Math.abs(ox) + Math.abs(oy) <= 2) near2.push([mx + ox, my + oy]);
                const next = near2.filter((t) => tile(t) && !L.gp(tile(t), 'occupant') && ['normal', 'street', 'swamp'].includes(terrain(t)))
                  .sort((a, b) => Math.abs(a[0] - dx0) + Math.abs(a[1] - dy0) - Math.abs(b[0] - dx0) - Math.abs(b[1] - dy0))[0];
                if (next) L.mc(d, 'gotopos', P(next));
              }
            }
            await tick(20);
          }
          if (alive(m)) return fail('the monster still stands (at ' + posOf(m) + '): ' + what);
          await tick(10);
          // (back to where they were built, in turns: one may stand in the other's way.  They
          // are alike: each to whichever of the two sites is nearer it)
          if (!v3) {
            const [h1, h2] = [units[s.as], units[s.as2]];
            if (alive(h1) && alive(h2)) {
              const dd = (d, t) => { const [x, y] = at(d); return Math.abs(x - t[0]) + Math.abs(y - t[1]); };
              if (dd(h1, s.at2) + dd(h2, s.at) < dd(h1, s.at) + dd(h2, s.at2)) { units[s.as] = h2; units[s.as2] = h1; }
            }
          }
          const home = [[s.at, s.as], [s.at2, s.as2]];
          for (const [, as] of home) {
            if (!alive(units[as])) return fail('a ' + s.what + ' fell (' + as + '): ' + what);
            try { L.mc(units[as], 'disengageattack'); } catch (e) { /* none */ }
          }
          await tick(5);
          let left = home.slice(), why = null;
          for (let pass = 0; pass < 4 && left.length; pass++) {
            const still = [];
            for (const [site, as] of left) {
              why = await drive(units[as], site);
              if (why) still.push([site, as]);
            }
            left = still;
          }
          if (left.length) {
            const [site] = left[0], t = tile(site), o = L.gp(t, 'occupant');
            return fail(why + ' (back from the hunt; the site has ' + (o ? name(L.gp(o, 'pclass').a[1]) : L.gp(t, 'resource') ? 'bricks' : 'nothing') + ', the ' + kindOf[s.target] + ' last at ' + lastAt + '): ' + what);
          }
          break;
        }
        case 'attack': {
          // (a defender goes for a monster in reach on its own; it takes it apart, frozen)
          const m = units[s.target];
          if (!m) return fail('no monster ' + s.target + ': ' + what);
          L.mc(u, 'gotopos', P(s.stand));
          if (!(await until(() => L.t(L.gp(m, 'pdead')), 6000))) return fail('the monster still stands' + where(u) + ': ' + what);
          if (!(await idle(u))) return fail('never stopped' + where(u) + ': ' + what);
          if (posOf(u) !== s.stand.join()) return fail('fought from elsewhere' + where(u) + ': ' + what);
          break;
        }
        default:
          return fail('no such step: ' + what);
      }
      if (rt.errors.length) return fail('script error after ' + what);
      { const gs = L.gp(glob, 'goals'); log.push(n + ' ' + s.op + ' goals ' + (gs ? L.gp(gs, 'goal').a.length + '/' + L.gp(gs, 'bonus').a.length : '-') + ' bonus on ' + L.gp(md, 'pbonusavailable') + (s.unit !== undefined && units[s.unit] ? ' ' + s.unit + ' e=' + energy(units[s.unit]) + ' @' + posOf(units[s.unit]) : s.as && units[s.as] ? ' ' + s.as + ' e=' + energy(units[s.as]) + ' @' + posOf(units[s.as]) : '')); }
    }
    await tick(20);
    const goals = L.gp(glob, 'goals');
    const left = (k) => { const l = goals && L.gp(goals, k); return l && l.a ? l.a.length : -1; };
    const ok = left('goal') === 0 && left('bonus') === 0;
    let detail = '';
    if (!ok) {
      // what stands on each goal still wanted
      for (const k of ['goal', 'bonus']) {
        const l = goals && L.gp(goals, k);
        for (const g of (l && l.a) || []) {
          const t = L.gp(g, 'ptile');
          const o = L.gp(t, 'occupant');
          detail += ' [' + k + ' at ' + L.gp(t, 'pos').a.map((v) => v - 1) + ' wants ' + L.gp(g, 'pgoal').a.map(name) + ', has ' + (o ? L.gp(o, 'pclass').a.map(name) : 'nothing') + ', bonus on ' + L.gp(md, 'pbonusavailable') + ']';
        }
      }
    }
    return { ok, why: ok ? '' : 'goal not reached (goals left ' + left('goal') + ', bonus ' + left('bonus') + ')' + detail, log: ok && !opts.keepLog ? [] : log, errors: rt.errors.slice(0, 3) };
  }
}

const STOPPED = new Error('stopped');

// Waits for frames of the game as it runs (not stepped by the caller): frames the game holds
// still for (its menu open) are not counted.
export function liveTicks(rt) {
  return (n) => new Promise((resolve) => {
    let left = n, last = rt.ticks || 0;
    const look = () => {
      const now = rt.ticks || 0;
      if (now > last) { if (!rt.paused) left -= now - last; last = now; }
      if (left <= 0) resolve();
      else requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}
