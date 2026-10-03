"""The score tables from the game's side, against a local server (server/: npm run dev):
start a mission, let its clock run, report its goal and bonus as the game's goals do, put
the time on the table under a name, and read the tables back.

    python tools/verify/scores.py --server http://127.0.0.1:8787 --out work/shots/scores

Needs Playwright with Chromium, the repository served over HTTP (the default URL is
http://127.0.0.1:8766/), and the server running.
"""

import argparse
import os
import random
import sys

from playwright.sync_api import sync_playwright

# The game's own report, as goal.goal and goal.bonus send it.
REPORT = """async (kind) => {
  const L = await import(new URL('src/director/lingo.js', location.href).href);
  const rt = window.__rt;
  const wm = L.gp(rt.globals.glob, 'worlds_manager');
  L.mc(wm, 'reportsuccess', L.sym(kind));
}"""

START = """([w, l]) => { const rt = window.__rt; const s = rt.movieHandlers.golevel.script;
  rt.call(rt.scriptSelf(s), s, 'golevel', w, l); }"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://127.0.0.1:8766/')
    ap.add_argument('--server', default='http://127.0.0.1:8787')
    ap.add_argument('--out', default='work/shots/scores')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    failures = []

    def check(what, ok, detail=''):
        print('%s %s%s' % ('ok  ' if ok else 'FAIL', what, (': ' + detail) if detail else ''))
        if not ok:
            failures.append(what)

    name = 'Tester%04d' % random.randrange(10000)
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'])
        page = b.new_page(viewport={'width': 1280, 'height': 720})
        page.goto('%s?test&seed=1&server=%s' % (a.base, a.server))
        page.wait_for_function('window.__rt && window.__rt.started', timeout=60000)
        page.evaluate('window.__step(10)')
        page.evaluate(START, [6, 2])
        # 15 frames a second: 450 frames are 30 seconds by the game's clock
        page.evaluate('window.__step(450)')
        page.evaluate(REPORT, 'goal')
        page.wait_for_selector('#scores-toast form', timeout=5000)
        text = page.inner_text('#scores-toast')
        check('the goal is timed', text.startswith('Goal in 0:30\n'), text.replace('\n', ' | '))
        page.screenshot(path=os.path.join(a.out, 'ask.png'))
        page.fill('#scores-toast input[type=text]', name)
        page.click('#scores-toast button.send')
        page.wait_for_function("document.querySelector('#scores-toast .line') && /#\\d+ of \\d+|could not/.test(document.querySelector('#scores-toast .line').textContent)", timeout=10000)
        line = page.inner_text('#scores-toast .line')
        check('it goes on the table', line.startswith('#'), line)
        page.screenshot(path=os.path.join(a.out, 'sent.png'))
        settings = page.evaluate("JSON.parse(localStorage.getItem('lego-wb-online:settings'))")
        check('the name is remembered', settings.get('name') == name, str(settings))

        # the bonus, 20 seconds later: asked again (not "always"), with the name filled in
        page.evaluate('window.__step(300)')
        page.evaluate(REPORT, 'bonus')
        page.wait_for_selector('#scores-toast form', timeout=5000)
        check('the bonus is timed from the start', 'Bonus in 0:50' in page.inner_text('#scores-toast'))
        check('the name is filled in', page.input_value('#scores-toast input[type=text]') == name)
        page.check('#scores-toast .always input')
        page.click('#scores-toast button.send')
        page.wait_for_function("document.querySelector('#scores-toast .line') && /#\\d+ of \\d+|could not/.test(document.querySelector('#scores-toast .line').textContent)", timeout=10000)
        check('and sent', page.inner_text('#scores-toast .line').startswith('#'))

        # a restart is a new attempt; with "always", sent without asking
        page.evaluate("""() => { const rt = window.__rt; const s = rt.movieHandlers.restartlevel.script;
            rt.call(rt.scriptSelf(s), s, 'restartlevel'); }""")
        page.evaluate('window.__step(600)')
        page.evaluate(REPORT, 'goal')
        page.wait_for_function("document.querySelector('#scores-toast .line') && /#\\d+ of \\d+|could not/.test(document.querySelector('#scores-toast .line').textContent)", timeout=10000)
        t = page.inner_text('#scores-toast')
        check('a restart times again, and "always" sends at once', 'Goal in 0:40' in t and 'your best is 0:30' in t, t.replace('\n', ' | '))

        # the tables, from the toast's link
        page.click('#scores-toast button.link')
        page.wait_for_selector('#scores table', timeout=10000)
        page.screenshot(path=os.path.join(a.out, 'tables.png'))
        mine = page.inner_text('#scores tr.me') if page.query_selector('#scores tr.me') else ''
        check('the tables show the time', name in mine and '0:30' in mine, mine)
        shown = page.eval_on_selector('#scores select:nth-of-type(2)', 'e => e.selectedOptions[0].textContent')
        check('the mission is shown by its name', shown.startswith('2. ') and 'Mission' not in shown, shown)
        page.select_option('#scores select', 'all')
        page.wait_for_function("document.querySelector('#scores th') && document.querySelector('#scores th:nth-child(3)').textContent === 'Goals'", timeout=10000)
        mine = page.inner_text('#scores tr.me') if page.query_selector('#scores tr.me') else ''
        check('and the overall table', name in mine, mine)
        page.screenshot(path=os.path.join(a.out, 'overall.png'))

        # a generated mission has a table of its own
        page.keyboard.press('Escape')
        page.evaluate("""() => { const rt = window.__rt; const s = rt.movieHandlers.quitlevel.script;
            rt.call(rt.scriptSelf(s), s, 'quitlevel'); }""")
        page.evaluate('window.__step(5)')
        problem = page.evaluate("window.__online.random.play('2C-K2Q9')")
        check('a generated mission starts from the world map', problem is None, str(problem))
        page.evaluate('window.__step(300)')
        page.evaluate(REPORT, 'goal')
        page.wait_for_function("document.querySelector('#scores-toast .line') && /#\\d+ of \\d+|could not/.test(document.querySelector('#scores-toast .line').textContent)", timeout=10000)
        check('its time is sent to its own table', page.inner_text('#scores-toast .line').startswith('#'), page.inner_text('#scores-toast'))
        page.click('#scores-toast button.link')
        page.wait_for_selector('#scores table', timeout=10000)
        shown = page.eval_on_selector('#scores select', 'e => e.selectedOptions[0].textContent')
        check('the tables show it', shown == 'Random 2C-K2Q9' and name in page.inner_text('#scores tr.me'), shown)
        done = page.evaluate("window.__online.scores.bests['6.12']")
        check('and it does not count as the template played', done is None, str(done))
        page.keyboard.press('Escape')
        page.evaluate("""() => { const rt = window.__rt; const s = rt.movieHandlers.quitlevel.script;
            rt.call(rt.scriptSelf(s), s, 'quitlevel'); }""")
        page.evaluate('window.__step(5)')

        # the tutorial is not timed
        page.evaluate("document.getElementById('scores-toast').hidden = true")
        page.evaluate(START, [999, 999])
        page.evaluate("""async () => { const L = await import(new URL('src/director/lingo.js', location.href).href);
            const g = window.__rt.globals.glob; L.mc(L.gp(g, 'tutorial_manager'), 'settutorialmode', 1); }""")
        page.evaluate('window.__step(100)')
        page.evaluate(REPORT, 'goal')
        check('the tutorial is not timed', page.evaluate("document.getElementById('scores-toast').hidden"))

        errors = page.evaluate('window.__rt.errors')
        check('no script errors', not errors, str(errors[:3]))
        b.close()
    print('%d failed' % len(failures) if failures else 'all passed')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
