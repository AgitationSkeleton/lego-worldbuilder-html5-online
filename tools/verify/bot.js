// A player for generated missions (src/online/puzzle.js): plays a mission's own solution in
// the game, through the game's own handlers (a unit's menuclick and mapclick, as its action
// buttons and a click on the map call them; the map's tilePosclick for a push; the plan
// icon's doBuild; a building's menuclick; gotoPos), and checks each step did what it should
// and that the goal and the bonus goal are reached.  Each step that acts beside something
// names the tile its unit stands on: the unit is driven there first.  Run in the page by
// tools/verify/puzzles.py, in the test mode's virtual time.  Answers {ok, log, ...}.
async (code) => {
  const L = await import(new URL('src/director/lingo.js', location.href).href);
  const rt = window.__rt, ui = window.__online;
  const log = [];
  const fail = (why) => ({ ok: false, why, log: log.slice(-40), errors: rt.errors.slice(0, 3) });
  rt.errors.length = 0;
  if (!/^world \d$/.test(rt.labelAt(rt.frame) || '')) { rt.go('world 1'); rt.step(2); }
  const problem = ui.random.play(code);
  if (problem) return fail(problem);
  rt.step(10);
  const p = ui.random.active.puzzle;
  const glob = rt.globals.glob;
  const md = L.gp(glob, 'map_display');
  const P = ([x, y]) => L.list([x + 1, y + 1]);      // the game counts tiles from 1
  const tile = (at) => L.mc(md, 'gettileat', P(at));
  const terrain = (at) => L.gp(tile(at), 'terrain').key;
  const posOf = (u) => { const t = L.gp(u, 'ptile'); return t ? L.gp(t, 'pos').a.map((v) => v - 1).join(',') : 'nowhere (gone)'; };
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
  const idle = (u, max = 6000) => {
    for (let i = 0; i < max; i++) {
      if (L.gp(u, 'ppath') === undefined && L.gp(u, 'pcheckdestination') === undefined && L.gp(u, 'pmovepixeltime') === undefined && L.gp(u, 'ppushwaiting') === undefined) { rt.step(2); return true; }
      rt.step(1);
    }
    return false;
  };
  const until = (test, max = 1500) => {
    for (let i = 0; i < max; i++) { if (test()) return true; rt.step(1); }
    return false;
  };
  const cargo = (u) => { const c = L.gp(u, 'pcargo'); const b = c && L.gp(c, 'bricks'); return b ? b.v.reduce((a, n) => a + (typeof n === 'number' ? n : 0), 0) : 0; };
  const energy = (u) => (L.gp(u, 'ptile') ? L.mc(u, 'energystatus') : 'none');
  const where = (u) => ' (at ' + posOf(u) + ', energy ' + energy(u) + ')';
  // (a plan picked up from the map names its unit with a string, the game's own with a symbol)
  const name = (v) => String(v && v.key !== undefined ? v.key : v).toLowerCase();
  const drive = (u, to, s) => {
    if (posOf(u) === to.join()) return null;
    L.mc(u, 'gotopos', P(to));
    if (!idle(u)) return 'never got there' + where(u);
    if (posOf(u) !== to.join()) return 'stopped short' + where(u);
    return null;
  };
  const steps = p.solution.map((s) => [s, 'goal']).concat(p.bonus.map((s) => [s, 'bonus']));
  let n = 0;
  for (const [s, part] of steps) {
    n++;
    // (a test may stop the bot after a step, its units left to it)
    if (window.__stopAfter && n > window.__stopAfter) { window.__botUnits = units; return { ok: true, stopped: n - 1, log }; }
    const what = part + ' step ' + n + ' ' + JSON.stringify(s);
    const u = s.unit !== undefined ? units[s.unit] : null;
    if (s.unit !== undefined && !u) return fail('no unit ' + s.unit + ' for ' + what);
    switch (s.op) {
      case 'go': {
        const why = drive(u, s.to);
        if (why) return fail(why + ': ' + what);
        break;
      }
      case 'whirl': {
        L.mc(u, 'gotopos', P(s.at));
        if (!idle(u)) return fail('never got there' + where(u) + ': ' + what);
        if (posOf(u) !== s.out.join()) return fail('came out elsewhere' + where(u) + ': ' + what);
        break;
      }
      case 'pick': case 'drop': case 'dig': case 'fill': case 'uproot': case 'plant': {
        const why = drive(u, s.stand);
        if (why) return fail(why + ': ' + what);
        const before = s.op === 'pick' || s.op === 'drop' ? cargo(u) : terrain(s.at);
        L.mc(u, 'menuclick', L.sym(s.op));
        L.mc(u, 'mapclick', L.sym('mouseDown'), P(s.at));
        if (!idle(u)) return fail('never did it' + where(u) + ': ' + what);
        if (posOf(u) !== s.stand.join()) return fail('moved off' + where(u) + ': ' + what);
        if (s.op === 'pick' && !cargo(u)) return fail('picked nothing' + where(u) + ': ' + what);
        if (s.op === 'drop' && cargo(u)) return fail('dropped nothing' + where(u) + ': ' + what);
        if (s.op !== 'pick' && s.op !== 'drop' && terrain(s.at) === before) return fail(s.op + ' changed nothing (' + before + ')' + where(u) + ': ' + what);
        break;
      }
      case 'regate': {
        // take up the tree between a monster's den and the yellow ground, back off a tile and
        // plant it where the treebot stood
        let why = drive(u, s.stand);
        if (why) return fail(why + ': ' + what);
        L.mc(u, 'menuclick', L.sym('uproot'));
        L.mc(u, 'mapclick', L.sym('mouseDown'), P(s.at));
        if (!idle(u)) return fail('never took it up' + where(u) + ': ' + what);
        if (!cargo(u)) return fail('took nothing up' + where(u) + ': ' + what);
        why = drive(u, s.back);
        if (why) return fail(why + ' (backing off): ' + what);
        L.mc(u, 'menuclick', L.sym('plant'));
        L.mc(u, 'mapclick', L.sym('mouseDown'), P(s.stand));
        if (!idle(u)) return fail('never planted it' + where(u) + ': ' + what);
        if (!/^tree/.test(terrain(s.stand))) return fail('the way back is not shut (' + terrain(s.stand) + ')' + where(u) + ': ' + what);
        break;
      }
      case 'wander': {
        // a monster left to wander onto the yellow ground: the goal (or the bonus) is waited for
        const goals = () => { const gs = L.gp(glob, 'goals'); const l = gs && L.gp(gs, part); return l && l.a ? l.a.length : -1; };
        const before = goals();
        if (!until(() => goals() < before || goals() === 0, 20000)) return fail('the monster never came onto the yellow ground (at ' + posOf(u) + '): ' + what);
        break;
      }
      case 'push': {
        const why = drive(u, s.stand);
        if (why) return fail(why + ': ' + what);
        const thing = L.gp(tile(s.at), 'occupant') || L.gp(tile(s.at), 'resource');
        if (!thing) return fail('nothing to push: ' + what);
        L.mc(u, 'menuclick', L.sym('push'));
        L.mc(md, 'tileposclick', L.sym('mouseDown'), P(s.at));
        if (!idle(u)) return fail('never pushed' + where(u) + ': ' + what);
        const beyond = [2 * s.at[0] - s.stand[0], 2 * s.at[1] - s.stand[1]];
        const there = L.gp(tile(beyond), 'occupant') || L.gp(tile(beyond), 'resource');
        if (there !== thing) return fail('it did not move' + where(u) + ': ' + what);
        if (posOf(u) !== s.at.join()) return fail('the bulldozer stayed' + where(u) + ': ' + what);
        break;
      }
      case 'build': {
        // (a plan just fetched flies to the plans bar first: its icon takes it on landing)
        let icon = null;
        for (let wait = 0; wait < 60 && !icon; wait++) {
          for (let c = 1; c < 200 && !icon; c++) {
            const sp = rt.sprites[c];
            if (!sp) continue;
            for (const inst of sp.scriptInstances) {
              const cls = inst.$ && inst.$.pclass;
              if (inst.script.name === 'build plan icon behavior' && cls && cls.a && name(cls.a[1]) === s.what && !inst.$.pswoop) icon = inst;
            }
          }
          if (!icon) rt.step(1);
        }
        if (!icon) return fail('no plan for ' + s.what + ': ' + what);
        L.mc(icon, 'dobuild', P(s.at));
        rt.step(5);
        const made = L.gp(tile(s.at), 'occupant');
        if (!made || name(L.gp(made, 'pclass').a[1]) !== s.what) return fail('not built: ' + what);
        units[s.as] = made;
        break;
      }
      case 'take': {
        const at = posOf(u).split(',').map(Number);
        L.mc(u, 'menuclick', L.sym('disassemble'));
        rt.step(5);
        if (!L.t(L.gp(u, 'pdead'))) return fail('not taken apart: ' + what);
        if (!L.gp(tile(at), 'resource')) return fail('no bricks left: ' + what);
        break;
      }
      case 'color':
        for (let i = 0; i < s.times; i++) L.mc(u, 'menuclick', 'changecolor');
        rt.step(1);
        break;
      case 'wait': {
        const tiles = s.made || [s.at];
        if (!until(() => tiles.every((t) => L.gp(tile(t), 'resource') !== undefined), 2000)) return fail('nothing made: ' + what);
        rt.step(2);
        break;
      }
      case 'recharge': {
        const why = drive(u, s.stand);
        if (why) return fail(why + ': ' + what);
        if (!until(() => energy(u) >= 100, 1500)) return fail('not recharged' + where(u) + ': ' + what);
        break;
      }
      case 'hunt': {
        // (Rando v3) two defenders built where a monster roams, from the bricks there, sent after
        // it until it is taken apart, and back to where they were built
        const m = units[s.target];
        if (!m) return fail('no monster ' + s.target + ': ' + what);
        const alive = (x) => !L.t(L.gp(x, 'pdead')) && !!L.gp(x, 'ptile');
        const at = (x) => posOf(x).split(',').map(Number);
        const near = (t, r) => { if (!alive(m)) return false; const [mx, my] = at(m); return Math.abs(mx - t[0]) + Math.abs(my - t[1]) <= r; };
        const hunters = [];
        for (const [site, as] of [[s.at, s.as], [s.at2, s.as2]]) {
          // (built when the monster is not on its bricks or beside them)
          if (!until(() => !L.gp(tile(site), 'occupant') && !near(site, 2), 8000)) return fail('the site never came free: ' + what);
          let icon = null;
          for (let c = 1; c < 200 && !icon; c++) {
            const sp = rt.sprites[c];
            if (!sp) continue;
            for (const inst of sp.scriptInstances) {
              const cls = inst.$ && inst.$.pclass;
              if (inst.script.name === 'build plan icon behavior' && cls && cls.a && name(cls.a[1]) === s.what && !inst.$.pswoop) icon = inst;
            }
          }
          if (!icon) return fail('no plan for ' + s.what + ': ' + what);
          L.mc(icon, 'dobuild', P(site));
          // (it is off after the monster at once, if it is near: the new one within 2 of its site)
          let d = null;
          for (let dy = -2; dy <= 2 && !d; dy++) for (let dx = -2; dx <= 2 && !d; dx++) {
            const t = tile([site[0] + dx, site[1] + dy]);
            const o = t && L.gp(t, 'occupant');
            if (o && name(L.gp(o, 'pclass').a[1]) === s.what && !hunters.includes(o) && !Object.values(units).includes(o)) d = o;
          }
          rt.step(5);
          if (!d) return fail('not built at ' + site + ' (the ' + kindOf[s.target] + ' at ' + posOf(m) + '): ' + what);
          units[as] = d;
          hunters.push(d);
        }
        let lastAt = posOf(m);
        // (they hold their ground where they were built while it comes for them, as it does for
        // anything within 4; the fight is theirs to go after it in)
        for (let i = 0; i < 1500 && alive(m); i++) {
          lastAt = posOf(m);
          if (!hunters.some(alive)) return fail('the ' + s.what + 's were beaten (the ' + kindOf[s.target] + ' at ' + posOf(m) + '): ' + what);
          // (when it comes for one of them, the other goes to its side: two against it, not one)
          const [mx, my] = at(m);
          const engaged = hunters.find((d) => alive(d) && (() => { const [dx0, dy0] = at(d); return Math.abs(mx - dx0) + Math.abs(my - dy0) <= 1; })());
          if (engaged) {
            for (const d of hunters) {
              if (d === engaged || !alive(d) || L.gp(L.gp(d, 'pattack'), 'target')) continue;
              const [dx0, dy0] = at(d);
              if (Math.abs(mx - dx0) + Math.abs(my - dy0) <= 2 || !idle(d, 1)) continue;
              // (within 2 of it is enough: a defender goes for what is that near on its own)
              const near2 = [];
              for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) if ((ox || oy) && Math.abs(ox) + Math.abs(oy) <= 2) near2.push([mx + ox, my + oy]);
              const next = near2.filter((t) => tile(t) && !L.gp(tile(t), 'occupant') && ['normal', 'street', 'swamp'].includes(terrain(t)))
                .sort((a, b) => Math.abs(a[0] - dx0) + Math.abs(a[1] - dy0) - Math.abs(b[0] - dx0) - Math.abs(b[1] - dy0))[0];
              if (next) L.mc(d, 'gotopos', P(next));
            }
          }
          rt.step(20);
        }
        if (alive(m)) return fail('the monster still stands (at ' + posOf(m) + '): ' + what);
        rt.step(10);
        // (back to where they were built, in turns: one may stand in the other's way.  They are
        // alike: each to whichever of the two sites is nearer it)
        {
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
        rt.step(5);
        let left = home.slice(), why = null;
        for (let pass = 0; pass < 4 && left.length; pass++) {
          const still = [];
          for (const [site, as] of left) {
            why = drive(units[as], site);
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
        if (!until(() => L.t(L.gp(m, 'pdead')), 6000)) return fail('the monster still stands' + where(u) + ': ' + what);
        if (!idle(u)) return fail('never stopped' + where(u) + ': ' + what);
        if (posOf(u) !== s.stand.join()) return fail('fought from elsewhere' + where(u) + ': ' + what);
        break;
      }
      default:
        return fail('no such step: ' + what);
    }
    if (rt.errors.length) return fail('script error after ' + what);
    { const gs = L.gp(glob, 'goals'); log.push(n + ' ' + s.op + ' goals ' + (gs ? L.gp(gs, 'goal').a.length + '/' + L.gp(gs, 'bonus').a.length : '-') + ' bonus on ' + L.gp(md, 'pbonusavailable') + (s.unit !== undefined && units[s.unit] ? ' ' + s.unit + ' e=' + energy(units[s.unit]) + ' @' + posOf(units[s.unit]) : s.as && units[s.as] ? ' ' + s.as + ' e=' + energy(units[s.as]) + ' @' + posOf(units[s.as]) : '')); }
  }
  rt.step(20);
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
  return { ok, why: ok ? '' : 'goal not reached (goals left ' + left('goal') + ', bonus ' + left('bonus') + ')' + detail, log: ok && !window.__botLog ? [] : log, errors: rt.errors.slice(0, 3) };
}
