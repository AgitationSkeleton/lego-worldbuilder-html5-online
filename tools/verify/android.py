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


def find_page(port, timeout=90):
    """The page's target from the debugging port's list, once there is one."""
    for _ in range(timeout):
        try:
            targets = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json/list' % port, timeout=10))
            t = next((t for t in targets if t.get('type') == 'page' and t.get('url', '').startswith(args.url) and t.get('webSocketDebuggerUrl')), None)
            if t:
                return t
        except Exception:
            pass
        time.sleep(1)
    return None


class Page:
    """A page over Chrome's debugging protocol: evaluate(), wait(), screenshot().  (Should the page
    be replaced as the app starts, and its socket close, the new one is found and used.)"""

    def __init__(self, port):
        self.port = port
        self.ws = None
        self.n = 0
        self.connect()

    def connect(self):
        t = find_page(self.port)
        if not t:
            raise RuntimeError('no page')
        self.ws = websocket.create_connection(t['webSocketDebuggerUrl'], timeout=120, suppress_origin=True)

    def send(self, method, params=None):
        for attempt in range(5):
            try:
                self.n += 1
                self.ws.send(json.dumps({'id': self.n, 'method': method, 'params': params or {}}))
                while True:
                    m = json.loads(self.ws.recv())
                    if m.get('id') == self.n:
                        if 'error' in m:
                            raise RuntimeError(m['error'])
                        return m['result']
            except (websocket.WebSocketException, ConnectionError, OSError):
                time.sleep(2)
                self.connect()
        raise RuntimeError("the page's socket keeps closing")

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
target = find_page(port)
check(target is not None, 'its window shows the game from its own files: %s' % (target and target['url']))
if not target:
    sys.exit(1)
page = Page(port)
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
if not args.cdp:
    # landscape, the phone held upright; upright too with Allow Portrait on (MainActivity.java)
    adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '0')
    check(page.wait('() => innerWidth > innerHeight', 30), 'it opens in landscape, the phone held upright')
    png = subprocess.run([args.adb, 'exec-out', 'screencap', '-p'], capture_output=True).stdout
    open(os.path.join(args.shots, 'android-landscape.png'), 'wb').write(png)
    def screen(label):
        # (a choice of the settings' Screen, clicked as a player would)
        return page.evaluate("""() => { window.__online.open();
          const b = [...document.querySelectorAll('.panel button')].find((x) => x.textContent === '%s');
          if (!b) return false; b.click(); window.__online.close(); return true; }""" % label)
    check(screen('Portrait') is True, "the settings have the screen's choices")
    check(page.wait('() => innerHeight > innerWidth', 30), 'Portrait: it turns upright')
    screen('Turn with phone')
    check(page.wait('() => innerHeight > innerWidth', 30), 'Turn with phone: upright, as the phone is held')
    screen('Landscape')
    check(page.wait('() => innerWidth > innerHeight', 30), 'Landscape: landscape again')
    check(page.evaluate("() => JSON.parse(localStorage.getItem('lego-wb-online:settings')).orientation") == 'landscape', 'the choice is kept with the settings')
page.screenshot(os.path.join(args.shots, 'android-menu.png'))
code = page.evaluate("() => { const ui = window.__online; ui.openRandom(); ui.newCode(); const c = ui.codeInput.value; ui.playCode(); return c; }")
check(page.wait("() => window.__rt.labelAt(window.__rt.frame) === 'play' && !!window.__online.random.active", 180), 'a random mission plays: %s' % code)
time.sleep(3)
page.screenshot(os.path.join(args.shots, 'android-game.png'))
# (a debugger's picture of a WebView may leave out its canvas: the canvas's own pixels, and the
# phone's screen as it shows)
drawn = page.evaluate("""() => { const c = document.getElementById('stage'); const t = document.createElement('canvas');
  t.width = 64; t.height = 64; const g = t.getContext('2d'); g.drawImage(c, 0, 0, 64, 64);
  const d = g.getImageData(0, 0, 64, 64).data; let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
  return lit / (64 * 64); }""")
check(drawn > 0.3, 'the mission is drawn on the game\'s canvas (%d%% of it lit)' % round(drawn * 100))
if not args.cdp:
    png = subprocess.run([args.adb, 'exec-out', 'screencap', '-p'], capture_output=True).stdout
    open(os.path.join(args.shots, 'android-screen.png'), 'wb').write(png)
link = page.evaluate("async () => { const { shareUrl } = await import('./src/online/dom.js'); return shareUrl().href; }")
if not args.cdp:
    check(link.startswith('https://wbonline.viosarcade.xyz/'), 'a link to share is the website\'s: %s' % link)
status = page.evaluate("async () => { try { const r = await fetch('https://wbserver.viosarcade.xyz/scores/overall'); return r.status; } catch (e) { return String(e); } }")
check(status == 200, 'the score server answers the app: %s' % status)
errs = page.evaluate('() => window.__rt.errors.map(String).slice(0, 3)')
check(not errs, 'no script errors %s' % errs)
if not args.cdp:
    adb('forward', '--remove', 'tcp:%d' % args.port)
    if failures:
        # (what the app and its page said, for the failure)
        log = adb('logcat', '-d', '-s', 'Capacitor:*', 'Capacitor/Console:*', 'chromium:*', 'AndroidRuntime:*')
        for line in log.splitlines()[-80:]:
            print(line)
print('all passed' if not failures else '%d failed' % len(failures))
sys.exit(1 if failures else 0)
