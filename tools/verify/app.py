"""The app (client/): start it, reach its window through Chromium's debugging port, and check
the game loads from its own files (app://game), the main menu comes up, the page knows it is the
app (its version in the settings), a random mission starts and plays, a link to share is the
website's, and the server answers the app.  With --exe, a built app (client/dist/win-unpacked/
...exe) instead of the one run from the repository.

    python tools/verify/app.py [--exe PATH]
"""

import argparse
import os
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
CLIENT = os.path.join(ROOT, 'client')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--exe', default=None)
    ap.add_argument('--port', type=int, default=9334)
    ap.add_argument('--window', default='3440,40', help='where its window goes (x,y): out of the way')
    args = ap.parse_args()
    # (its window on the second monitor, shown without taking the focus, and muted)
    at = '--test-window=%s' % args.window
    if args.exe:
        cmd = [os.path.abspath(args.exe), '--remote-debugging-port=%d' % args.port, at]
    else:
        cmd = [os.path.join(CLIENT, 'node_modules', 'electron', 'dist', 'electron.exe'), CLIENT, '--remote-debugging-port=%d' % args.port, at]
    # (An editor built on Electron may have set ELECTRON_RUN_AS_NODE for what it runs: then
    # Electron is only Node.)
    env = dict(os.environ)
    env.pop('ELECTRON_RUN_AS_NODE', None)
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
    failures = []

    def check(cond, what):
        print(('ok   ' if cond else 'FAIL ') + what, flush=True)
        if not cond:
            failures.append(what)

    try:
        with sync_playwright() as pw:
            browser = None
            for _ in range(60):
                try:
                    browser = pw.chromium.connect_over_cdp('http://127.0.0.1:%d' % args.port)
                    break
                except Exception:
                    time.sleep(0.5)
            check(browser is not None, 'the app starts')
            page = None
            for _ in range(60):
                pages = [p for c in browser.contexts for p in c.pages]
                page = next((p for p in pages if p.url.startswith('app://')), None)
                if page:
                    break
                time.sleep(0.5)
            check(page is not None and page.url.startswith('app://game/'), 'its window shows the game from its own files: %s' % (page and page.url))
            page.wait_for_function('() => window.__online && window.__online.menu && window.__rt && window.__rt.started', timeout=120000)
            check(True, 'the game loads and the main menu comes up')
            version = page.evaluate('() => window.worldbuilderApp && worldbuilderApp.version')
            check(bool(version), 'the page knows it is the app: version %s' % version)
            note = page.evaluate("""() => { const ui = window.__online; ui.open();
                const s = [...document.querySelectorAll('.panel h3')].find((h) => h.textContent === 'App');
                return s ? s.parentElement.textContent : null; }""")
            check(bool(note) and version in note, 'the settings show the app\'s version: %s' % note)
            page.screenshot(path=os.path.join(ROOT, 'work', 'app-settings.png'))
            page.evaluate('() => window.__online.close()')
            # a random mission, as a player would start one
            code = page.evaluate("""() => { const ui = window.__online; ui.openRandom(); ui.newCode(); const c = ui.codeInput.value; ui.playCode(); return c; }""")
            ok = False
            for _ in range(120):
                if page.evaluate("() => window.__rt.labelAt(window.__rt.frame) === 'play' && !!window.__online.random.active"):
                    ok = True
                    break
                time.sleep(0.5)
            check(ok, 'a random mission plays: %s' % code)
            time.sleep(3)
            page.screenshot(path=os.path.join(ROOT, 'work', 'app-game.png'))
            link = page.evaluate("""async () => { const { shareUrl } = await import('app://game/src/online/dom.js'); const u = shareUrl(); u.search = '?random=x'; return u.href; }""")
            check(link.startswith('https://wbonline.viosarcade.xyz/'), 'a link to share is the website\'s: %s' % link)
            status = page.evaluate("""async () => { try { const r = await fetch('https://wbserver.viosarcade.xyz/scores/overall'); return r.status; } catch (e) { return String(e); } }""")
            check(status == 200, 'the server answers the app (its overall score table): %s' % status)
            errs = page.evaluate('() => window.__rt.errors.map(String).slice(0, 3)')
            check(not errs, 'no script errors %s' % errs)
            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except Exception:
            proc.kill()
    print('all passed' if not failures else '%d failed' % len(failures))
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
