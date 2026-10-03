// The window's shape and size: the stage takes the window's size (after the interface
// size), the mission's map view grows with it, and the interface sprites of the play
// frame are moved to the edges they belong to.  Frames made for the 610 x 440 stage
// (titles, world maps, licences) are drawn at that size in the middle.
//
// The map can be zoomed out (the mouse wheel, two fingers), as CrystAlien Conflict
// Online's battlefield can: the map's sprites are drawn smaller about the stage's corner
// while the interface keeps its size, and the map's view is laid out for the bigger area
// it then covers (viewTileSize in src/lingo/movie - layout.ls asks mapzoom()).  The most
// it zooms in is the game's own scale; the most it zooms out, the map's edges.

import * as L from '../director/lingo.js';
import { shiftMap } from './touch.js';

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
anchorRange(101, 106, 1, 0.5);    // the unit info bubble, beside the right-hand panel as in the original
anchorRange(130, 140, 0.5, 0.5);  // the menu

// The sprites that belong to the map, which zoom with it: the sky, what the scripts place
// on the map with posToLoc (the unit highlight, the click spike, the build outline and its
// plan, the action arrows, the goal and resource popups, the build and take-apart clouds,
// the region a followed unit is kept inside), and the map's own sprites (channels 200
// up, and the race ghosts after them).
const MAP_LAYER = new Set([1, 16, 29, 54, 56]);
for (const [a, b] of [[57, 69], [111, 128], [143, 169]]) for (let c = a; c <= b; c++) MAP_LAYER.add(c);
const MAP_CHANNELS = 200;
const CLICK_SPIKE = 16;        // the arrow a click on the map shows (click spike behavior)
// the map display's pool of sprites runs from channel 200 to 4000 (tools/merge.py): this
// many may be the view's tiles, the rest kept for the units and piles on it
const MAP_TILE_SPRITES = 3000;
const GHOSTS = 4001;          // the race ghosts (src/online/race.js), placed at every drawing

// options.maxScale() gives the interface size: how many CSS pixels a stage pixel may take
// at most (Infinity: as many as fill the window).
export function makeLayout(rt, options = {}) {
  const maxScale = options.maxScale || (() => 2);
  const mapDisplay = () => {
    const glob = rt.globals.glob;
    if (!glob || rt.labelAt(rt.frame) !== 'play') return null;
    const md = L.gp(glob, 'map_display');
    return md instanceof L.LInstance ? md : null;
  };
  const layout = {
    zoom: 1,
    // The map's zoom for a sprite of it (1 for the interface, and in the tutorial, which
    // points at the original layout).
    zoomOf(s) {
      if (this.zoom === 1 || !(s.channel >= MAP_CHANNELS || MAP_LAYER.has(s.channel))) return 1;
      return rt.labelAt(rt.frame) === 'play' ? this.zoom : 1;
    },
    // The most the map zooms out: until its edges would come into the view, as far as the
    // view's narrower way allows (the map's tiles, a tile of sky round them).
    minZoom() {
      const md = mapDisplay();
      if (!md || classic(rt)) return 1;
      const size = L.gp(md, 'pmapsize');
      if (!size || !size.a) return 1;
      const [w, h] = size.a;
      const locs = [[1, 1], [w, 1], [1, h], [w, h]].map(([x, y]) => L.mc(md, 'postoloc', L.list([x, y])));
      const xs = locs.map((p) => p.h), ys = locs.map((p) => p.v);
      const worldW = Math.max(...xs) - Math.min(...xs) + 150, worldH = Math.max(...ys) - Math.min(...ys) + 150;
      const viewW = rt.stage.width - 113, viewH = rt.stage.height;
      // out until the whole map shows, with room round it, and always somewhat (the view
      // can be moved a little past the map's edges, to put the map in the middle)
      let z = Math.max(0.2, Math.min(0.75, 0.85 * Math.min(viewW / worldW, viewH / worldH)));
      // but no further than the map display's sprites stretch to: a sprite a tile of the
      // view (viewTileSize in src/lingo/movie - layout.ls), and room for what is on the map
      const tiles = (k) => { const [w, h] = tilesFor(rt, k); return w * h; };
      while (z < 1 && tiles(z) > MAP_TILE_SPRITES) z = Math.min(1, z + 0.01);
      return z;
    },
    // Zoom the map to z, keeping the map's point under (ux, uy) (stage pixels) where it is.
    // The map display keeps a sprite for every tile the most zoomed-out view shows (see
    // held), so zooming only moves the map; making the view again (relayout) takes a long
    // moment, and is only done should the view somehow need more tiles than it has.
    setZoom(z, ux, uy, sizeFor) {
      const md = mapDisplay();
      const z0 = this.zoom;
      z = Math.max(this.minZoom(), Math.min(1, z));
      if (!md || Math.abs(z - z0) < 1e-4) return;
      if (ux === undefined) { ux = (rt.stage.width - 113) / 2; uy = rt.stage.height / 2; }
      try {
        const corner = () => L.mc(md, 'postoloc', L.list([0, 0]));
        const p0 = corner();
        const rel = [ux / z0 - p0.h, uy / z0 - p0.v];
        const k = Math.max(this.minZoom(), Math.min(z, sizeFor || z));
        const need = tilesFor(rt, k), have = L.gp(md, 'pdisplaytilesize').a;
        this.carryMap(() => {
          if (need[0] > have[0] || need[1] > have[1]) {
            this.zoom = k;
            L.mc(md, 'relayout');
          }
          this.zoom = z;
          const p1 = corner();
          shiftMap(md, Math.round(ux / z - rel[0] - p1.h), Math.round(uy / z - rel[1] - p1.v));
        });
        this.regrow();
      } catch (e) {
        rt.reportError(e);
      }
      rt.needsDraw = true;
    },
    // A mission's map display is made with the view the game shows at first (the map is not
    // read yet, so how far it can zoom out is not known); once it is, the view is made again
    // with every tile the most zoomed-out view shows, before the mission is first drawn.
    held() {
      const md = mapDisplay();
      if (!md || md === this.heldFor) return;
      this.heldFor = md;
      try {
        const need = tilesFor(rt, this.minZoom()), have = L.gp(md, 'pdisplaytilesize').a;
        if (need[0] > have[0] || need[1] > have[1]) {
          L.mc(md, 'relayout');
          this.regrow();
        }
      } catch (e) {
        rt.reportError(e);
      }
    },
    // The mouse wheel: the zoom glides to where the wheel sends it, a part of the way at
    // every drawing, about the pointer.
    zoomBy(factor, ux, uy) {
      const md = mapDisplay();
      if (!md) return;
      const lo = this.minZoom();
      this.zoomTarget = Math.max(lo, Math.min(1, (this.gliding ? this.zoomTarget : this.zoom) * factor));
      this.zoomAt = [ux, uy];
      if (this.gliding) return;
      this.gliding = true;
      const step = () => {
        if (!mapDisplay()) { this.gliding = false; return; }
        const t = this.zoomTarget, z = this.zoom;
        const next = Math.abs(t - z) < 0.002 ? t : z + (t - z) * 0.3;
        this.setZoom(next, this.zoomAt[0], this.zoomAt[1], t);
        if (next === t || Math.abs(this.zoom - z) < 1e-5) {
          this.gliding = false;
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    // The games hide a sprite by putting it at (1000, 1000), past the edges of their
    // 610 x 440 stage (once, at (10000, 10000)). The stage here can be bigger, and the map
    // zoomed out brings that point into view: such a sprite is left undrawn.
    parked(s) {
      return (s.locH === 1000 && s.locV === 1000) || (s.locH === 10000 && s.locV === 10000);
    },
    // Moves the map between the game's frames (a finger dragging it, a zoom), by move().
    // Everything on the map is placed from the map's corner, but only on the game's next
    // frame; until then it is carried along by as much as the corner moved, so that the
    // units, piles and popups keep to the terrain while the map moves.
    carryMap(move) {
      const md = mapDisplay();
      if (!md) { move(); return; }
      const corner = () => L.mc(md, 'postoloc', L.list([0, 0]));
      const before = corner();
      move();
      const after = corner();
      const dx = after.h - before.h, dy = after.v - before.v;
      if (!dx && !dy) return;
      // (the terrain's own sprites, which scrollmap has placed, and the pool's spare ones)
      const own = new Set();
      for (const row of L.gp(md, 'pmapsprites').a) for (const s of row.a) own.add(s.channel);
      for (const s of L.gp(md, 'ptilesprites').a) own.add(s.channel);
      for (const s of rt.sprites) {
        if (!s || own.has(s.channel) || s.channel === 1 || (s.anchor && s.anchor.grow)) continue;
        if (!(MAP_LAYER.has(s.channel) || (s.channel >= MAP_CHANNELS && s.channel < GHOSTS))) continue;
        // (1000, 1000) is where the game puts what it hides
        if (s.locH === 1000 && s.locV === 1000) continue;
        s.locH += dx;
        s.locV += dy;
      }
    },
    // The sprites sized from the view, sized again (the zoom changed the view).
    regrow() {
      const ex = rt.stage.width - BASE_W, ey = rt.stage.height - BASE_H;
      for (const s of rt.sprites) if (s && s.anchor && s.anchor.grow) s.anchor.grow(s, ex, ey);
    },
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
      // the click spike waits under the plans bar in the score, out of sight there, until
      // the first click on the map; here the bar is lower, so it waits where the game puts
      // what it hides
      if (ch === CLICK_SPIKE) { spr.locH = 1000; spr.locV = 1000; return; }
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
        spr.anchor.grow = (s, ex2, ey2) => grow(s, base, ex2, ey2, layout.zoomOf(s));
        spr.anchor.grow(spr, ex, ey);
        if (name === 'top_and_left_border') spr.nine = { l: 40, t: 40, r: 30, b: 12 };
      }
    },
    // After the stage changed size: the map view is laid out again (and the zoom kept
    // within what the new size allows).
    resized() {
      const md = mapDisplay();
      if (md) {
        try {
          this.zoom = Math.max(this.zoom, this.minZoom());
          L.mc(md, 'relayout');
          this.regrow();
        } catch (e) { rt.reportError(e); }
      }
    },
    // Every drawing: the sky covers the stage, however the map has moved it.
    beforeDraw() {
      if (rt.labelAt(rt.frame) !== 'play') return;
      this.held();
      const sky = rt.sprites[1];
      if (sky && sky.member && sky.member.width) {
        const m = sky.member;
        const z = this.zoomOf(sky);
        const k = Math.max(rt.stage.width / z / m.width, rt.stage.height / z / m.height) * 1.25;
        sky.w = Math.round(m.width * k);
        sky.h = Math.round(m.height * k);
      }
    },
  };
  // (for viewTileSizeHeld, in src/lingo/movie - layout.ls)
  rt.builtins.mapzoomleast = () => layout.minZoom();
  return layout;
}

// Sprites that are stretched with the view rather than moved.  (z: the map's zoom, for
// what belongs to the map.)
const GROW = {
  // the frame around the map: as wide and tall as the map view
  'top_and_left_border': (s, b, ex, ey) => keepTopLeft(s, b, b.w + ex, b.h + ey),
  // the plans bar runs on under the right-hand panel, as it does on the original stage: a
  // plain column after its tenth slot is stretched, so the slots keep their places
  'new_bottom_panel': (s, b, ex) => {
    keepTopLeft(s, b, b.w + ex, b.h);
    s.nine = { l: 488, t: 0, r: 34, b: 0 };
  },
  // the right-hand panel's white and its rule run the stage's height
  'right panel white rect': (s, b, ex, ey) => { s.w = b.w; s.h = b.h + ey; },
  'right panel framing': (s, b, ex, ey) => {
    s.w = b.w;
    s.h = b.h + ey;
    s.locV = b.top + Math.round(s.member.regY * s.h / s.member.height);
  },
  // the region a followed unit is kept inside, before the map scrolls: the view's, inset
  // as the original has it (in the map's pixels, so as big as the zoomed-out view)
  'AUTOSCROLL BORDER': (s, b, ex, ey, z = 1) => {
    s.w = Math.round((b.w + ex) / z);
    s.h = Math.round((b.h + ey) / z);
    s.locH = Math.round(b.locH / z);
    s.locV = Math.round(b.locV / z);
  },
};

// The map display's view for a zoom, in tiles: as viewTileSize (src/lingo/movie - layout.ls)
// works it out.
function tilesFor(rt, z) {
  const w = Math.round(rt.stage.width / z), h = Math.round(rt.stage.height / z);
  return [12 + Math.trunc((w - 610 + 49) / 50), 9 + Math.trunc((h - 440 + 49) / 50)];
}

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
