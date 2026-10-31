"""The level editor's picture of a level (src/online/isoview.js) as the game draws it: each kind of
thing on the map, read from the game itself, all 84 campaign maps loaded in turn. For each kind
(a vehicle, building or monster; a plan; the goal, the bonus goal; a whirlpool), the sprites the
game gives it as a mission starts: their members, where they stand from the tile's place
(postoloc), how far above it they are drawn (postolocz), their ink. Written to
src/online/isosprites.js. Also checks that a pile of bricks is drawn as isoview.js works it out
(the game's own setupPileSprites), pile by pile, and the ground's sprites' ink.
    python tools/verify/isosprites.py [base]"""
import collections
import json
import sys
from playwright.sync_api import sync_playwright

base = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8766/'
PROBE = r"""async () => { const L = await import(new URL('src/director/lingo.js', location.href).href);
  const V = await import(new URL('src/online/isoview.js', location.href).href);
  const rt = window.__rt, md = L.gp(rt.globals.glob, 'map_display');
  const size = L.gp(md, 'pmapsize').a, out = [], piles = [];
  const nm = (s) => s && s.member ? s.member.name : null;
  const tile0 = L.gi(L.gi(L.gp(md, 'pmapsprites'), 1), 1);
  for (let y = 1; y <= size[1]; y++) for (let x = 1; x <= size[0]; x++) {
    const t = L.mc(md, 'gettileat', L.list([x, y]));
    const p = L.mc(md, 'postoloc', new L.LPoint(x, y)), z = L.mc(md, 'postolocz', new L.LPoint(x, y));
    for (const layer of ['occupant', 'resource', 'whirlpool', 'goal']) {
      const o = L.gp(t, layer);
      if (!o) continue;
      const cls = L.gp(o, 'pclass'), ps = L.gp(o, 'psprites');
      const key = cls && cls.a ? cls.a.map(String).join(':') : String(cls);
      const sprites = [];
      // (at rest: a goal's bob, a vehicle's bounce taken off; a shadow keeps to the ground)
      const off = L.gp(o, 'ppixeloffset'), num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      const ox = off ? num(off.h !== undefined ? off.h : off.a && off.a[0]) : 0, oy = off ? num(off.v !== undefined ? off.v : off.a && off.a[1]) : 0;
      if (ps && ps.k) for (let i = 0; i < ps.k.length; i++) {
        const s = ps.v[i], label = String(ps.k[i].name || ps.k[i]).toLowerCase();
        if (s && s.member && s.visible && s.blend > 0) sprites.push({ m: nm(s), dx: Math.round(s.locH - p.h - ox), dy: Math.round(s.locV - p.v - (label === 'shadow' ? 0 : oy)), dz: s.locZ - z, ink: s.ink, blend: Math.round(s.blend) });
      }
      if (/^resource:/.test(key)) {
        // (a pile: what it holds, and the members the game gave it, against isoview's)
        const c = L.gp(o, 'pcontents'), b = L.gp(c, 'bricks'), bricks = {};
        for (let i = 0; i < b.k.length; i++) bricks[String(b.k[i].name || b.k[i])] = b.v[i];
        const energy = L.gp(c, 'energy');
        piles.push({ at: x + ',' + y, game: sprites.map((s) => s.m + '@' + s.dx + ',' + s.dy), mine: V.pileSprites(bricks, energy && energy.a ? energy.a.length : 0, String(L.gp(t, 'terrain'))).map((s) => s.m + '@' + s.dx + ',' + s.dy), bricks });
        continue;
      }
      out.push({ key, terrain: String(L.gp(t, 'terrain')), sprites });
    }
  }
  return { out, piles, ground: { ink: tile0.ink, blend: tile0.blend } }; }"""
LEAVE = """() => { const rt = window.__rt; const m = rt.movieHandlers.quitlevel.script; if (rt.labelAt(rt.frame) === 'play') rt.call(rt.scriptSelf(m), m, 'quitlevel'); rt.step(3); rt.go('world 1'); rt.step(3); }"""
kinds = collections.defaultdict(collections.Counter)
fails = 0
ground = set()
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.goto(base + '?test&seed=1')
    pg.wait_for_function('window.__rt && window.__rt.started', timeout=120000)
    pg.evaluate('window.__step(10)')
    maps = pg.evaluate("""() => { const out = []; for (const c of window.__rt.data.casts) for (const m of Object.values(c.members)) { const mm = /^map(\\d)\\.(\\d+)$/.exec(m.name || ''); if (mm && m.text) out.push([+mm[1], +mm[2]]); } return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]); }""")
    for w, l in maps:
        pg.evaluate(LEAVE)
        pg.evaluate("""([w, l]) => { const rt = window.__rt, s = rt.movieHandlers.golevel.script; rt.call(rt.scriptSelf(s), s, 'golevel', w, l); rt.step(2); }""", [w, l])
        r = pg.evaluate(PROBE)
        ground.add(json.dumps(r['ground']))
        for o in r['out']:
            # (the goal's shadow is of the ground under it: kept as a pattern)
            sp = [dict(s, m=s['m'].replace('.' + o['terrain'], '.{terrain}') if s['m'].startswith('goal.shadow.') else s['m']) for s in o['sprites']]
            kinds[o['key']][json.dumps(sp, sort_keys=True)] += 1
        for pile in r['piles']:
            if pile['game'] != pile['mine']:
                fails += 1
                if fails <= 8:
                    print('pile %d.%d %s: game %s, isoview %s' % (w, l, pile['at'], pile['game'], pile['mine']))
    # (the kinds no campaign map has: a level of them, played as a custom level)
    extra = pg.evaluate("""() => { const W = 14, rows = []; for (let y = 0; y < 8; y++) rows.push(y === 6 ? 'w'.repeat(W) : '.'.repeat(W));
      const kinds = [['vehicle', 'repairbot'], ['building', 'guard_tower']];
      const items = kinds.map(([cls, kind], i) => ({ x: 1 + 2 * i, y: 2, t: 'unit', cls, kind }));
      items.push({ x: 12, y: 2, t: 'goal', want: 'house' }, { x: 12, y: 4, t: 'bonus', want: 'house' }, { x: 3, y: 6, t: 'goal', want: 'house' }, { x: 5, y: 6, t: 'bonus', want: 'house' });
      return { v: 1, name: 'CALIBRATION', sky: 1, rows, items, inventory: {} }; }""")
    pg.evaluate(LEAVE)
    problem = pg.evaluate("(level) => { const r = window.__online.random.playLevel(level, 'C-DRAFT'); window.__rt.step(2); return r; }", extra)
    if problem:
        print('the calibration level:', problem)
        fails += 1
    else:
        r = pg.evaluate(PROBE)
        for o in r['out']:
            sp = [dict(s, m=s['m'].replace('.' + o['terrain'], '.{terrain}') if s['m'].startswith('goal.shadow.') else s['m']) for s in o['sprites']]
            kinds[o['key']][json.dumps(sp, sort_keys=True)] += 1
    b.close()
table = {}
for k, c in sorted(kinds.items()):
    best, n = c.most_common(1)[0]
    table[k] = json.loads(best)
    if len(c) > 1:
        print('note: %s drawn %d ways; the commonest (%d of %d) kept' % (k, len(c), n, sum(c.values())))
print('ground sprites:', ground)
with open('src/online/isosprites.js', 'w', encoding='utf-8', newline='\n') as f:
    f.write('// Made by tools/verify/isosprites.py from the game itself (all its campaign maps): for each kind\n'
            '// of thing on the map, the sprites the game gives it as a mission starts, from its tile\'s place\n'
            '// (postoloc): member, dx, dy, dz (above the tile\'s postolocz), ink, blend.  Used by the level\n'
            '// editor\'s picture of a level (src/online/isoview.js).  Do not edit: run the tool again.\n')
    f.write('export const SPRITES = ' + json.dumps(table, indent=1, sort_keys=True) + ';\n')
    f.write('export const GROUND = ' + json.dumps(json.loads(sorted(ground)[0])) + ';\n')
print('%d kinds written; piles: %s' % (len(table), 'all as the game draws them' if not fails else '%d differ' % fails))
sys.exit(1 if fails else 0)
