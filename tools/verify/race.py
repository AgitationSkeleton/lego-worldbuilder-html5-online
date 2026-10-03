"""A race between two browsers, through a local server (server/: npm run dev): one makes a
race, the other joins it by its code, the host picks a mission and starts it, both games
count down and start it, one reaches the goal and the other gives up, and both see how it
ended.

    python tools/verify/race.py --server http://127.0.0.1:8787 --out work/shots/race

Needs Playwright with Chromium, the repository served over HTTP (the default URL is
http://127.0.0.1:8766/), and the server running.
"""

import argparse
import os
import sys
import time

from playwright.sync_api import sync_playwright

REPORT = """async (kind) => {
  const L = await import(new URL('src/director/lingo.js', location.href).href);
  const rt = window.__rt;
  L.mc(L.gp(rt.globals.glob, 'worlds_manager'), 'reportsuccess', L.sym(kind));
}"""

def clock(ms):
    t = ms // 1000
    return '%d:%02d' % (t // 60, t % 60)


QUIT = """() => { const rt = window.__rt; const s = rt.movieHandlers.quitlevel.script;
  rt.call(rt.scriptSelf(s), s, 'quitlevel'); rt.step(2); }"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://127.0.0.1:8766/')
    ap.add_argument('--server', default='http://127.0.0.1:8787')
    ap.add_argument('--out', default='work/shots/race')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    failures = []

    def check(what, ok, detail=''):
        print('%s %s%s' % ('ok  ' if ok else 'FAIL', what, (': ' + detail) if detail else ''))
        if not ok:
            failures.append(what)

    def until(page, js, timeout=10000):
        try:
            page.wait_for_function(js, timeout=timeout)
            return True
        except Exception:
            return False

    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'])
        pages = []
        for name in ('Ann', 'Bob'):
            ctx = b.new_context(viewport={'width': 1100, 'height': 640})
            page = ctx.new_page()
            page.goto('%s?test&seed=1&server=%s' % (a.base, a.server))
            page.wait_for_function('window.__rt && window.__rt.started', timeout=60000)
            page.evaluate('window.__step(10)')
            page.evaluate("n => { window.__online.settings.name = n; window.__online.save(); }", name)
            pages.append(page)
        ann, bob = pages

        code = ann.evaluate('window.__online.races.create()')
        check('Ann makes a race', bool(code), code)
        check('and is its host', until(ann, 'window.__online.races.room && window.__online.races.room.host === window.__online.races.you'))
        bob.evaluate('c => window.__online.races.join(c)', code)
        check('Bob joins it by its code', until(ann, 'window.__online.races.room.players.length === 2'))

        # the host picks World Builder 2's second mission from the lists
        ann.select_option('#race select[aria-label=World]', '6')
        ann.select_option('#race select[aria-label=Mission]', '6.2')
        check('the host picks a mission, and the other sees it', until(bob, "window.__online.races.room.mission === '6.2'"))
        bob.click('#race button:has-text("Ready")')
        check('Bob is ready', until(ann, "window.__online.races.room.players.find(p => p.name === 'Bob').ready"))
        ann.screenshot(path=os.path.join(a.out, 'lobby.png'))

        ann.click('#race button:has-text("Start the race")')
        check('both count down', until(bob, "!document.getElementById('race-count').hidden", 3000))
        bob.screenshot(path=os.path.join(a.out, 'countdown.png'))
        for page, who in ((ann, 'Ann'), (bob, 'Bob')):
            check("%s's game starts the mission" % who,
                  until(page, "window.__online.races.racing && window.__online.races.racing.started && window.__rt.labelAt(window.__rt.frame) === 'play'", 8000))
        check('the race knows both started', until(ann, "window.__online.races.room.players.every(p => p.started)"))

        # each sees the other's units as ghosts, in their colour, named when pointed at
        ann.evaluate('window.__step(5)')
        bob.evaluate('window.__step(5)')
        check("Bob hears where Ann's units are", until(bob, "[...window.__online.races.ghosts.values()].some(g => g.next && g.next.u.length > 0)", 5000))
        bob.evaluate('window.__step(2)')
        ghosts = bob.evaluate('''(() => { const rt = window.__rt, r = window.__online.races;
          const out = [];
          for (let i = 0; i < r.ghostSprites; i++) { const s = rt.sprites[4001 + i];
            out.push({name: s.member && s.member.name, x: s.locH, y: s.locV, top: s.top, tint: s.tint, blend: s.blend, visible: s.visible}); }
          return out; })()''')
        ann_colour = bob.evaluate("window.__online.races.colour(window.__online.races.room.players.find(p => p.name === 'Ann').id)")
        check("Bob's map shows Ann's units as ghosts, in her colour", len(ghosts) > 0 and all(g['tint'] == ann_colour and g['visible'] for g in ghosts), str(ghosts[:2]))
        own = bob.evaluate('''(() => { const L = []; const rt = window.__rt; for (let c = 200; c <= 4000; c++) { const s = rt.sprites[c];
          if (s && s.visible && s.member && /^vehicle[.]/.test(s.member.name)) L.push([s.member.name, s.locH, s.locV]); } return L; })()''')
        same = [g for g in ghosts if any(o[0] == g['name'] and abs(o[1] - g['x']) <= 1 and abs(o[2] - g['y']) <= 1 for o in own)]
        check('at the same places as the same units on his own map (the same mission, not yet moved)', len(same) == len(ghosts), '%d of %d' % (len(same), len(ghosts)))
        # Ann drives a truck: click it, then a tile two to the left; her ghost on Bob's map follows
        moved = ann.evaluate('''(() => { const rt = window.__rt;
          const t = [...rt.sprites].filter(s => s && s.visible && s.member && /^vehicle[.]/.test(s.member.name) && s.channel >= 200 && s.channel < 4001)[0];
          const click = (x, y) => { rt.mouse.x = x; rt.mouse.y = y; rt.mouseDown(); rt.step(1); rt.mouseUp(); rt.step(1); };
          click(t.locH, t.locV - 10);
          click(t.locH - 100, t.locV - 10);
          rt.step(90);
          return [t.locH, t.locV]; })()''')
        time.sleep(0.6)
        bob.evaluate('window.__step(2)')
        ghosts = bob.evaluate('''(() => { const rt = window.__rt, r = window.__online.races;
          const out = [];
          for (let i = 0; i < r.ghostSprites; i++) { const s = rt.sprites[4001 + i];
            out.push({name: s.member && s.member.name, x: s.locH, y: s.locV, top: s.top}); }
          return out; })()''')
        own = bob.evaluate('''(() => { const L = []; const rt = window.__rt; for (let c = 200; c <= 4000; c++) { const s = rt.sprites[c];
          if (s && s.visible && s.member && /^vehicle[.]/.test(s.member.name)) L.push([s.member.name, s.locH, s.locV]); } return L; })()''')
        apart = [g for g in ghosts if not any(abs(o[1] - g['x']) <= 2 and abs(o[2] - g['y']) <= 2 for o in own)]
        check("when Ann drives a truck, its ghost leaves Bob's", len(apart) == 1, '%s, Ann now at %s' % (apart, moved))
        g = apart[0] if apart else ghosts[0]
        bob.evaluate('([x, y]) => { const rt = window.__rt; rt.mouse.x = x; rt.mouse.y = y; rt.step(1); }', [g['x'], g['top'] + 8])
        tag = bob.inner_text('#ghost-tag') if bob.is_visible('#ghost-tag') else ''
        check('pointing at a ghost names its player', tag.strip().upper() == 'ANN', repr(tag))
        bob.screenshot(path=os.path.join(a.out, 'ghost.png'))
        bob.evaluate('() => { const rt = window.__rt; rt.mouse.x = 5; rt.mouse.y = 5; rt.step(1); }')
        check('and the tag goes when the pointer does', not bob.is_visible('#ghost-tag'))

        ann.evaluate('window.__step(450)')
        ann.evaluate(REPORT, 'goal')
        ann_ms = ann.evaluate('window.__online.scores.attempt.goal')
        check("Ann's goal reaches Bob, with its time", until(bob, "window.__online.races.room.players.find(p => p.name === 'Ann').goal === %d" % ann_ms), str(ann_ms))
        bob.evaluate('window.__step(60)')
        bob.screenshot(path=os.path.join(a.out, 'hud.png'))
        hud = bob.inner_text('#race-hud')
        check("Bob's corner shows it", ('Ann: goal ' + clock(ann_ms)) in hud, hud.replace('\n', ' | '))

        bob.evaluate(QUIT)
        check('Bob leaving the mission gives up', until(ann, "window.__online.races.room.players.find(p => p.name === 'Bob').quit"))
        check('and the race is over', until(ann, "window.__online.races.room.phase === 'done'"))
        ann.evaluate('window.__online.races.open()')
        msg = ann.inner_text('#race .note')
        check('Ann won', msg.startswith('Ann won, in ' + clock(ann_ms)), msg)
        ann.screenshot(path=os.path.join(a.out, 'done.png'))

        ann.click('#race button:has-text("Race again")')
        check('the host can race again', until(bob, "window.__online.races.room.phase === 'lobby'"))

        for page, who in ((ann, 'Ann'), (bob, 'Bob')):
            errors = page.evaluate('window.__rt.errors')
            check('no script errors for %s' % who, not errors, str(errors[:3]))
        b.close()
    print('%d failed' % len(failures) if failures else 'all passed')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
