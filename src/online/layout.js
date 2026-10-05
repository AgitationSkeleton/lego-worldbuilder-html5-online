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
anchorRange(9, 9, 1, 1);          // "plans", at the plans bar's right end
anchorRange(10, 14, 1, 0);        // minimap, mission name, (offstage) menu and info text
anchorRange(20, 20, 0, 0.5);      // scroll arrows: west, east, north, south
anchorRange(21, 21, 1, 0.5);
anchorRange(22, 22, 0.5, 0);
anchorRange(23, 23, 0.5, 1);
anchorRange(30, 50, 1, 1);        // plan icons, their counters, the plan name: the bar's slots, at its right end
anchorRange(72, 100, 1, 0);       // the selected unit's display and its buttons (99, 100: its fifth brick row)
anchorRange(101, 106, 1, 0.5);    // the unit info bubble, beside the right-hand panel as in the original
anchorRange(130, 140, 0.5, 0.5);  // the menu

// The sprites that belong to the map, which zoom with it: the sky, what the scripts place
// on the map with posToLoc (the unit highlight, the click spike, the build outline and its
// plan, the action arrows, the goal and resource popups, the build and take-apart clouds,
// the region a followed unit is kept inside; 170 to 173, a generated mission's New Random
// Mission in the goal popups: tools/merge.py, random_bubbles), and the map's own sprites
// (channels 200 up, and the race ghosts after them).
const MAP_LAYER = new Set([1, 16, 29, 54, 56]);
for (const [a, b] of [[57, 69], [111, 128], [143, 173]]) for (let c = a; c <= b; c++) MAP_LAYER.add(c);
const MAP_CHANNELS = 200;
const CLICK_SPIKE = 16;        // the arrow a click on the map shows (click spike behavior)
const HIGHLIGHT = 29;          // the arrow over the unit chosen (Highlight arrow behavior)
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
  const smooth = options.smooth || (() => false);
  const layout = {
    zoom: 1,
    glides: new Map(),      // sprite -> {prev, cur}: see glideFrame
    // The map's zoom for a sprite of it (1 for the interface, and in the tutorial, which
    // points at the original layout).
    zoomOf(s) {
      if (this.zoom === 1 || classic(rt) || !(s.channel >= MAP_CHANNELS || MAP_LAYER.has(s.channel))) return 1;
      if (s.channel === HIGHLIGHT && this.highlightOnUI()) return 1;
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
      return this.snap(z, Math.ceil);
    },
    // The zooms the map is drawn at: those at which its tiles' grid (25 pixels: half a tile
    // across, the skew of a row) is a whole number of the pixels the stage is drawn in.
    // Each tile is scaled on its own, and at any other zoom two tiles' shared edge could
    // fall either side of a pixel, and a line of what is under them showed between them.
    snap(z, round = Math.round) {
      const k = Math.max(1, Math.ceil(rt.renderer.scale - 1e-6));
      const q = 1 / (25 * k);
      return Math.min(1, round(z / q - 1e-9) * q);
    },
    zoomStep() {
      return 1 / (25 * Math.max(1, Math.ceil(rt.renderer.scale - 1e-6)));
    },
    // Zoom the map to z, keeping the map's point under (ux, uy) (stage pixels) where it is.
    // The map display keeps a sprite for every tile the most zoomed-out view shows (see
    // held), so zooming only moves the map; making the view again (relayout) takes a long
    // moment, and is only done should the view somehow need more tiles than it has.
    setZoom(z, ux, uy, sizeFor) {
      const md = mapDisplay();
      const z0 = this.zoom;
      z = Math.max(this.minZoom(), this.snap(Math.min(1, z)));
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
        // (a zoom kept from another mission, as far out as this map allows)
        const z0 = this.zoom;
        this.zoom = this.snap(Math.max(this.zoom, this.minZoom()));
        const need = tilesFor(rt, this.minZoom()), have = L.gp(md, 'pdisplaytilesize').a;
        if (need[0] > have[0] || need[1] > have[1] || this.zoom !== z0) {
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
      this.zoomTarget = this.snap(Math.max(lo, Math.min(1, (this.gliding ? this.zoomTarget : this.zoom) * factor)));
      this.zoomAt = [ux, uy];
      if (this.gliding) return;
      this.gliding = true;
      const step = () => {
        if (!mapDisplay()) { this.gliding = false; return; }
        const t = this.zoomTarget, z = this.zoom;
        // (a part of the way, but at least a step of the zooms the map is drawn at)
        const q = this.zoomStep();
        let next = Math.abs(t - z) <= q ? t : z + (t - z) * 0.3;
        if (next !== t && Math.abs(next - z) < q) next = z + Math.sign(t - z) * q;
        this.setZoom(next, this.zoomAt[0], this.zoomAt[1], t);
        if (next === t || Math.abs(this.zoom - z) < 1e-5) {
          this.gliding = false;
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    // A mission starting: the tutorial, which points at the map's tiles, at the game's own
    // scale.
    install(scripts) {
      for (const s of scripts) {
        // the game's own scrolling (its arrows, keys, following a unit) carries what is on
        // the map along with it at once, as a drag does (carryMap): the page draws between
        // the game's frames, and the units would otherwise wait for the next to follow
        if (s.name === 'map display manager' && s.handlers.scrollmap) {
          const scroll = s.handlers.scrollmap;
          s.handlers.scrollmap = function (...args) {
            let r;
            layout.carryMap(() => { r = scroll.apply(this, args); });
            return r;
          };
        }
        // (the tutorial's step shown: placed for this layout at once, see placeTutorial)
        if (s.name === 'tutorial manager' && s.handlers.showstep) {
          const show = s.handlers.showstep;
          s.handlers.showstep = function (...args) {
            const r = show.apply(this, args);
            layout.placeTutorial();
            return r;
          };
        }
        if (s.type !== 'movie' || !s.handlers.startlevel) continue;
        const start = s.handlers.startlevel;
        s.handlers.startlevel = function (...args) {
          if (classic(rt)) layout.zoom = 1;
          return start.apply(this, args);
        };
      }
    },
    // Where a place on the original stage's interface is in this layout: the tutorial's
    // arrows and click holes are given there (uiLoc and uiRect in src/lingo/movie -
    // layout.ls). The interface is anchored by parts (see PLAY_ANCHORS): the right-hand
    // panel to the right, the plans bar to the bottom, the scroll arrows to the middles of
    // the edges, the unit info bubble beside the panel; the map's own places are the map's.
    uiAnchor(x, y) {
      if (x >= 497) return [1, 0];                                  // the right-hand panel (see uiShift)
      if (x >= 430 && y >= 150 && y <= 250) return [1, 0.5];        // the right scroll arrow
      if (x < 60 && y >= 150 && y <= 250) return [0, 0.5];          // the left one
      if (y < 45 && x >= 190 && x <= 300) return [0.5, 0];          // the up one
      if (y >= 330 && y < 390 && x >= 190 && x <= 300) return [0.5, 1];   // the down one
      if (y >= 390) return [1, 1];                                  // the plans bar's slots
      return [0, 0];
    },
    uiShift(x, y, a) {
      const [ax, ay] = a || this.uiAnchor(x, y);
      // (the right-hand panel's lower part is a row lower here: tools/merge.py, five_rows)
      // (the right-hand panel goes down the stage by its own rule: panelV)
      if (!a && x >= 497) return [Math.round(ax * (rt.stage.width - BASE_W)), panelV(rt, y, rt.stage.height - BASE_H) - y];
      return [Math.round(ax * (rt.stage.width - BASE_W)), Math.round(ay * (rt.stage.height - BASE_H))];
    },
    // Smoother movement (a setting): the game moves its units and monsters only at its
    // frames, fifteen a second, a step at a time; drawn between the frames as well, each
    // glides from where it was at the frame before to where it is (a frame behind, so as
    // to know where it is going). Where they are is taken from the map's corner, so that
    // the map moving (scrolled, dragged) is not taken for them moving; a jump further than
    // a tile is not glided.
    glideFrame() {
      if (rt.ticks === this.glideTick) return;
      this.glideTick = rt.ticks;
      const md = mapDisplay();
      if (!md || !smooth() || !layout.drawsBetween()) { this.glides.clear(); return; }
      const corner = L.mc(md, 'postoloc', L.list([0, 0]));
      const seen = new Set();
      for (const s of this.gliders()) {
        seen.add(s);
        const at = [s.locH - corner.h, s.locV - corner.v];
        const g = this.glides.get(s);
        const prev = g ? g.cur : at;
        const far = Math.abs(prev[0] - at[0]) > 60 || Math.abs(prev[1] - at[1]) > 60 || this.parked(s);
        this.glides.set(s, { prev: far ? at : prev, cur: at });
      }
      for (const s of this.glides.keys()) if (!seen.has(s)) this.glides.delete(s);
    },
    // (the sprites of the units, monsters and what else is on the map, and the arrow over
    // the unit chosen, which follows it)
    gliders() {
      const glob = rt.globals.glob;
      const out = [];
      const objects = glob && L.gp(glob, 'objects');
      if (objects && objects.a) {
        for (const o of objects.a) {
          const ps = o instanceof L.LInstance ? L.gp(o, 'psprites') : null;
          if (ps && ps.v) for (const s of ps.v) if (s && s.channel) out.push(s);
        }
      }
      if (rt.sprites[HIGHLIGHT] && !this.highlightOnUI()) out.push(rt.sprites[HIGHLIGHT]);
      return out;
    },
    // The arrow over the thing chosen is the map's when that is on the map, and the
    // interface's when it is a plan in the plans bar (its build icon): then it is not
    // zoomed, carried or glided with the map.
    highlightOnUI() {
      const glob = rt.globals.glob;
      const o = glob && L.gp(glob, 'highlighted_object');
      if (!(o instanceof L.LInstance)) return false;
      try {
        return L.t(L.mc(o, 'buildiconp'));
      } catch (e) {
        return false;
      }
    },
    drawsBetween() {
      return !rt.testMode;
    },
    glidePart() {
      return Math.min(1, (performance.now() - (rt.tickAt || 0)) * rt.tempo() / 1000);
    },
    drawOffset(s) {
      if (!this.glides.size) return null;
      const g = this.glides.get(s);
      if (!g || (g.prev[0] === g.cur[0] && g.prev[1] === g.cur[1])) return null;
      const k = 1 - this.glidePart();
      return k > 0 ? [(g.prev[0] - g.cur[0]) * k, (g.prev[1] - g.cur[1]) * k] : null;
    },
    wantsDraw() {
      if (!this.glides.size || this.glidePart() >= 1) return false;
      for (const g of this.glides.values()) if (g.prev[0] !== g.cur[0] || g.prev[1] !== g.cur[1]) return true;
      return false;
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
      // (once: a move inside another, scrollmap inside a drag, is carried by the outer one)
      if (!md || this.carrying) { move(); return; }
      this.carrying = true;
      try {
        this.carryMapOnce(md, move);
      } finally {
        this.carrying = false;
      }
    },
    carryMapOnce(md, move) {
      const corner = () => L.mc(md, 'postoloc', L.list([0, 0]));
      const before = corner();
      move();
      const after = corner();
      const dx = after.h - before.h, dy = after.v - before.v;
      if (!dx && !dy) return;
      // (the tutorial's step about a place on the map keeps its hole and arrow on it)
      if (this.tutorial()) this.placeStepAfterMove = true;
      // (the terrain's own sprites, which scrollmap has placed, and the pool's spare ones;
      // and the tutorial's, which it takes from the pool but places on the stage: the
      // original's scrolling leaves them be)
      const own = new Set();
      for (const row of L.gp(md, 'pmapsprites').a) for (const s of row.a) own.add(s.channel);
      for (const s of L.gp(md, 'ptilesprites').a) own.add(s.channel);
      const tut = this.tutorial();
      if (tut) for (const s of tut.all) own.add(s.channel);
      for (const s of rt.sprites) {
        if (!s || own.has(s.channel) || s.channel === 1 || (s.anchor && s.anchor.grow)) continue;
        if (s.channel === HIGHLIGHT && this.highlightOnUI()) continue;
        if (!(MAP_LAYER.has(s.channel) || (s.channel >= MAP_CHANNELS && s.channel < GHOSTS))) continue;
        // (1000, 1000) is where the game puts what it hides
        if (s.locH === 1000 && s.locV === 1000) continue;
        s.locH += dx;
        s.locV += dy;
      }
    },
    // The tutorial (its manager, tutorial manager in the tutorial cast), while it runs: its
    // sprites (from the map display's pool, placed on the stage) by name, and all of them.
    tutorial() {
      if (!classic(rt)) return null;
      const glob = rt.globals.glob;
      const tm = glob && L.gp(glob, 'tutorial_manager');
      const sp = tm instanceof L.LInstance ? L.gp(tm, 'sprites') : null;
      if (!(sp instanceof L.LPropList)) return null;
      const of = (e) => (e instanceof L.LPropList ? L.gp(e, 'sprite') : null);
      return { tm, get: (n) => of(L.gp(sp, n)), all: sp.v.map(of).filter((s) => s && s.channel) };
    },
    // The tutorial in this layout. Its arrows and click holes on the interface are given on
    // the original stage and put where the layout has that part (uiLoc, uiRect); here, on
    // every drawing (the window may change size during a step):
    // - its Skip button over the Menu button, as the original has it (two pixels right, one
    //   up), as tall as the Menu button is here, with its label in the middle;
    // - its mask, which keeps clicks from the game but through its holes, over the stage;
    // - its bubble, with its text and buttons, where the original has it for a step about
    //   the map (the map is where the original's view has it: viewTileSize, in src/lingo/
    //   movie - layout.ls); for a step about a part of the interface, moved as far as the
    //   layout moved that part, so that it is as near it as on the original stage.
    placeTutorial() {
      const tut = this.tutorial();
      if (!tut) {
        // (its sprites back to the pool as they were)
        if (this.tutorialTouched) {
          for (const s of this.tutorialTouched) { s.nine = null; s.keepSize = false; s.tut = null; }
          // (and the map, lowered for it on a tall stage, laid out for the game's own view)
          const md = mapDisplay();
          if (md) {
            try { L.mc(md, 'relayout'); this.regrow(); } catch (e) { rt.reportError(e); }
          }
        }
        this.tutorialTouched = null;
        return;
      }
      const touched = this.tutorialTouched || (this.tutorialTouched = new Set());
      const menu = rt.sprites[6], quit = tut.get('quitbutton'), label = tut.get('qbtext');
      if (quit && quit.member && menu && menu.member && quit.locH > -900) {
        const m = quit.member, w = menu.width, h = menu.height;
        quit.keepSize = true;
        quit.w = w;
        quit.h = h;
        quit.nine = h !== m.height || w !== m.width ? { l: 8, t: 6, r: 8, b: 6 } : null;
        quit.locH = menu.left + 2 + Math.round(m.regX * w / m.width);
        quit.locV = menu.top - 1 + Math.round(m.regY * h / m.height);
        touched.add(quit);
        if (label) {
          label.locH = quit.locH - 114;
          label.locV = quit.locV - 3 + Math.round((h - m.height) / 2) - Math.round(m.regY * (h - m.height) / m.height);
        }
      }
      const mask = tut.get('mousemask');
      if (mask && mask.member && mask.member.width) {
        const m = mask.member, w = rt.stage.width, h = rt.stage.height;
        mask.w = w;
        mask.h = h;
        mask.locH = Math.round(m.regX * w / m.width);
        mask.locV = Math.round(m.regY * h / m.height);
      }
      // (on a touch screen, the step's hole as big as a finger: the original's for the goal
      // is 20 pixels wide, for a plan 20 by 25; what is touched in it goes to the step's own
      // thing all the same)
      const cc = tut.get('click_catcher'), hole = L.gp(tut.tm, 'clickrect');
      if (cc && cc.member && cc.member.width && hole instanceof L.LRect && L.num(hole.l) > -900 && touchScreen()) {
        const l = L.num(hole.l), t = L.num(hole.t), r = L.num(hole.r), b = L.num(hole.b);
        const w = Math.max(r - l, FINGER), h = Math.max(b - t, FINGER), m = cc.member;
        cc.w = w;
        cc.h = h;
        cc.locH = Math.round((l + r - w) / 2) + Math.round(m.regX * w / m.width);
        cc.locV = Math.round((t + b - h) / 2) + Math.round(m.regY * h / m.height);
      }
      const d = this.tutorialShift(tut.tm);
      for (const n of ['dialogbox', 'dialogtext', 'button1', 'button2', 'button1text', 'button2text']) {
        const s = tut.get(n);
        if (!s) continue;
        if (s.locH <= -900) { s.tut = null; continue; }
        const t = s.tut;
        // (still where it was put here: moved by the change; put back by the tutorial: by all)
        const was = t && s.locH === t.h && s.locV === t.v ? [t.dx, t.dy] : [0, 0];
        s.locH += d[0] - was[0];
        s.locV += d[1] - was[1];
        s.tut = { h: s.locH, v: s.locV, dx: d[0], dy: d[1] };
        touched.add(s);
      }
    },
    // How far the layout moved what the tutorial's step is about, if that is a part of the
    // interface: the thing it lets be clicked (a scroll arrow, a button of the right-hand
    // panel, the info bubble's Close, a plan in the plans bar), or the place on the
    // interface its arrow points at; else it is about the map, which is lowered on a tall
    // stage (tutorialDrop).
    tutorialShift(tm) {
      const glob = rt.globals.glob;
      const key = (v) => (v instanceof L.LSymbol ? v.key.toLowerCase() : v);
      const target = key(L.gp(tm, 'clicktarget')), button = key(L.gp(tm, 'clickbutton'));
      let s = null;
      try {
        if (target === 'generic_button') s = rt.sprites[{ arrow_left: 20, arrow_right: 21, arrow_up: 22, arrow_down: 23 }[button]];
        else if (target === 'menu') s = L.gp(L.gp(L.gp(glob, 'menu_display'), 'ss'), button);
        else if (target === 'info') s = L.gp(L.gp(L.gp(glob, 'info_bubble'), 'ss'), button);
        else if (target === 'plan') s = rt.sprites[29 + button];
      } catch (e) {
        s = null;
      }
      if (s && s.anchor) return [s.anchor.dx, s.anchor.dy];
      const step = L.gp(tm, 'pstep');
      const arrow = step instanceof L.LPropList ? L.gp(step, 'arrow') : null;
      const at = arrow instanceof L.LPoint ? arrow : arrow instanceof L.LList && arrow.a[0] instanceof L.LPoint ? arrow.a[0] : null;
      return at ? this.uiShift(L.num(at.h), L.num(at.v)) : [0, this.tutorialDrop()];
    },
    // How much lower the tutorial's map is than on the original stage: on a taller stage,
    // the original's place in its middle (the map display's pixel top left: tools/merge.py),
    // so that the tutorial's small map, and its bubble with it, are not at the top of a phone
    // held upright with the sky below them. The region a followed unit is kept in goes as
    // far down. 0 outside the tutorial.
    tutorialDrop() {
      return classic(rt) ? Math.max(0, Math.floor((rt.stage.height - BASE_H) / 2)) : 0;
    },
    // (the map display's sprites' rows begin as many higher, to run from the stage's top:
    // mapRowsAbove, tools/merge.py)
    mapRowsAbove() {
      return Math.ceil(this.tutorialDrop() / 50);
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
        // (the right-hand panel's own rule down the stage: see panelV)
        const v0 = spr.locV;
        const dyOf = PANEL.has(ch) ? (ey2) => panelV(rt, v0, ey2) - v0 : null;
        const dx = Math.round(a[0] * ex), dy = dyOf ? dyOf(ey) : Math.round(a[1] * ey);
        spr.locH += dx;
        spr.locV += dy;
        spr.anchor = { ax: a[0], ay: a[1], dx, dy, dyOf };
        // (where it is as the game's behaviors see it when they begin: see syncSlocs)
        spr.slocAt = [dx, dy];
        // (its buttons taller on an upright stage: see buttonH)
        if (PANEL_BUTTONS.has(ch)) {
          const w0 = spr.width, h0 = spr.height;
          spr.anchor.grow = (s2) => {
            const h = buttonH(rt);
            s2.w = w0;
            s2.h = h || h0;
            s2.nine = h ? { l: 8, t: 6, r: 8, b: 6 } : null;
            // (pressed, a button shows another picture: it keeps its height)
            s2.keepSize = !!h;
          };
          spr.anchor.grow(spr);
        }
      }
      const m = spr.member;
      const name = m ? m.name : '';
      // things that grow with the view, keeping their top left where it was
      const grow = GROW[name];
      if (grow) {
        if (!spr.anchor) spr.anchor = { ax: 0, ay: 0, dx: 0, dy: 0 };
        const base = { w: spr.width, h: spr.height, left: spr.left, top: spr.top, locH: spr.locH - spr.anchor.dx, locV: spr.locV - spr.anchor.dy };
        const dx0 = spr.anchor.dx, dy0 = spr.anchor.dy;
        // (its top left goes where its anchor has taken it since: the plans bar down the
        // stage as the window grows taller, a phone's address bar going away)
        spr.anchor.grow = (s, ex2, ey2) => {
          const a = s.anchor;
          const at = Object.assign({}, base, { left: base.left + a.dx - dx0, top: base.top + a.dy - dy0 });
          grow(s, at, ex2, ey2, layout.zoomOf(s), layout.tutorialDrop(), classic(rt));
        };
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
          this.zoom = this.snap(Math.max(this.zoom, this.minZoom()));
          L.mc(md, 'relayout');
          this.regrow();
          this.syncSlocs();
          this.placeStep();
          this.placeStepAt = rt.ticks;
        } catch (e) { rt.reportError(e); }
      }
    },
    // The game's right-hand panel display, unit info bubble and Menu popup keep where their
    // sprites were when they began (their sloc), and put them back there to show them: the
    // stage changed size since (a phone turned), those places are moved as far as the
    // layout has moved the sprites.
    syncSlocs() {
      const glob = rt.globals.glob;
      if (!glob || rt.labelAt(rt.frame) !== 'play') return;
      for (const name of ['menu_display', 'info_bubble', 'main_menu_popup']) {
        const inst = L.gp(glob, name);
        const ss = inst instanceof L.LInstance ? L.gp(inst, 'ss') : null;
        const sloc = inst instanceof L.LInstance ? L.gp(inst, 'sloc') : null;
        if (!(ss instanceof L.LPropList) || !(sloc instanceof L.LPropList)) continue;
        for (let i = 0; i < ss.k.length; i++) {
          const sp = ss.v[i];
          if (!sp || !sp.anchor || !sp.slocAt) continue;
          const dx = sp.anchor.dx - sp.slocAt[0], dy = sp.anchor.dy - sp.slocAt[1];
          sp.slocAt = [sp.anchor.dx, sp.anchor.dy];
          const key = ss.k[i];
          const j = sloc.k.findIndex((k) => k === key || (k instanceof L.LSymbol && key instanceof L.LSymbol && k.key === key.key));
          const at = j >= 0 ? sloc.v[j] : null;
          if (!(at instanceof L.LPoint) || (!dx && !dy)) continue;
          sloc.v[j] = new L.LPoint(L.num(at.h) + dx, L.num(at.v) + dy);
        }
      }
    },
    // (the tutorial's step for the stage as it is: placeStep, tools/merge.py)
    placeStep() {
      const tut = this.tutorial();
      if (tut) L.mc(tut.tm, 'placestep');
    },
    // Every drawing: the sky covers the stage, however the map has moved it.
    beforeDraw() {
      if (rt.labelAt(rt.frame) !== 'play') return;
      this.held();
      // (the tutorial's step placed again for where the map is, then placed for this layout)
      if (this.placeStepAfterMove) {
        this.placeStepAfterMove = false;
        try { this.placeStep(); } catch (e) { rt.reportError(e); }
      }
      if (this.placeStepAt !== undefined && rt.ticks > this.placeStepAt) {
        this.placeStepAt = undefined;
        try { this.placeStep(); } catch (e) { rt.reportError(e); }
      }
      this.placeTutorial();
      this.glideFrame();
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
  // (tutorialDrop and mapRowsAbove, for the map display: tools/merge.py)
  rt.builtins.tutorialdrop = () => layout.tutorialDrop();
  rt.builtins.maprowsabove = () => layout.mapRowsAbove();
  // (panelRows, for the right-hand panel's script: see lowerBy)
  rt.builtins.panelrows = () => (lowerBy(rt.stage.height - BASE_H) ? 5 : 4);
  // (the map's zoom for the scripts: the tutorial's is the game's own)
  rt.builtins.mapzoom = () => (classic(rt) ? 1 : layout.zoom);
  // (uiLoc and uiRect, in src/lingo/movie - layout.ls; an anchor may be given, as [ax, ay])
  // (Lingo's numbers: a float, such as an anchor's 0.5, is an LFloat: L.num)
  rt.builtins.uishift = (x, y, a) => L.list(layout.uiShift(L.num(x), L.num(y), a && a.a ? a.a.map(L.num) : null));
  return layout;
}

// Sprites that are stretched with the view rather than moved.  (z: the map's zoom, for
// what belongs to the map.)
const GROW = {
  // the frame around the map: as wide and tall as the map view
  'top_and_left_border': (s, b, ex, ey) => keepTopLeft(s, b, b.w + ex, b.h + ey),
  // the plans bar runs from the left edge to under the right-hand panel, as it does on the
  // original stage, with its slots and its tab at its right end, by the panel: a plain
  // column after its rounded corner is stretched
  // the outline round a plan's bricks, a row taller for a fifth (see panelRows)
  'plan_outline_big': (s, b, ex, ey) => {
    keepTopLeft(s, b, b.w, b.h + lowerBy(ey));
    s.nine = { l: 0, t: 30, r: 0, b: 30 };
  },
  'new_bottom_panel': (s, b, ex) => {
    keepTopLeft(s, b, b.w + ex, b.h);
    s.nine = { l: 11, t: 0, r: 511, b: 0 };
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
  // (the tutorial's is the original's, on its map, lowered on a tall stage: it scrolls the
  // map as the original's does when a unit it follows comes near its edge, and its steps
  // point at the map where that leaves it)
  'AUTOSCROLL BORDER': (s, b, ex, ey, z = 1, drop = 0, tutorial = false) => {
    if (tutorial) {
      s.w = b.w;
      s.h = b.h;
      s.locH = b.locH;
      s.locV = b.locV + drop;
      return;
    }
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

// The right-hand panel's rows of bricks: five where the stage is a row taller than the
// original's, four (as in the original) where it is not; the panel's lower part (its rule,
// the actions, Info, Take Apart) a row lower for the fifth.
function lowerBy(ey) {
  return ey >= 24 ? 24 : 0;
}

// The right-hand panel on an upright stage (a phone held upright: far taller than wide, with
// room to spare below), its buttons taller to be pressed with a thumb, as wide as before:
// the Menu button, the two actions, Info and Take Apart. The panel is spaced out to fit them.
const PANEL = new Set([6, 7, 10, 11, 13, 14]);
for (let c = 72; c <= 100; c++) PANEL.add(c);
const PANEL_BUTTONS = new Set([6, 91, 93, 95, 97]);
function buttonH(rt) {
  const st = rt.stage;
  if (st.height - BASE_H < 200 || st.height <= st.width) return 0;
  return Math.min(56, 16 + Math.floor((st.height - BASE_H) / 10));
}
// Where a place on the original panel (its height v) is: a row lower below the bricks for a
// fifth (lowerBy); on an upright stage, below the taller Menu button, and the lower part's
// buttons stacked at their height.
function panelV(rt, v, ey) {
  const low = lowerBy(ey);
  const h = buttonH(rt);
  if (!h) return v + (v >= 320 ? low : 0);
  const d = h - 16;
  if (v < 40) return v + Math.round(d / 2);           // the Menu button and its label
  if (v < 320) return v + d;                          // the minimap, the unit or plan shown
  // the lower part, in its order: the actions' label, two actions, the rule, Info, Take Apart
  const label = 328 + low + d;
  const b1 = label + 12 + h / 2, b2 = b1 + h + 8;
  const rule = b2 + h / 2 + 12, b3 = rule + 12 + h / 2, b4 = b3 + h + 8;
  const places = [[328, label], [347, b1], [371, b2], [388, rule], [404, b3], [427, b4]];
  let best = places[0];
  for (const p of places) if (Math.abs(p[0] - v) < Math.abs(best[0] - v)) best = p;
  return Math.round(best[1] + (v - best[0]));
}

function keepTopLeft(s, b, w, h) {
  s.w = w;
  s.h = h;
  const m = s.member;
  s.locH = b.left + Math.round(m.regX * w / m.width);
  s.locV = b.top + Math.round(m.regY * h / m.height);
}

// A touch screen's finger, in stage pixels, at the least (the tutorial's holes: placeTutorial)
const FINGER = 44;
function touchScreen() {
  return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

function classic(rt) {
  const glob = rt.globals.glob;
  return !!(glob && L.t(L.gi(glob, L.sym('tutorialMode'))));
}
