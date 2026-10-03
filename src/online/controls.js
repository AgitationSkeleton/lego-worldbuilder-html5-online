// What the settings switch on for the mouse, the keys and the sound (src/online/settings.js):
//
// - the right mouse button and the middle one drag the map, as a finger does (touch.js),
//   and a right click that does not drag puts down the unit chosen;
// - held arrow keys move the map smoothly, a little at every drawing, rather than a tile at
//   a time as the game's own keys do;
// - the game's Menu button holds the game still while its menu is open (not in a race);
// - the music, the sounds and the interface's sounds each have a loudness of their own: the
//   game's sounds asked for as sfx_interface_... are the interface's.

import * as L from '../director/lingo.js';
import { shiftMap } from './touch.js';

const DRAG_START = 6;          // CSS pixels the mouse moves, a button held, before it drags
const KEY_SPEED = 700;         // stage pixels a second the arrow keys move the map

export class Controls {
  constructor(rt, ui) {
    this.rt = rt;
    this.ui = ui;
  }
  get settings() { return this.ui.settings; }

  mapDisplay() {
    const rt = this.rt;
    const glob = rt.globals.glob;
    if (!glob || rt.labelAt(rt.frame) !== 'play') return null;
    const md = L.gp(glob, 'map_display');
    return md instanceof L.LInstance ? md : null;
  }
  classic() {
    const glob = this.rt.globals.glob;
    return !!(glob && L.t(L.gi(glob, L.sym('tutorialMode'))));
  }
  // (the map moved between frames: what is on it goes along, see layout.carryMap)
  move(dx, dy) {
    const md = this.mapDisplay();
    if (!md || (!dx && !dy)) return;
    try {
      if (this.rt.layout && this.rt.layout.carryMap) this.rt.layout.carryMap(() => shiftMap(md, dx, dy));
      else shiftMap(md, dx, dy);
    } catch (e) {
      this.rt.reportError(e);
    }
    this.rt.needsDraw = true;
  }

  // Hooks into the game's scripts, before the runtime binds them.
  install(scripts) {
    const self = this;
    for (const s of scripts) {
      // the game's menu, open: the game held still (see menuPauses)
      if (s.name === 'main menu popup behavior') {
        for (const [name, on] of [['show', true], ['hide', false]]) {
          const f = s.handlers[name];
          if (!f) continue;
          s.handlers[name] = function (...args) {
            const r = f.apply(this, args);
            self.menuOpen(on);
            return r;
          };
        }
      }
      // the sounds the game asks for as sfx_interface_... are the interface's
      if (s.type === 'movie' && s.handlers.sndsfx) {
        const sfx = s.handlers.sndsfx;
        s.handlers.sndsfx = function (which, ...rest) {
          const sound = self.rt.sound;
          const before = sound.kindHint;
          sound.kindHint = /^sfx_interface/i.test(String(which)) ? 'ui' : before;
          try {
            return sfx.call(this, which, ...rest);
          } finally {
            sound.kindHint = before;
          }
        };
      }
    }
  }

  menuOpen(on) {
    const races = this.ui.races;
    const racing = !!(races && races.racing && races.racing.started);
    this.rt.setPaused(on && this.settings.menuPauses && !racing);
  }

  applyVolumes() {
    const sound = this.rt.sound;
    for (const kind of ['music', 'sound', 'ui']) sound.setVolume(kind, this.settings[kind]);
  }

  // A sound of the game's, as its interface plays it (the main menu's buttons).
  sfx(name) {
    const rt = this.rt;
    const h = rt.movieHandlers.sndsfx;
    // (not before the browser lets sound out: they would all play at once when it does)
    if (!rt.started || !h || !rt.sound.ctx || rt.sound.ctx.state !== 'running') return;
    try {
      rt.call(rt.scriptSelf(h.script), h.script, 'sndsfx', name);
    } catch (e) {
      rt.reportError(e);
    }
  }

  // The mouse's other buttons, on the game's canvas.
  installMouse(canvas) {
    let held = null;      // {button, x, y, dragging}
    const pans = (b) => (b === 2 && this.settings.panRight) || (b === 1 && this.settings.panMiddle);
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || (e.button !== 1 && e.button !== 2)) return;
      e.preventDefault();
      if (!this.mapDisplay() || this.classic()) return;
      held = { button: e.button, x: e.clientX, y: e.clientY, dragging: false };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!held || e.pointerType !== 'mouse') return;
      const dx = e.clientX - held.x, dy = e.clientY - held.y;
      if (!held.dragging) {
        if (!pans(held.button) || Math.hypot(dx, dy) < DRAG_START) return;
        held.dragging = true;
      }
      // (the mouse moves in CSS pixels; the map, zoomed, in its own)
      const r = this.rt.renderer;
      const z = (this.rt.layout && this.rt.layout.zoom) || 1;
      const k = r.dpr / r.scale / z;
      const mx = Math.round(dx * k), my = Math.round(dy * k);
      if (!mx && !my) return;
      this.move(mx, my);
      held.x += mx / k;
      held.y += my / k;
    });
    const up = (e) => {
      if (!held || e.button !== held.button) return;
      const h = held;
      held = null;
      if (!h.dragging && h.button === 2 && this.settings.deselectRight) this.deselect();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', () => { held = null; });
    canvas.addEventListener('auxclick', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  }

  // A right click: the unit chosen is put down, and whatever it waited for a click to do.
  deselect() {
    const rt = this.rt;
    const glob = rt.globals.glob;
    const md = this.mapDisplay();
    if (!glob || !md) return;
    try {
      L.sp(md, 'pmapclickoverride', undefined);
      L.sp(glob, 'highlighted_object', undefined);
      const rd = L.gp(glob, 'resource_display');
      if (rd instanceof L.LInstance) L.mc(rd, 'hide');
    } catch (e) {
      rt.reportError(e);
    }
  }

  // Held arrow keys: the map moves a little at every drawing, the game's own tile-a-time
  // scrolling left out.
  installKeys() {
    const held = new Set();
    const DIRS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    let last = 0, running = false;
    const active = () => this.settings.smoothKeys && this.mapDisplay() && !this.classic();
    const typing = (e) => e.target instanceof Element && !!e.target.closest('input, textarea, select, button, a[href], [contenteditable], .panel, #menu');
    const step = (now) => {
      if (!held.size || !active()) { running = false; held.clear(); return; }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      let x = 0, y = 0;
      for (const k of held) { x += DIRS[k][0]; y += DIRS[k][1]; }
      const z = (this.rt.layout && this.rt.layout.zoom) || 1;
      const d = KEY_SPEED * dt / z;
      // (the view goes the way of the arrow: the map the other way)
      this.carry = (this.carry || [0, 0]);
      this.carry[0] -= x * d;
      this.carry[1] -= y * d;
      const mx = Math.trunc(this.carry[0]), my = Math.trunc(this.carry[1]);
      this.carry[0] -= mx;
      this.carry[1] -= my;
      this.move(mx, my);
      requestAnimationFrame(step);
    };
    window.addEventListener('keydown', (e) => {
      if (!DIRS[e.key] || typing(e) || !active()) return;
      // (not the game's: it would scroll a tile as well)
      e.preventDefault();
      e.stopImmediatePropagation();
      held.add(e.key);
      if (!running) {
        running = true;
        last = performance.now();
        requestAnimationFrame(step);
      }
    }, true);
    window.addEventListener('keyup', (e) => {
      if (!DIRS[e.key]) return;
      held.delete(e.key);
    }, true);
    window.addEventListener('blur', () => held.clear());
  }
}
