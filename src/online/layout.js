// The window's shape and size: the stage takes the window's size (after the interface
// size), the mission's map view grows with it, and the interface sprites of the play
// frame are moved to the edges they belong to.  Frames made for the 610 x 440 stage
// (titles, world maps, licences) are drawn at that size in the middle.

import * as L from '../director/lingo.js';

const BASE_W = 610, BASE_H = 440;

// The play frame's sprites, by channel: where each is anchored, as a fraction of how much
// wider (ax) and taller (ay) the stage is than the original.
const PLAY_ANCHORS = new Map();
function anchorRange(from, to, ax, ay) { for (let c = from; c <= to; c++) PLAY_ANCHORS.set(c, [ax, ay]); }
anchorRange(3, 3, 0, 1);          // the plans bar
anchorRange(4, 7, 1, 0);          // the right-hand panel, its frame, the menu button
anchorRange(9, 9, 0, 1);          // "plans"
anchorRange(10, 14, 1, 0);        // minimap, mission name, (offstage) menu and info text
anchorRange(20, 20, 0, 0.5);      // scroll arrows: west, east, north, south
anchorRange(21, 21, 1, 0.5);
anchorRange(22, 22, 0.5, 0);
anchorRange(23, 23, 0.5, 1);
anchorRange(30, 50, 0, 1);        // plan icons, their counters, the plan name
anchorRange(72, 98, 1, 0);        // the selected unit's display and its buttons
anchorRange(101, 106, 0.5, 0.5);  // the unit info bubble
anchorRange(130, 140, 0.5, 0.5);  // the menu

// options.maxScale() gives the interface size: how many CSS pixels a stage pixel may take
// at most (Infinity: as many as fill the window).
export function makeLayout(rt, options = {}) {
  const maxScale = options.maxScale || (() => 2);
  return {
    // How big the stage is for a window of cssW x cssH, and how many CSS pixels a stage
    // pixel takes.  The interface size caps how far the game is enlarged; past that, more
    // of the map shows.  The tutorial points at the original layout, so it keeps it.
    stageFor(cssW, cssH) {
      const fit = Math.min(cssW / BASE_W, cssH / BASE_H);
      if (classic(rt)) return { width: BASE_W, height: BASE_H, scale: fit };
      const scale = Math.max(0.5, Math.min(fit, maxScale()));
      return {
        width: Math.max(BASE_W, Math.floor(cssW / scale)),
        height: Math.max(BASE_H, Math.floor(cssH / scale)),
        scale,
      };
    },
    // Frames other than the play frame keep the original stage, in the middle.
    boxFor(label) {
      if (label === 'play') return null;
      const st = rt.stage;
      if (st.width === BASE_W && st.height === BASE_H) return null;
      return { x: Math.floor((st.width - BASE_W) / 2), y: Math.floor((st.height - BASE_H) / 2), w: BASE_W, h: BASE_H };
    },
    anchor(rt_, label, ch, spr) {
      if (label !== 'play') return;
      const ex = rt.stage.width - BASE_W, ey = rt.stage.height - BASE_H;
      const a = PLAY_ANCHORS.get(ch);
      if (a) {
        const dx = Math.round(a[0] * ex), dy = Math.round(a[1] * ey);
        spr.locH += dx;
        spr.locV += dy;
        spr.anchor = { ax: a[0], ay: a[1], dx, dy };
      }
      const m = spr.member;
      const name = m ? m.name : '';
      // things that grow with the view, keeping their top left where it was
      const grow = GROW[name];
      if (grow) {
        if (!spr.anchor) spr.anchor = { ax: 0, ay: 0, dx: 0, dy: 0 };
        const base = { w: spr.width, h: spr.height, left: spr.left, top: spr.top, locH: spr.locH - spr.anchor.dx, locV: spr.locV - spr.anchor.dy };
        spr.anchor.grow = (s, ex2, ey2) => grow(s, base, ex2, ey2);
        spr.anchor.grow(spr, ex, ey);
        if (name === 'top_and_left_border') spr.nine = { l: 40, t: 40, r: 30, b: 12 };
      }
    },
    // After the stage changed size: the map view is laid out again.
    resized() {
      const glob = rt.globals.glob;
      const md = glob ? L.gp(glob, 'map_display') : undefined;
      if (md && rt.labelAt(rt.frame) === 'play') {
        try { L.mc(md, 'relayout'); } catch (e) { rt.reportError(e); }
      }
    },
    // Every drawing: the sky covers the stage, however the map has moved it.
    beforeDraw() {
      if (rt.labelAt(rt.frame) !== 'play') return;
      const sky = rt.sprites[1];
      if (sky && sky.member && sky.member.width) {
        const m = sky.member;
        const k = Math.max(rt.stage.width / m.width, rt.stage.height / m.height) * 1.25;
        sky.w = Math.round(m.width * k);
        sky.h = Math.round(m.height * k);
      }
    },
  };
}

// Sprites that are stretched with the view rather than moved.
const GROW = {
  // the frame around the map: as wide and tall as the map view
  'top_and_left_border': (s, b, ex, ey) => keepTopLeft(s, b, b.w + ex, b.h + ey),
  // the right-hand panel's white and its rule run the stage's height
  'right panel white rect': (s, b, ex, ey) => { s.w = b.w; s.h = b.h + ey; },
  'right panel framing': (s, b, ex, ey) => {
    s.w = b.w;
    s.h = b.h + ey;
    s.locV = b.top + Math.round(s.member.regY * s.h / s.member.height);
  },
  // the region a followed unit is kept inside, before the map scrolls
  'AUTOSCROLL BORDER': (s, b, ex, ey) => { s.w = b.w + ex; s.h = b.h + ey; },
};

function keepTopLeft(s, b, w, h) {
  s.w = w;
  s.h = h;
  const m = s.member;
  s.locH = b.left + Math.round(m.regX * w / m.width);
  s.locV = b.top + Math.round(m.regY * h / m.height);
}

function classic(rt) {
  const glob = rt.globals.glob;
  return !!(glob && L.t(L.gi(glob, L.sym('tutorialMode'))));
}
