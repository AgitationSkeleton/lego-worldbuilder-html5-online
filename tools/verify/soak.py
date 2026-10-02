"""Random input on every mission, to shake out script errors.

    python tools/verify/soak.py wb1 --frames 1500
    python tools/verify/soak.py wb2 --missions 1.1,1.2 --frames 3000

Each mission is started directly (the game's own golevel), then gets random clicks,
drags and arrow keys, a frame at a time.  Script errors are counted and printed.
Needs the repository served at --base (python -m http.server 8765).
"""

import argparse
import json
import time
import random
import sys

from playwright.sync_api import sync_playwright

MISSIONS = {
    'wb1': [(w, l) for w in (1, 2, 3, 4, 5) for l in range(1, 13)],
    'wb2': [(w, l) for w in (1, 2) for l in range(1, 13)],
    'merged': [(w, l) for w in range(1, 8) for l in range(1, 13)],
}

START = '''([w, l]) => {
  const rt = window.__rt;
  const s = rt.movieHandlers.golevel.script;
  rt.errors.length = 0;
  // skip the tutorial: World 1 Mission 1 would start it from the icon, not from golevel
  rt.call(rt.scriptSelf(s), s, 'golevel', w, l);
  return rt.frame;
}'''

QUIT = '''() => {
  const rt = window.__rt;
  const s = rt.movieHandlers.quitlevel.script;
  // random clicks may have ended the mission already, through its own menu
  const glob = rt.globals.glob;
  const i = glob.k.findIndex(k => k.key === 'map_display');
  if (i >= 0 && glob.v[i] !== undefined) rt.call(rt.scriptSelf(s), s, 'quitlevel');
  rt.step(2);
  return rt.frame;
}'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('game')
    ap.add_argument('--frames', type=int, default=1500)
    ap.add_argument('--missions', default='')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--base', default='http://127.0.0.1:8765/')
    ap.add_argument('--verbose', action='store_true')
    ap.add_argument('--size', default='610x440', help='window size, WxH')
    a = ap.parse_args()
    missions = MISSIONS[a.game]
    if a.missions:
        missions = [tuple(int(x) for x in m.split('.')) for m in a.missions.split(',')]
    rnd = random.Random(a.seed)
    total = 0
    seen = {}
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'])
        vw, vh = (int(n) for n in a.size.split('x'))
        page = b.new_page(viewport={'width': vw, 'height': vh})
        path = '' if a.game == 'merged' else a.game + '/'
        page.goto('%s%s?test&seed=%d' % (a.base, path, a.seed))
        page.wait_for_function('window.__rt && window.__rt.started', timeout=60000)
        page.evaluate('window.__step(10)')
        for (w, l) in missions:
            frame = page.evaluate(START, [w, l])
            page.evaluate('window.__step(5)')
            batch = []
            for i in range(a.frames):
                r = rnd.random()
                if r < 0.10:
                    x, y = rnd.randrange(0, 610), rnd.randrange(0, 440)
                    batch.append(['click', x, y])
                elif r < 0.13:
                    batch.append(['key', rnd.choice([123, 124, 125, 126, 49])])
                elif r < 0.30:
                    batch.append(['move', rnd.randrange(0, 610), rnd.randrange(0, 440)])
                batch.append(['step'])
                if len(batch) > 200:
                    t0 = time.time()
                    page.evaluate(RUN, batch)
                    if a.verbose:
                        print('  frames to %d: %.1fs' % (i, time.time() - t0), flush=True)
                    batch = []
            if batch:
                page.evaluate(RUN, batch)
            errs = page.evaluate('window.__rt.errors.slice()')
            total += len(errs)
            for e in errs:
                key = e.split('\n')[0] + ' | ' + (e.split('\n')[2].strip() if len(e.split('\n')) > 2 else '')
                seen.setdefault(key, []).append('%d.%d' % (w, l))
            print('mission %d.%d: frame %s, %d errors' % (w, l, frame, len(errs)), flush=True)
            page.evaluate(QUIT)
        b.close()
    for k, v in sorted(seen.items(), key=lambda kv: -len(kv[1])):
        print('%4d  %s  (%s)' % (len(v), k, ' '.join(sorted(set(v))[:8])))
    return 1 if total else 0


RUN = '''(batch) => {
  const rt = window.__rt;
  for (const c of batch) {
    if (c[0] === 'step') { rt.step(1); continue; }
    if (c[0] === 'move') { rt.mouse.x = c[1]; rt.mouse.y = c[2]; rt.rollover(); continue; }
    if (c[0] === 'click') { rt.mouse.x = c[1]; rt.mouse.y = c[2]; rt.mouseDown(); rt.step(1); rt.mouseUp(); continue; }
    if (c[0] === 'key') {
      rt.keyInfo.keyCode = c[1];
      rt.keyInfo.key = c[1] === 49 ? ' ' : '';
      if (!rt.sendFrameScript('keydown', [])) rt.sendMovie('keydown');
    }
  }
}'''

if __name__ == '__main__':
    sys.exit(main())
