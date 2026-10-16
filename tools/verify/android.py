"""The Android app (mobile/) in an emulator or on a phone that adb sees: installs an APK (a debug
build, whose WebView can be inspected), starts it, reaches its page through Chrome's debugging
protocol and checks the game loads from the app's own files, knows it is the Android app (its
version in the settings), plays a random mission, links to share are the website's, and the
score server answers it.  Run by .github/workflows/android-test.yml in an emulator.

    python tools/verify/android.py [--apk mobile/android/app/build/outputs/apk/debug/app-debug.apk]
"""

import argparse
import os
import re
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
APP = 'xyz.viosarcade.worldbuilderonline'
ap = argparse.ArgumentParser()
ap.add_argument('--apk', default=os.path.join(ROOT, 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'))
ap.add_argument('--adb', default='adb')
ap.add_argument('--port', type=int, default=9333)
ap.add_argument('--shots', default=os.path.join(ROOT, 'work'))
args = ap.parse_args()
failures = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what, flush=True)
    if not cond:
        failures.append(what)


def adb(*a, check_=True):
    r = subprocess.run([args.adb, *a], capture_output=True, text=True)
    if check_ and r.returncode:
        print(r.stdout, r.stderr)
    return r.stdout


os.makedirs(args.shots, exist_ok=True)
adb('install', '-r', args.apk)
adb('shell', 'am', 'force-stop', APP)
adb('shell', 'am', 'start', '-n', APP + '/.MainActivity')
# the page's debugging socket: webview_devtools_remote_<pid>
sock = None
for _ in range(120):
    m = re.search(r'@(webview_devtools_remote_\d+)', adb('shell', 'cat', '/proc/net/unix', check_=False))
    if m:
        sock = m.group(1)
        break
    time.sleep(1)
check(sock is not None, 'the app starts, and its page can be inspected: %s' % sock)
if not sock:
    sys.exit(1)
adb('forward', 'tcp:%d' % args.port, 'localabstract:' + sock)
READY = "() => window.__online && window.__online.menu && window.__rt && window.__rt.started"
with sync_playwright() as p:
    browser = None
    for _ in range(60):
        try:
            browser = p.chromium.connect_over_cdp('http://127.0.0.1:%d' % args.port)
            break
        except Exception:
            time.sleep(1)
    page = None
    for _ in range(60):
        pages = [pg for c in browser.contexts for pg in c.pages if pg.url.startswith('https://localhost')]
        if pages:
            page = pages[0]
            break
        time.sleep(1)
    check(page is not None, 'its window shows the game from its own files: %s' % (page and page.url))
    page.wait_for_function(READY, timeout=240000)
    check(True, 'the game loads and the main menu comes up')
    check(page.evaluate("() => !!(window.Capacitor && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android')"), 'the page knows it is the Android app')
    page.evaluate("() => window.__online.open()")
    page.wait_for_timeout(1500)
    note = page.evaluate("() => { const h = [...document.querySelectorAll('.panel h3')].find((x) => x.textContent === 'App'); return h && h.parentElement.textContent; }")
    check(bool(note) and 'The Android app, version' in note, 'the settings show its version: %s' % note)
    page.evaluate("() => window.__online.close()")
    page.screenshot(path=os.path.join(args.shots, 'android-menu.png'))
    code = page.evaluate("() => { const ui = window.__online; ui.openRandom(); ui.newCode(); const c = ui.codeInput.value; ui.playCode(); return c; }")
    try:
        page.wait_for_function("() => window.__rt.labelAt(window.__rt.frame) === 'play' && !!window.__online.random.active", timeout=120000)
        check(True, 'a random mission plays: %s' % code)
    except Exception:
        check(False, 'a random mission plays: %s' % code)
    page.wait_for_timeout(3000)
    page.screenshot(path=os.path.join(args.shots, 'android-game.png'))
    link = page.evaluate("""async () => { const { shareUrl } = await import('./src/online/dom.js'); return shareUrl().href; }""")
    check(link.startswith('https://wbonline.viosarcade.xyz/'), 'a link to share is the website\'s: %s' % link)
    status = page.evaluate("""async () => { try { const r = await fetch('https://wbserver.viosarcade.xyz/scores/overall'); return r.status; } catch (e) { return String(e); } }""")
    check(status == 200, 'the score server answers the app: %s' % status)
    errs = page.evaluate('() => window.__rt.errors.map(String).slice(0, 3)')
    check(not errs, 'no script errors %s' % errs)
    browser.close()
adb('forward', '--remove', 'tcp:%d' % args.port, check_=False)
print('all passed' if not failures else '%d failed' % len(failures))
sys.exit(1 if failures else 0)
