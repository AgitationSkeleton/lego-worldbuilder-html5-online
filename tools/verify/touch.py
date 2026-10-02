"""Play the online game with a finger, in headless Chromium with touch: drag the map, tap
the menu button, hold a scroll arrow, and check that each did what it should.

    python tools/verify/touch.py --size 844x390 --out work/shots/touch

Needs Playwright with Chromium, and the repository served over HTTP (the default URL is
http://127.0.0.1:8766/).
"""

import argparse
import json
import os
import sys

from playwright.sync_api import sync_playwright

# What the test reads from the game: the map view's position, whether the menu is up,
# and the error count.
STATE = """(() => {
  const rt = window.__rt;
  const glob = rt.globals.glob;
  const get = (pl, name) => { const i = pl.k.findIndex(s => s.key && s.key.toLowerCase() === name); return i >= 0 ? pl.v[i] : undefined; };
  const md = get(glob, 'map_display');
  const plain = (v) => v && v.a ? v.a.map(plain) : v && v.h !== undefined ? [v.h, v.v] : v;
  const menu = rt.sprites[130];
  return {
    frame: rt.frame,
    topLeft: md ? plain(md.$.pdisplaytiletopleft) : null,
    pixel: md ? plain(md.$.pdisplaypixelscroll) : null,
    menuShown: !!(menu && menu.visible && menu.locV > -1000 && menu.locH > -1000 && menu.locV < rt.stage.height),
    errors: rt.errors.length,
  };
})()"""

# Where a fixed tile of the map is drawn, in stage pixels.
PROBE = """async () => {
  const L = await import(new URL('src/director/lingo.js', location.href).href);
  const rt = window.__rt;
  const glob = rt.globals.glob;
  const md = L.gp(glob, 'map_display');
  const p = L.mc(md, 'postoloc', new L.LPoint(8, 6));
  return [p.h, p.v];
}"""

# Page coordinates of a point on the stage.
TO_PAGE = """([x, y]) => {
  const r = window.__rt.renderer, box = window.__rt.box;
  const bx = box ? box.x : 0, by = box ? box.y : 0;
  return [((x + bx) * r.scale + r.ox) / r.dpr, ((y + by) * r.scale + r.oy) / r.dpr];
}"""


class Finger:
    def __init__(self, page):
        self.page = page
        self.cdp = page.context.new_cdp_session(page)

    def _send(self, kind, x, y):
        pts = [] if kind == 'touchEnd' else [{'x': x, 'y': y, 'id': 1}]
        self.cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': pts})

    def drag(self, x0, y0, x1, y1, steps=10):
        self._send('touchStart', x0, y0)
        for i in range(1, steps + 1):
            self._send('touchMove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
        self._send('touchEnd', x1, y1)

    def tap(self, x, y):
        self._send('touchStart', x, y)
        self._send('touchEnd', x, y)

    def pinch(self, cx, cy, d0, d1, steps=8):
        # two fingers either side of (cx, cy), from d0 apart to d1
        def pts(d):
            return [{'x': cx - d / 2, 'y': cy, 'id': 1}, {'x': cx + d / 2, 'y': cy, 'id': 2}]
        self.cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': pts(d0)[:1]})
        self.cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': pts(d0)})
        for i in range(1, steps + 1):
            self.cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': pts(d0 + (d1 - d0) * i / steps)})
        self.cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})

    def hold(self, x, y, frames):
        self._send('touchStart', x, y)
        self.page.evaluate('n => window.__step(n)', frames)
        self._send('touchEnd', x, y)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://127.0.0.1:8766/')
    ap.add_argument('--size', default='844x390')
    ap.add_argument('--out', default='work/shots/touch')
    ap.add_argument('--mission', default='2.4')
    a = ap.parse_args()
    w, h = map(int, a.size.split('x'))
    world, level = (int(n) for n in a.mission.split('.'))
    os.makedirs(a.out, exist_ok=True)
    failures = []

    def check(what, ok, detail):
        print('%s %s: %s' % ('ok  ' if ok else 'FAIL', what, detail))
        if not ok:
            failures.append(what)

    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'])
        ctx = b.new_context(viewport={'width': w, 'height': h}, has_touch=True, is_mobile=True, device_scale_factor=2)
        page = ctx.new_page()
        page.goto('%s?test&seed=1' % a.base)
        page.wait_for_function('window.__rt && window.__rt.started', timeout=60000)
        page.evaluate('window.__step(10)')
        page.evaluate("""([w, l]) => { const rt = window.__rt; const s = rt.movieHandlers.golevel.script;
            rt.call(rt.scriptSelf(s), s, 'golevel', w, l); }""", [world, level])
        page.evaluate('window.__step(30)')
        finger = Finger(page)
        st = page.evaluate(STATE)
        page.screenshot(path=os.path.join(a.out, 'start.png'))

        # a drag on the map moves the view with the finger
        cx, cy = page.evaluate(TO_PAGE, [450, 250])
        finger.drag(cx, cy, cx - 120, cy - 90)
        page.evaluate('window.__step(1)')
        st2 = page.evaluate(STATE)
        check('drag scrolls the map', (st2['topLeft'], st2['pixel']) != (st['topLeft'], st['pixel']),
              '%s %s -> %s %s' % (st['topLeft'], st['pixel'], st2['topLeft'], st2['pixel']))
        page.screenshot(path=os.path.join(a.out, 'dragged.png'))

        # the map moves with the finger, down and across, despite its skewed rows
        p0 = page.evaluate(PROBE)
        fx, fy = page.evaluate(TO_PAGE, [450, 250])
        fx2, fy2 = page.evaluate(TO_PAGE, [450 + 37, 250 + 81])
        finger.drag(fx, fy, fx2, fy2, steps=7)
        page.evaluate('window.__step(1)')
        p1 = page.evaluate(PROBE)
        moved = (p1[0] - p0[0], p1[1] - p0[1])
        # (unless the map is shorter than the view, when it stays put up and down)
        check('the map stays under the finger', abs(moved[0] - 37) <= 2 and (abs(moved[1] - 81) <= 2 or moved[1] == 0),
              'finger moved (37, 81), a tile moved %s' % (moved,))
        finger.drag(fx2, fy2, fx, fy, steps=7)
        page.evaluate('window.__step(1)')

        # dragging back returns it to where it was, give or take the clamp at the edges
        finger.drag(cx - 120, cy - 90, cx, cy)
        page.evaluate('window.__step(1)')
        st3 = page.evaluate(STATE)
        check('drag back returns', st3['topLeft'] == st['topLeft'], '%s -> %s' % (st2['topLeft'], st3['topLeft']))

        # holding the east scroll arrow scrolls; the arrow is sprite 21
        arrow = page.evaluate('(() => { const s = window.__rt.sprites[21]; return [s.locH, s.locV]; })()')
        ax, ay = page.evaluate(TO_PAGE, arrow)
        before = page.evaluate(STATE)['topLeft']
        finger.hold(ax, ay, 20)
        page.evaluate('window.__step(5)')
        after = page.evaluate(STATE)['topLeft']
        check('holding an arrow scrolls', after != before, '%s -> %s' % (before, after))
        moved = page.evaluate(STATE)['topLeft']
        page.evaluate('window.__step(20)')
        check('letting go of it stops', page.evaluate(STATE)['topLeft'] == moved, 'still at %s' % moved)

        # a tap on the menu button opens the menu; sprite 7 is the menu button
        btn = page.evaluate('(() => { const s = window.__rt.sprites[7]; return [s.locH, s.locV, s.member.name]; })()')
        bx, by = page.evaluate(TO_PAGE, btn[:2])
        finger.tap(bx, by)
        page.evaluate('window.__step(10)')
        page.screenshot(path=os.path.join(a.out, 'menu.png'))
        check('a tap on %s opens the menu' % btn[2], page.evaluate(STATE)['menuShown'], '')

        # two fingers pinch the interface: together, smaller (more map); apart, bigger again
        size = lambda: page.evaluate('[window.__rt.stage.width, window.__rt.stage.height, window.__rt.renderer.scale / window.__rt.renderer.dpr]')
        before = size()
        # (in the middle of the window, the fingers on it however narrow it is)
        mx, my = w / 2, h / 2
        d0 = min(300, w * 0.7)
        finger.pinch(mx, my, d0, d0 / 2)
        page.evaluate('window.__step(1)')
        smaller = size()
        check('pinching in shrinks the interface, showing more map', smaller[2] < before[2] - 0.1 and smaller[0] > before[0],
              '%s -> %s' % (before, smaller))
        finger.pinch(mx, my, d0 / 2, d0)
        page.evaluate('window.__step(1)')
        bigger = size()
        check('pinching out grows it again', abs(bigger[2] - min(before[2], smaller[2] * 2)) < 0.05, '%s -> %s' % (smaller, bigger))

        errors = page.evaluate('window.__rt.errors')
        check('no script errors', not errors, json.dumps(errors[:3]))
        b.close()
    print('%d failed' % len(failures) if failures else 'all passed')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
