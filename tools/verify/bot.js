// A player for generated missions (src/online/puzzle.js): plays a mission's own solution in
// the game, through the game's own handlers (a unit's menuclick and mapclick, as its action
// buttons and a click on the map call them, the plan icon's doBuild, gotoPos), and checks
// each step did what it should and that the goal is reached.  Run in the page by
// tools/verify/puzzles.py, in the test mode's virtual time.  Answers {ok, log, ...}.
async (code) => {
  const L = await import(new URL('src/director/lingo.js', location.href).href);
  const rt = window.__rt, ui = window.__online;
  const log = [];
  const fail = (why) => ({ ok: false, why, log, errors: rt.errors.slice(0, 3) });
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
  const posOf = (u) => L.gp(L.gp(u, 'ptile'), 'pos').a.map((v) => v - 1).join(',');
  const units = {};
  for (const [name, at] of Object.entries(p.units)) units[name] = L.gp(tile(at), 'occupant');
  if (!units.u0) return fail('no first unit');
  // until the unit has stopped and done what it was sent to do
  const idle = (u, max = 6000) => {
    for (let i = 0; i < max; i++) {
      if (L.gp(u, 'ppath') === undefined && L.gp(u, 'pcheckdestination') === undefined) { rt.step(2); return true; }
      rt.step(1);
    }
    return false;
  };
  const act = (u, what, at) => {
    L.mc(u, 'menuclick', L.sym(what));
    L.mc(u, 'mapclick', L.sym('mouseDown'), P(at));
    return idle(u);
  };
  const cargo = (u) => { const c = L.gp(u, 'pcargo'); const b = c && L.gp(c, 'bricks'); return b ? b.v.reduce((a, n) => a + (typeof n === 'number' ? n : 0), 0) : 0; };
  const energy = (u) => L.mc(u, 'energystatus');
  // (a plan picked up from the map names its unit with a string, the game's own with a symbol)
  const name = (v) => String(v && v.key !== undefined ? v.key : v).toLowerCase();
  for (const s of p.solution.concat(p.bonus)) {
    const u = s.unit && units[s.unit];
    if (s.unit && !u) return fail('no unit ' + s.unit + ' for ' + JSON.stringify(s));
    switch (s.op) {
      case 'go': {
        L.mc(u, 'gotopos', P(s.to));
        if (!idle(u)) return fail('never got there: ' + JSON.stringify(s));
        if (posOf(u) !== s.to.join()) return fail(s.unit + ' stopped at ' + posOf(u) + ', energy ' + energy(u) + ': ' + JSON.stringify(s));
        break;
      }
      case 'haul': {
        let trips = 0;
        while (L.gp(tile(s.from), 'resource') !== undefined) {
          if (++trips > 30) return fail('too many trips: ' + JSON.stringify(s));
          if (!act(u, 'pick', s.from) || !cargo(u)) return fail('picked nothing, at ' + posOf(u) + ', energy ' + energy(u) + ': ' + JSON.stringify(s));
          if (!act(u, 'drop', s.to) || cargo(u)) return fail('dropped nothing, at ' + posOf(u) + ', energy ' + energy(u) + ': ' + JSON.stringify(s));
        }
        log.push(s.unit + ' hauled in ' + trips + ' trips, energy ' + energy(u));
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
              if (inst.script.name === 'build plan icon behavior' && cls && cls.a && name(cls.a[1]) === s.what) icon = inst;
            }
          }
          if (!icon) rt.step(1);
        }
        if (!icon) return fail('no plan for ' + s.what);
        L.mc(icon, 'dobuild', P(s.at));
        rt.step(5);
        const made = L.gp(tile(s.at), 'occupant');
        if (!made || name(L.gp(made, 'pclass').a[1]) !== s.what) return fail('not built: ' + JSON.stringify(s));
        units[s.as] = made;
        log.push('built ' + s.what);
        break;
      }
      case 'dig': case 'fill': case 'uproot': case 'plant': {
        const before = terrain(s.at);
        if (!act(u, s.op, s.at)) return fail('never did it: ' + JSON.stringify(s));
        if (terrain(s.at) === before) return fail(s.op + ' changed nothing (' + before + ', at ' + posOf(u) + ', energy ' + energy(u) + '): ' + JSON.stringify(s));
        break;
      }
    }
    if (rt.errors.length) return fail('script error after ' + JSON.stringify(s));
  }
  rt.step(20);
  const goals = L.gp(glob, 'goals');
  const left = (k) => { const l = goals && L.gp(goals, k); return l && l.a ? l.a.length : -1; };
  const ok = left('goal') === 0 && (p.bonus.length === 0 || left('bonus') === 0);
  return { ok, why: ok ? '' : 'goal not reached (goals left ' + left('goal') + ', bonus ' + left('bonus') + ')', log, errors: rt.errors.slice(0, 3) };
}
