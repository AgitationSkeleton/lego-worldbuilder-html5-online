"""The Android app (mobile/) in an emulator or on a phone that adb sees: installs an APK (a debug
build, whose WebView can be inspected), starts it, reaches its page through Chrome's debugging
protocol and checks the game loads from the app's own files, knows it is the Android app (its
version in the settings), plays a random mission, links to share are the website's, and the
score server answers it.  Run by .github/workflows/android-test.yml in an emulator.

    python tools/verify/android.py [--apk mobile/android/app/build/outputs/apk/debug/app-debug.apk]

(A WebView's debugging socket serves its pages, not a whole browser, which Playwright wants: the
page is driven over its own WebSocket, with the protocol's Runtime.evaluate.)  --cdp PORT drives
a page already open in a browser debugging on that port instead, with --url its address's start,
to try the test itself on a computer.
"""

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

import websocket

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
APP = 'xyz.viosarcade.worldbuilderonline'
ap = argparse.ArgumentParser()
ap.add_argument('--apk', default=os.path.join(ROOT, 'mobile', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'))
ap.add_argument('--adb', default='adb')
ap.add_argument('--port', type=int, default=9333)
ap.add_argument('--cdp', type=int, default=0, help='a browser already debugging on this port (no adb)')
ap.add_argument('--url', default='https://localhost', help='the page\'s address starts so')
ap.add_argument('--shots', default=os.path.join(ROOT, 'work'))
args = ap.parse_args()
failures = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what, flush=True)
    if not cond:
        failures.append(what)


def adb(*a):
    r = subprocess.run([args.adb, *a], capture_output=True, text=True)
    if r.returncode:
        print(r.stdout, r.stderr)
    return r.stdout


class Page:
    """A page over Chrome's debugging protocol: evaluate(), wait(), screenshot()."""

    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=120, suppress_origin=True)
        self.n = 0

    def send(self, method, params=None):
        self.n += 1
        self.ws.send(json.dumps({'id': self.n, 'method': method, 'params': params or {}}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get('id') == self.n:
                if 'error' in m:
                    raise RuntimeError(m['error'])
                return m['result']

    def evaluate(self, fn):
        """The value of a JavaScript function (it may be async)."""
        r = self.send('Runtime.evaluate', {'expression': '(' + fn + ')()', 'awaitPromise': True, 'returnByValue': True})
        if 'exceptionDetails' in r:
            raise RuntimeError(r['exceptionDetails'].get('exception', {}).get('description') or r['exceptionDetails'])
        return r['result'].get('value')

    def wait(self, fn, timeout):
        end = time.time() + timeout
        while time.time() < end:
            try:
                if self.evaluate(fn):
                    return True
            except RuntimeError:
                pass
            time.sleep(1)
        return False

    def screenshot(self, path):
        data = self.send('Page.captureScreenshot', {'format': 'png'})['data']
        open(path, 'wb').write(base64.b64decode(data))


os.makedirs(args.shots, exist_ok=True)
port = args.cdp
if not port:
    adb('install', '-r', args.apk)
    adb('shell', 'am', 'force-stop', APP)
    adb('shell', 'am', 'start', '-n', APP + '/.MainActivity')
    # the page's debugging socket: webview_devtools_remote_<pid>
    sock = None
    for _ in range(120):
        m = re.search(r'@(webview_devtools_remote_\d+)', adb('shell', 'cat', '/proc/net/unix'))
        if m:
            sock = m.group(1)
            break
        time.sleep(1)
    check(sock is not None, 'the app starts, and its page can be inspected: %s' % sock)
    if not sock:
        sys.exit(1)
    adb('forward', 'tcp:%d' % args.port, 'localabstract:' + sock)
    port = args.port
target = None
for _ in range(90):
    try:
        targets = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json/list' % port, timeout=10))
        target = next((t for t in targets if t.get('type') == 'page' and t.get('url', '').startswith(args.url)), None)
        if target:
            break
    except Exception:
        pass
    time.sleep(1)
check(target is not None, 'its window shows the game from its own files: %s' % (target and target['url']))
if not target:
    sys.exit(1)
page = Page(target['webSocketDebuggerUrl'])
READY = "() => !!(window.__online && window.__online.menu && window.__rt && window.__rt.started)"
check(page.wait(READY, 300), 'the game loads and the main menu comes up')
if not args.cdp:
    check(page.evaluate("() => !!(window.Capacitor && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android')"), 'the page knows it is the Android app')
page.evaluate("() => window.__online.open()")
time.sleep(2)
note = page.evaluate("() => { const h = [...document.querySelectorAll('.panel h3')].find((x) => x.textContent === 'App'); return h && h.parentElement.textContent; }")
if not args.cdp:
    check(bool(note) and 'The Android app, version' in note, 'the settings show its version: %s' % note)
else:
    print('     (the settings: %s)' % note)
page.evaluate("() => window.__online.close()")
page.screenshot(os.path.join(args.shots, 'android-menu.png'))
code = page.evaluate("() => { const ui = window.__online; ui.openRandom(); ui.newCode(); const c = ui.codeInput.value; ui.playCode(); return c; }")
check(page.wait("() => window.__rt.labelAt(window.__rt.frame) === 'play' && !!window.__online.random.active", 180), 'a random mission plays: %s' % code)
time.sleep(3)
page.screenshot(os.path.join(args.shots, 'android-game.png'))
link = page.evaluate("async () => { const { shareUrl } = await import('./src/online/dom.js'); return shareUrl().href; }")
if not args.cdp:
    check(link.startswith('https://wbonline.viosarcade.xyz/'), 'a link to share is the website\'s: %s' % link)
status = page.evaluate("async () => { try { const r = await fetch('https://wbserver.viosarcade.xyz/scores/overall'); return r.status; } catch (e) { return String(e); } }")
check(status == 200, 'the score server answers the app: %s' % status)
errs = page.evaluate('() => window.__rt.errors.map(String).slice(0, 3)')
check(not errs, 'no script errors %s' % errs)
if not args.cdp:
    adb('forward', '--remove', 'tcp:%d' % args.port)
print('all passed' if not failures else '%d failed' % len(failures))
sys.exit(1 if failures else 0)
