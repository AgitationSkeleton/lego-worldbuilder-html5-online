// Screensaver Mode (the main menu's): generated missions played by the computer to watch, one
// after another.  Each is a new one, made as the random-mission panel makes one when it is
// left as it is (any difficulty, any look, any generator: src/online/puzzle.js), and started
// the same way, so that it goes into the Seed History (src/online/history.js) to play later
// and to the server's log of generated missions (src/online/scores.js, announce) as any other.
// It is played by the same player the generator's missions are checked with
// (src/online/autoplay.js), at the game's own speed, the view following the unit it is
// moving; when the mission is done, or the player gets nowhere with it, the next.
//
// The game is not the player's while it runs: clicks and keys on it do nothing, but for the
// game's menu (Escape, or the pause button on a touch screen, opens it: src/online/controls.js),
// whose End Mission ends Screensaver Mode for the main menu, as the settings' Main Menu does.
// The view is the watcher's, as in CrystAlien Conflict Online's: dragged (any button, a finger),
// zoomed (the wheel, two fingers), moved by the arrow keys; the camera then leaves it be a while
// before following the unit again.

import * as L from '../director/lingo.js';
import { autoplay, liveTicks } from './autoplay.js';
import { GENERATORS } from './puzzle.js';
import { el } from './dom.js';

// How long a mission is watched after it is done, and at most
const AFTER = 5000;
const AT_MOST = 25 * 60 * 1000;
const TAKEOVER = 8000;        // how long the camera leaves the view where the watcher put it

export class Screensaver {
  constructor(ui, canvas) {
    this.ui = ui;
    this.rt = ui.rt;
    this.canvas = canvas;
    this.on = false;
    this.atMost = AT_MOST;      // (a test may watch a mission for less)
    this.takeover = TAKEOVER;   // (and wait less to follow again)
    this.blockInput();
    // (on a touch screen, which has no Escape: a pause button for the game's menu, as
    // CrystAlien Conflict Online's Screensaver has; hidden while the menu is open, which has
    // its own Continue)
    this.pause = el('button', { type: 'button', id: 'ss-pause', title: 'Pause', 'aria-label': 'Pause', text: '≡', hidden: '',
      onpointerdown: (e) => { e.preventDefault(); e.stopPropagation(); if (this.ui.controls) this.ui.controls.toggleGameMenu(); this.showPause(); } });
    document.body.append(this.pause);
  }
  showPause() {
    const controls = this.ui.controls;
    this.pause.hidden = !this.on || !!(controls && controls.gameMenuOpen) || this.rt.labelAt(this.rt.frame) !== 'play';
  }

  // A new code, of any difficulty, look and generator.
  newCode() {
    const looks = 'ABCDE';
    const look = looks[Math.floor(Math.random() * looks.length)];
    const pool = GENERATORS.filter((g) => g.looks.includes(look));
    const version = pool[Math.floor(Math.random() * pool.length)].version;
    return this.ui.random.newCode(1 + Math.floor(Math.random() * 3), look, version);
  }

  start() {
    if (this.on) return;
    this.on = true;
    this.run = (this.run || 0) + 1;
    this.ui.enterGame({ map: false });
    this.ui.panel.hidden = true;
    document.documentElement.classList.add('screensaver');
    // (the map the whole screen: the game's panel and plans bar not drawn, layout.hidden)
    if (this.rt.layout) this.rt.layout.hideUI = true;
    this.rt.needsDraw = true;
    clearInterval(this.pauseTimer);
    this.pauseTimer = setInterval(() => this.showPause(), 250);
    // (the screen kept on while it is watched)
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then((l) => { this.lock = l; }, () => {}); } catch (e) { /* none */ }
    this.loop(this.run);
  }

  // Ended (the game's End Mission, the settings' Main Menu): the mission left as it is, and the
  // main menu.
  stop() {
    if (!this.on) return;
    this.on = false;
    document.documentElement.classList.remove('screensaver');
    if (this.rt.layout) this.rt.layout.hideUI = false;
    this.rt.needsDraw = true;
    clearInterval(this.pauseTimer);
    this.pause.hidden = true;
    if (this.lock) { try { this.lock.release(); } catch (e) { /* none */ } this.lock = null; }
    this.highlight(null);
  }

  async loop(run) {
    const ui = this.ui, rt = this.rt;
    const live = run === this.run && this.on;
    if (!live) return;
    const ticks = liveTicks(rt);
    while (this.on && run === this.run) {
      const code = this.newCode();
      if (!code) { await this.wait(1000); continue; }
      this.focused = null;
      const began = performance.now();
      // (the goal's popup shown a while, then gone on from, as a player goes for the bonus)
      let popupSince = 0;
      const popups = setInterval(() => {
        const glob = rt.started && rt.globals.glob;
        // (the unit followed stays the one chosen: the game chooses another at times, or none)
        if (glob && this.focused && L.gi(glob, L.sym('highlighted_object')) !== this.focused && !L.t(L.gp(this.focused, 'pdead'))) this.highlight(this.focused);
        // (the view left alone a while after the watcher moved it: back to following the unit)
        if (this.viewUntil && !this.watching()) {
          this.viewUntil = 0;
          if (this.focused && !L.t(L.gp(this.focused, 'pdead'))) { try { L.mc(L.gp(glob, 'map_display'), 'centervehicle', this.focused); } catch (e) { /* gone */ } }
        }
        const popup = glob && L.gp(glob, 'goal_popup_menu');
        // (on the stage: put away, it waits just off it)
        const stage = rt.data.stage || {};
        const up = popup instanceof L.LInstance && rt.sprites.some((sp) => sp && sp.visible && sp.member && /^goal_complete_bubble/.test(sp.member.name)
          && sp.left >= 0 && sp.top >= 0 && sp.left < (stage.width || 640) && sp.top < (stage.height || 480));
        if (!up || rt.paused) { popupSince = 0; return; }
        if (!popupSince) popupSince = performance.now();
        else if (performance.now() - popupSince > 3000) {
          popupSince = 0;
          try { L.mc(popup, 'button', L.sym('continue')); } catch (e) { /* gone */ }
          rt.needsDraw = true;
        }
      }, 250);
      let r;
      try {
        r = await autoplay(rt, ui, code, {
          tick: ticks,
          // (started as the panel's Play does: into the Seed History and the server's log)
          start: (c) => ui.random.go('R-' + c),
          focus: (u) => this.follow(u),
          stopped: () => !this.on || run !== this.run || performance.now() - began > this.atMost,
        });
      } catch (e) {
        rt.reportError(e);
        r = { ok: false, why: String(e) };
      } finally {
        clearInterval(popups);
      }
      if (!this.on || run !== this.run) return;
      ui.scores.show(r.ok ? 'Mission done' : 'The computer is stuck', 'the next in a moment', '');
      await this.wait(AFTER);
      if (!this.on || run !== this.run) return;
      // (left without the main menu: the next one comes)
      this.highlight(null);
      ui.random.quietly(() => { const main = rt.movieHandlers.quitlevel.script; if (rt.labelAt(rt.frame) === 'play') rt.call(rt.scriptSelf(main), main, 'quitlevel'); });
    }
  }

  wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // The watcher has moved the view: the camera lets the unit go (the game's own following of
  // it, centerVehicle, put off), and takes it up again when the view has been left alone a while.
  takeOver() {
    this.viewUntil = performance.now() + this.takeover;
    const glob = this.rt.started && this.rt.globals.glob;
    const md = glob && L.gp(glob, 'map_display');
    try { if (md instanceof L.LInstance) L.sp(md, 'pcentergoal', undefined); } catch (e) { /* none */ }
  }
  watching() { return performance.now() < (this.viewUntil || 0); }

  // The unit the computer is moving: chosen, as a click on it chooses it (its panel shown),
  // and the view following it as it goes.
  follow(u) {
    if (!u || u === this.focused) return;
    const cls = L.gp(u, 'pclass');
    if (!cls || String(L.gi(cls, 1)) === 'monster') return;
    this.focused = u;
    this.highlight(u);
  }
  highlight(u) {
    const rt = this.rt;
    const glob = rt.started && rt.globals.glob;
    const md = glob && L.gp(glob, 'map_display');
    if (!(md instanceof L.LInstance)) return;
    try {
      if (!u) return;
      L.mc(u, 'everyoneelse', L.sym('highlight'), 0);
      L.mc(u, 'highlight', 1);
      if (!this.watching()) L.mc(md, 'centervehicle', u);
      L.mc(u, 'showmenu');
    } catch (e) {
      // (a unit just made or just taken apart: the next)
    }
    rt.needsDraw = true;
  }

  // While it runs: the game's own clicks, keys and wheel kept from it, but for its Menu button
  // and its menu.
  blockInput() {
    const stageAt = (e) => this.rt.renderer && this.rt.renderer.toStage(e.clientX, e.clientY);
    const within = (sp, x, y, pad = 2) => sp && sp.visible && x >= sp.left - pad && y >= sp.top - pad && x < sp.left + sp.width + pad && y < sp.top + sp.height + pad;
    const allowed = (e) => {
      const p = stageAt(e);
      if (!p) return false;
      const [x, y] = p;
      const name = (sp) => (sp && sp.member && sp.member.name) || '';
      const sprites = this.rt.sprites;
      // the game's menu, open
      if (this.ui.controls && this.ui.controls.gameMenuOpen && sprites.some((sp) => sp && name(sp) === 'menu_bubble' && within(sp, x, y))) return true;
      // its Menu button: the label and the button under it
      for (let c = 1; c < sprites.length; c++) {
        if (name(sprites[c]) !== 'label.menu' || !sprites[c].visible) continue;
        for (let b = c - 1; b > 0 && b >= c - 3; b--) if (/button/.test(name(sprites[b])) && within(sprites[b], x, y)) return true;
      }
      return false;
    };
    const stop = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
    // The view the watcher's to move, as in CrystAlien Conflict Online's: a drag (any button, a
    // finger) moves the map, two fingers or the wheel zoom it, the arrow keys (and W, A, S, D)
    // move it; never a click on the game.  The camera lets the unit go a while after (takeOver).
    const drags = new Map();          // pointerId -> {x, y} (stage pixels), and a carry
    let carry = [0, 0], pinch = null;
    const stageOf = (e) => (this.rt.renderer && this.rt.renderer.toStage(e.clientX, e.clientY)) || [0, 0];
    const pan = (e) => {
      const d = drags.get(e.pointerId);
      if (!d) return;
      const [x, y] = stageOf(e);
      if (drags.size >= 2) {
        // (two fingers: the zoom by how far apart they are, about the middle of them)
        d.x = x; d.y = y;
        const [a, b] = [...drags.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch && pinch.d > 0 && dist > 0 && this.rt.layout) this.rt.layout.zoomBy(dist / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch = { d: dist };
        this.takeOver();
        return;
      }
      const z = (this.rt.layout && this.rt.layout.zoom) || 1;
      carry[0] += (x - d.x) / z;
      carry[1] += (y - d.y) / z;
      d.x = x; d.y = y;
      const mx = Math.trunc(carry[0]), my = Math.trunc(carry[1]);
      carry[0] -= mx; carry[1] -= my;
      if ((mx || my) && this.ui.controls) { this.ui.controls.move(mx, my); this.takeOver(); }
    };
    const onCanvas = (e) => e.target === this.canvas;
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'pointermove', 'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'contextmenu', 'auxclick', 'wheel', 'touchstart', 'touchmove', 'touchend']) {
      window.addEventListener(type, (e) => {
        if (!this.on) return;
        // (a drag goes on wherever the pointer goes, once begun on the game)
        if ((type === 'pointermove' || type === 'pointerup' || type === 'pointercancel') && drags.has(e.pointerId)) {
          if (type === 'pointermove') pan(e);
          else { drags.delete(e.pointerId); pinch = null; carry = [0, 0]; }
          stop(e);
          return;
        }
        if (!onCanvas(e)) return;
        const pt = e.touches && e.touches[0] ? e.touches[0] : e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : e;
        if (/^(pointer|mouse|click|dbl)/.test(type) && allowed(pt)) return;
        // (the wheel zooms, as the page has it: src/main.js)
        if (type === 'wheel') { this.takeOver(); return; }
        if (type === 'pointerdown') {
          const [x, y] = stageOf(e);
          drags.set(e.pointerId, { x, y });
          pinch = null;
          try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* (not to be had) */ }
        }
        stop(e);
      }, { capture: true, passive: false });
    }
    // (keys: Escape for the game's menu, the arrows and W, A, S, D for the view, the page's own
    // fields and panels; nothing else)
    const VIEW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
    const VIEW_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
    for (const type of ['keydown', 'keyup']) {
      window.addEventListener(type, (e) => {
        if (!this.on || e.key === 'Escape') return;
        if (e.target instanceof Element && e.target.closest('input, textarea, select, button, a[href], .panel, #menu')) return;
        if (VIEW_KEYS.has(e.key) || (VIEW_CODES.has(e.code) && !e.ctrlKey && !e.altKey && !e.metaKey)) { this.takeOver(); return; }
        stop(e);
      }, true);
    }
  }
}
