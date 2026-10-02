"""Drive the port in headless Chromium: load a game in test mode, step frames, click,
and save screenshots.  For checking the port by eye and catching script errors.

    python tools/verify/drive.py wb1 --steps 40 --shot work/shots/wb1
    python tools/verify/drive.py wb1 --script "step 30; click 438 378; step 10; shot a"

Needs Playwright with Chromium, and the repository served over HTTP (the default URL is
http://127.0.0.1:8765/, as python -m http.server 8765 gives).
"""

import argparse
import os
import sys

from playwright.sync_api import sync_playwright


def run(game, script, out, base, width, height, seed, headed):
    os.makedirs(out, exist_ok=True)
    logs = []
    with sync_playwright() as p:
        b = p.chromium.launch(headless=not headed, args=['--autoplay-policy=no-user-gesture-required'])
        page = b.new_page(viewport={'width': width, 'height': height})
        page.on('console', lambda m: logs.append('%s: %s' % (m.type, m.text)))
        page.on('pageerror', lambda e: logs.append('pageerror: %s' % e))
        page.goto('%s%s?test&seed=%d' % (base, game + '/' if game else '', seed))
        page.wait_for_function('window.__rt && window.__rt.started', timeout=60000)
        n = 0
        for cmd in script:
            parts = cmd.split()
            if not parts:
                continue
            op = parts[0]
            if op == 'step':
                page.evaluate('n => window.__step(n)', int(parts[1]))
            elif op in ('click', 'down', 'up', 'move'):
                x, y = int(parts[1]), int(parts[2])
                page.evaluate('''([op, x, y]) => {
                    const rt = window.__rt;
                    rt.mouse.x = x; rt.mouse.y = y;
                    if (op === 'move') { rt.rollover(); return; }
                    if (op === 'click' || op === 'down') rt.mouseDown();
                    if (op === 'click' || op === 'up') rt.mouseUp();
                }''', [op, x, y])
            elif op == 'key':
                page.keyboard.press(parts[1])
            elif op == 'shot':
                name = parts[1] if len(parts) > 1 else str(n)
                page.evaluate('window.__step(0)')
                page.screenshot(path=os.path.join(out, name + '.png'))
                n += 1
            elif op == 'eval':
                print(page.evaluate(' '.join(parts[1:])))
            elif op == 'evalfile':
                print(page.evaluate(open(parts[1], encoding='utf-8').read()))
        errors = page.evaluate('window.__rt.errors')
        b.close()
    for l in logs:
        print(l)
    if errors:
        print('SCRIPT ERRORS:', len(errors))
        for e in errors[:20]:
            print(e)
    return 0 if not errors else 1


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('game')
    ap.add_argument('--script', default='step 1; shot start')
    ap.add_argument('--out', default='work/shots')
    ap.add_argument('--base', default='http://127.0.0.1:8765/')
    ap.add_argument('--size', default='610x440')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--headed', action='store_true')
    a = ap.parse_args()
    w, h = map(int, a.size.split('x'))
    sys.exit(run(a.game, a.script.split(';'), a.out, a.base, w, h, a.seed, a.headed))
