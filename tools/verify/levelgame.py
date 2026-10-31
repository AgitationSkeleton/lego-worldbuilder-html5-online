"""Custom levels in the game itself: each campaign map read into a level (src/online/levelformat.js)
and played as a custom level, every tile as the game made it (its ground, what stands on it, what
lies on it) against the campaign map played as the game's own.
    python tools/verify/levelgame.py [base]"""
import sys
from playwright.sync_api import sync_playwright

base = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8766/'
CENSUS = r"""async () => { const L = await import(new URL('src/director/lingo.js', location.href).href);
  const rt = window.__rt, md = L.gp(rt.globals.glob, 'map_display');
  if (!md) return null;
  const size = L.gp(md, 'pmapsize').a, out = [], monsters = [];
  const name = (o) => { if (!o) return ''; const c = L.gp(o, 'pclass'); return c && c.a ? c.a.map((v) => String(v && v.key !== undefined ? v.key : v)).join(':') : 'thing'; };
  for (let y = 1; y <= size[1]; y++) { const row = []; for (let x = 1; x <= size[0]; x++) {
    const t = L.mc(md, 'gettileat', L.list([x, y]));
    // (monsters wander from the start: counted by kind, not by tile)
    const o = name(L.gp(t, 'occupant'));
    if (/^monster:/.test(o) && !/boulder/.test(o)) monsters.push(o);
    row.push(String(L.gp(t, 'terrain')) + '/' + (/^monster:/.test(o) && !/boulder/.test(o) ? '' : o) + '/' + name(L.gp(t, 'resource')));
  } out.push(row.join(' ')); }
  const inv = L.gp(rt.globals.glob, 'inventory');
  return { tiles: out, monsters: monsters.sort().join(','), inv: inv ? String(inv) : '' }; }"""
LEAVE = """() => { const rt = window.__rt, ui = window.__online; ui.random.quietly(() => { const m = rt.movieHandlers.quitlevel.script; if (rt.labelAt(rt.frame) === 'play') rt.call(rt.scriptSelf(m), m, 'quitlevel'); }); rt.step(3); rt.go('world 1'); rt.step(3); }"""
fails = 0
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.goto(base + '?test&seed=1')
    pg.wait_for_function('window.__rt && window.__rt.started', timeout=120000)
    pg.evaluate('window.__step(10)')
    maps = pg.evaluate("""() => { const out = []; for (const c of window.__rt.data.casts) for (const m of Object.values(c.members)) { const mm = /^map(\\d)\\.(\\d+)$/.exec(m.name || ''); if (mm && m.text) out.push([+mm[1], +mm[2]]); } return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]); }""")
    for w, l in maps:
        pg.evaluate(LEAVE)
        own = pg.evaluate("""([w, l]) => { const rt = window.__rt, s = rt.movieHandlers.golevel.script; rt.call(rt.scriptSelf(s), s, 'golevel', w, l); rt.step(3); }""", [w, l])
        a = pg.evaluate(CENSUS)
        pg.evaluate(LEAVE)
        problem = pg.evaluate("""async ([w, l]) => { const F = await import(new URL('src/online/levelformat.js', location.href).href);
          const rt = window.__rt; let text = null;
          for (const c of rt.data.casts) for (const m of Object.values(c.members)) if (m.name === 'map' + w + '.' + l) text = m.text;
          const level = F.parseMap(text); level.sky = w;
          const r = window.__online.random.playLevel(level, 'C-DRAFT'); rt.step(3); return r; }""", [w, l])
        c = pg.evaluate(CENSUS)
        same = a is not None and c is not None and a['tiles'] == c['tiles'] and a['monsters'] == c['monsters'] and a['inv'] == c['inv']
        if problem or not same:
            fails += 1
            diff = ''
            if a and c:
                for y, (ra, rc) in enumerate(zip(a['tiles'], c['tiles'])):
                    for x, (ta, tc) in enumerate(zip(ra.split(' '), rc.split(' '))):
                        if ta != tc:
                            diff = '%d,%d: %s vs %s' % (x, y, ta, tc)
                            break
                    if diff:
                        break
            print('FAIL %d.%d %s %s' % (w, l, problem or '', diff), flush=True)
    errors = pg.evaluate('() => window.__rt.errors.map(String).slice(0, 3)')
    if errors:
        fails += 1
        print('script errors:', errors)
    b.close()
print('%d campaign maps: %s' % (len(maps), 'all the same as custom levels' if not fails else '%d failed' % fails))
sys.exit(1 if fails else 0)
