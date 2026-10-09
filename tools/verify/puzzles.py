"""Generated missions played to their goal in the game itself: for each code, the mission is
started as a player would start it, and tools/verify/bot.js plays its solution through
the game's own handlers and checks each step and the goal (and bonus goal).

    python tools/verify/puzzles.py --count 24
    python tools/verify/puzzles.py --codes 2AK2Q9X,1CM7T4
    python tools/verify/puzzles.py --count 24 --version 1     (Rando v1's codes)

Needs Playwright with Chromium, and the repository served over HTTP (the default URL is
http://127.0.0.1:8766/).
"""

import argparse
import os
import random
import sys

from playwright.sync_api import sync_playwright

CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://127.0.0.1:8766/')
    ap.add_argument('--count', type=int, default=12)
    ap.add_argument('--codes', default='')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--verbose', action='store_true')
    ap.add_argument('--version', type=int, default=2, help='the generator: 2 (Rando v2) or 1 (Rando v1)')
    a = ap.parse_args()
    rnd = random.Random(a.seed)
    codes = [c.strip() for c in a.codes.split(',') if c.strip()]
    while len(codes) < a.count:
        codes.append('%d%s%s' % (rnd.randint(1, 3), rnd.choice('ABCD' if a.version == 1 else 'ABCDE'),
                                 ''.join(rnd.choice(CHARS) for _ in range(a.version + 3))))
    bot = open(os.path.join(os.path.dirname(__file__), 'bot.js'), encoding='utf-8').read()
    won = 0
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'])
        page = b.new_page(viewport={'width': 1280, 'height': 720})
        page.goto('%s?test&seed=1' % a.base)
        page.wait_for_function('window.__rt && window.__rt.started', timeout=90000)
        page.evaluate('window.__step(10)')
        for code in codes:
            r = page.evaluate('(' + bot + ')(%r)' % code)
            if r['ok']:
                won += 1
            print('%s %s %s%s' % ('won ' if r['ok'] else 'LOST', code, r.get('why', ''),
                                  (' | ' + '; '.join(r['log'])) if a.verbose or not r['ok'] else ''), flush=True)
            if r.get('errors'):
                print('     script errors:', r['errors'][:2])
            page.evaluate("""() => { const rt = window.__rt; const s = rt.movieHandlers.quitlevel.script;
                const g = rt.globals.glob; const i = g.k.findIndex(k => k.key === 'map_display');
                if (i >= 0 && g.v[i] !== undefined) rt.call(rt.scriptSelf(s), s, 'quitlevel'); rt.step(3); }""")
        b.close()
    print('%d of %d won' % (won, len(codes)))
    return 0 if won == len(codes) else 1


if __name__ == '__main__':
    sys.exit(main())
