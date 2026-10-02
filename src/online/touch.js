// Touch: the games were played with a mouse, so a finger stands in for it.
//
// - On the interface (buttons, the plans bar, the panel, the scroll arrows) a touch is the
//   mouse: down when the finger lands, up when it lifts, so holding a scroll arrow scrolls.
// - On the map, what the finger does decides it once it is clear: lifted where it landed,
//   a click there (a unit chosen, a place to go); moved, the map follows the finger
//   (scrollmap's pixel scroll); held still, what the mouse resting there would show
//   (a goal's wants, a pile's bricks), without a click.
//
// The pointer stays where the finger last was, so whatever hovering showed stays shown
// until the next touch.
//
// Two fingers pinch: the interface grows or shrinks with them (options.pinch), as the
// settings' interface size does, for the visit.  Whatever the first finger had begun is
// let go without a click.

import * as L from '../director/lingo.js';

const DRAG_START = 10;      // CSS pixels the finger moves before it is a drag
const HOLD_MS = 450;        // held this long without moving: hover only
const MAP_CHANNELS = 200;   // the map's tiles and everything on it are in channels 200 up
const SKY = 1;              // the sky behind the map

export function installTouch(rt, canvas, options = {}) {
  let touch = null;         // the finger being followed: { id, x0, y0, sx, sy, cx, cy, mode, timer }
  let second = null;        // a second finger, pinching: { id, cx, cy }
  let pinch = null;         // { d0, s0 }: the fingers' first distance, the scale then

  const stagePos = (e) => rt.renderer.toStage(e.clientX, e.clientY);
  const mapDisplay = () => {
    const glob = rt.globals.glob;
    if (!glob || rt.labelAt(rt.frame) !== 'play') return null;
    const md = L.gp(glob, 'map_display');
    return md instanceof L.LInstance ? md : null;
  };

  function down(e) {
    if (e.pointerType !== 'touch') return;
    e.stopPropagation();
    e.preventDefault();
    rt.sound.resume();
    canvas.focus();
    if (touch) {
      if (!second && options.pinch && touch.mode !== 'ignore') startPinch(e);
      return;
    }
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const [x, y] = stagePos(e);
    rt.mouse.x = x;
    rt.mouse.y = y;
    rt.rollover();
    // on the map: whatever is drawn there is the map, what is on it, or the sky behind it
    const top = rt.spriteAt(x, y, true);
    const onMap = (top === 0 || top === SKY || top >= MAP_CHANNELS) && !!mapDisplay();
    touch = { id: e.pointerId, x0: e.clientX, y0: e.clientY, sx: x, sy: y, cx: e.clientX, cy: e.clientY, mode: onMap ? 'pending' : 'mouse', timer: 0 };
    if (onMap) {
      touch.timer = setTimeout(() => { if (touch && touch.mode === 'pending') touch.mode = 'hover'; }, HOLD_MS);
    } else {
      rt.mouseDown();
    }
  }

  function startPinch(e) {
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    clearTimeout(touch.timer);
    if (touch.mode === 'mouse') {
      // let go of what the first finger pressed, without a click
      rt.mouse.x = -10000;
      rt.mouse.y = -10000;
      rt.mouseUp();
    }
    touch.mode = 'pinch';
    second = { id: e.pointerId, cx: e.clientX, cy: e.clientY };
    pinch = { d0: Math.max(1, Math.hypot(second.cx - touch.cx, second.cy - touch.cy)), s0: options.pinch.get() };
  }

  function move(e) {
    if (e.pointerType !== 'touch') return;
    e.stopPropagation();
    if (second && e.pointerId === second.id) {
      second.cx = e.clientX;
      second.cy = e.clientY;
    } else if (touch && e.pointerId === touch.id) {
      touch.cx = e.clientX;
      touch.cy = e.clientY;
    }
    if (pinch && touch && second) {
      options.pinch.set(pinch.s0 * Math.hypot(second.cx - touch.cx, second.cy - touch.cy) / pinch.d0);
      return;
    }
    if (!touch || e.pointerId !== touch.id || touch.mode === 'ignore') return;
    const [x, y] = stagePos(e);
    if (touch.mode === 'pending' && Math.hypot(e.clientX - touch.x0, e.clientY - touch.y0) >= DRAG_START) {
      touch.mode = 'drag';
      clearTimeout(touch.timer);
    }
    if (touch.mode === 'drag') {
      const md = mapDisplay();
      if (md) {
        // The map's rows are skewed, so scrolling it up or down moves it sideways too, by
        // half as much, unless it stopped at an edge.  It is scrolled up or down first,
        // then across by whatever keeps it under the finger.
        const dx = x - touch.sx, dy = y - touch.sy;
        if (dx || dy) {
          try {
            const where = () => L.mc(md, 'postoloc', new L.LPoint(0, 0));
            const before = where();
            // scrollmapManual stops the view following a unit
            L.mc(md, 'scrollmapmanual', L.list([0, 0]));
            if (dy) moveMap(md, 0, dy);
            const across = before.h + dx - where().h;
            if (across) moveMap(md, across, 0);
          } catch (err) {
            rt.reportError(err);
          }
          rt.needsDraw = true;
        }
      }
      touch.sx = x;
      touch.sy = y;
      return;
    }
    if (touch.mode === 'mouse' || touch.mode === 'hover') {
      rt.mouse.x = x;
      rt.mouse.y = y;
      rt.rollover();
    }
  }

  function up(e) {
    if (e.pointerType !== 'touch') return;
    e.stopPropagation();
    if (pinch && touch && (e.pointerId === touch.id || (second && e.pointerId === second.id))) {
      // the pinch is over; the finger still down does nothing until it lifts
      const left = e.pointerId === touch.id ? second : touch;
      touch = { id: left.id, mode: 'ignore', timer: 0 };
      second = null;
      pinch = null;
      return;
    }
    if (!touch || e.pointerId !== touch.id) return;
    clearTimeout(touch.timer);
    const t = touch;
    touch = null;
    if (t.mode === 'mouse') {
      const [x, y] = stagePos(e);
      rt.mouse.x = x;
      rt.mouse.y = y;
      rt.mouseUp();
    } else if (t.mode === 'pending') {
      // a tap: a click where the finger landed
      const [x, y] = stagePos({ clientX: t.x0, clientY: t.y0 });
      rt.mouse.x = x;
      rt.mouse.y = y;
      rt.mouseDown();
      rt.mouseUp();
    }
    rt.needsDraw = true;
  }

  function cancel(e) {
    if (e.pointerType !== 'touch') return;
    e.stopPropagation();
    if (second && e.pointerId === second.id) {
      second = null;
      pinch = null;
      if (touch) touch.mode = 'ignore';
      return;
    }
    if (!touch || e.pointerId !== touch.id) return;
    clearTimeout(touch.timer);
    if (touch.mode === 'mouse') rt.mouseUp();
    touch = null;
  }

  // In the capture phase on the window, ahead of the runtime's own mouse handling on the
  // canvas, which a touch then never reaches.
  const onCanvas = (f) => (e) => { if (e.target === canvas) f(e); };
  window.addEventListener('pointerdown', onCanvas(down), true);
  window.addEventListener('pointermove', onCanvas(move), true);
  window.addEventListener('pointerup', onCanvas(up), true);
  window.addEventListener('pointercancel', onCanvas(cancel), true);
}

// Moves the map's picture by (cx, cy) stage pixels: whole tiles as tiles and the rest as
// pixels, since scrollmap carries its pixel scroll over by at most one tile a call.
function moveMap(md, cx, cy) {
  const size = md.$.ptilesize.a;
  const nx = Math.trunc(cx / size[0]), ny = Math.trunc(cy / size[1]);
  L.mc(md, 'scrollmap', L.list([-nx, -ny]), new L.LPoint(-(cx - nx * size[0]), -(cy - ny * size[1])));
}
