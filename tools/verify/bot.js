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
  const fail = (why) => ({ ok: false, why, log: log.slice(-8), errors: rt.errors.slice(0, 3) });
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
    { const gs = L.gp(glob, 'goals'); log.push(n + ' ' + s.op + ' goals ' + (gs ? L.gp(gs, 'goal').a.length + '/' + L.gp(gs, 'bonus').a.length : '-') + ' bonus on ' + L.gp(md, 'pbonusavailable')); }
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
  return { ok, why: ok ? '' : 'goal not reached (goals left ' + left('goal') + ', bonus ' + left('bonus') + ')' + detail, log: ok ? [] : log, errors: rt.errors.slice(0, 3) };
}
