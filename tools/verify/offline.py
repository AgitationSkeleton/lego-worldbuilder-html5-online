"""The game as an installed web app (manifest.webmanifest, sw.js, src/online/offline.js): the
browser finds it installable, the service worker keeps this version's files from the first
visit, the game then starts and plays a random mission with the network cut off, the files of
an older version are let go, and the settings say how to install it.

    python tools/verify/offline.py [--base URL]      (the repository served over HTTP)
"""

import argparse
import sys

from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://127.0.0.1:8766/')
args = ap.parse_args()
failures = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what, flush=True)
    if not cond:
        failures.append(what)


KEPT = """async () => { const c = await caches.open('wbonline-v1'); return (await c.keys()).map((r) => r.url); }"""
WANTED = """() => { const files = new Set(Object.values(JSON.parse(document.querySelector('script[type="importmap"]').textContent).imports).map((u) => new URL(u, document.baseURI).href));
  for (const [p, v] of Object.entries(window.__files)) files.add(new URL(p + '?v=' + v, document.baseURI).href);
  return [...files]; }"""
READY = "() => window.__online && window.__online.menu && window.__rt && window.__rt.started"

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 720})
    pg = ctx.new_page()
    pg.goto(args.base + '?seed=1')
    pg.wait_for_function(READY, timeout=120000)
    cdp = ctx.new_cdp_session(pg)
    errs = cdp.send('Page.getInstallabilityErrors').get('installabilityErrors', [])
    check(not errs, 'the browser finds it installable %s' % errs)
    manifest = cdp.send('Page.getAppManifest')
    check(not manifest.get('errors'), 'its manifest has no errors %s' % manifest.get('errors'))
    pg.wait_for_function("() => navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready", timeout=30000)
    wanted = pg.evaluate(WANTED)
    ok = False
    for _ in range(120):
        kept = set(pg.evaluate(KEPT))
        if all(u in kept for u in wanted):
            ok = True
            break
        pg.wait_for_timeout(500)
    check(ok, 'the service worker keeps all %d of this version\'s files from the first visit' % len(wanted))
    # the network cut off: the game starts from what was kept, and a random mission plays
    ctx.set_offline(True)
    pg.goto(args.base + '?seed=1')
    try:
        pg.wait_for_function(READY, timeout=120000)
        check(True, 'offline, the game starts')
    except Exception as e:
        check(False, 'offline, the game starts: %s' % e)
    code = pg.evaluate("""() => { const ui = window.__online; ui.openRandom(); ui.newCode(); const c = ui.codeInput.value; ui.playCode(); return c; }""")
    try:
        pg.wait_for_function("() => window.__rt.labelAt(window.__rt.frame) === 'play' && !!window.__online.random.active", timeout=60000)
        check(True, 'offline, a random mission plays: %s' % code)
    except Exception:
        check(False, 'offline, a random mission plays: %s' % code)
    pg.goto(args.base + '?random=' + code)
    try:
        pg.wait_for_function(READY, timeout=120000)
        check(True, 'offline, a link with ?random= opens it too')
    except Exception:
        check(False, 'offline, a link with ?random= opens it too')
    ctx.set_offline(False)
    # an older version's file let go when this one says what it keeps
    pg.evaluate("""async () => { const c = await caches.open('wbonline-v1'); await c.put(new URL('src/main.js?v=0000000000', document.baseURI).href, new Response('old'));
        const reg = await navigator.serviceWorker.ready; reg.active.postMessage({ type: 'keep', files: [] }); }""")
    pg.wait_for_timeout(1500)
    check(not any('v=0000000000' in u for u in pg.evaluate(KEPT)), 'a file of an older version is let go')
    pg.evaluate("() => window.__online.open()")
    text = pg.evaluate("() => { const h = [...document.querySelectorAll('.panel h3')].find((x) => x.textContent === 'App'); return h && h.parentElement.textContent; }")
    check(bool(text) and 'install' in text.lower(), 'the settings say how to install it: %s' % text)
    pg.screenshot(path='work/offline-settings.png')
    errs = pg.evaluate('() => window.__rt.errors.map(String).slice(0, 2)')
    check(not errs, 'no script errors %s' % errs)
    b.close()
print('all passed' if not failures else '%d failed' % len(failures))
sys.exit(1 if failures else 0)
