// The Director runtime: casts, the score and its frame cycle, events, input, and the
// built-in functions and "the" properties the translated Lingo calls on.

import * as L from './lingo.js';
import { LList, LPropList, LPoint, LRect, LColor, LInstance, LSymbol, sym, str, num, toInt } from './lingo.js';
import { CastLib, Member, NullMember, BitmapMember, ShapeMember, SoundMember, ScriptMember,
  PaletteMember, FontMember, TextMember, ButtonMember } from './members.js';
import { Sprite } from './sprite.js';
import { Renderer } from './render.js';
import { SoundSystem } from './sound.js';
import { LImage } from './image.js';
import { TextMeasure } from './text.js';

// Mac virtual key codes, which Director reports as the keyCode on every platform.
const KEYCODES = {
  ArrowLeft: 123, ArrowRight: 124, ArrowDown: 125, ArrowUp: 126, Space: 49, Enter: 36,
  NumpadEnter: 76, Tab: 48, Backspace: 51, Escape: 53, Delete: 117,
  KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyH: 4, KeyG: 5, KeyZ: 6, KeyX: 7, KeyC: 8, KeyV: 9,
  KeyB: 11, KeyQ: 12, KeyW: 13, KeyE: 14, KeyR: 15, KeyY: 16, KeyT: 17, Digit1: 18, Digit2: 19,
  Digit3: 20, Digit4: 21, Digit6: 22, Digit5: 23, Equal: 24, Digit9: 25, Digit7: 26, Minus: 27,
  Digit8: 28, Digit0: 29, BracketRight: 30, KeyO: 31, KeyU: 32, BracketLeft: 33, KeyI: 34,
  KeyP: 35, KeyL: 37, KeyJ: 38, Quote: 39, KeyK: 40, Semicolon: 41, Backslash: 42, Comma: 43,
  Slash: 44, KeyN: 45, KeyM: 46, Period: 47, Backquote: 50,
};

const MOUSE_EVENTS = ['mousedown', 'mouseup', 'mouseenter', 'mouseleave', 'mousewithin', 'mouseupoutside',
  'rightmousedown', 'rightmouseup'];

class Timeout {
  constructor(rt, name) { this.rt = rt; this.name = name; this.period = 0; this.handler = null; this.target = undefined; this.next = 0; this.active = false; }
  lgCall(name, args) {
    if (name === 'new') {
      this.period = Math.max(1, toInt(args[0]));
      this.handler = args[1];
      this.target = args[2];
      this.next = this.rt.millis() + this.period;
      this.active = true;
      this.rt.timeouts.set(this.name, this);
      return this;
    }
    if (name === 'forget') { this.active = false; this.rt.timeouts.delete(this.name); return; }
    throw new L.LingoError('timeout has no method ' + name);
  }
  lgGet(name) {
    switch (name) {
      case 'name': return this.name;
      case 'period': return this.period;
      case 'target': return this.target;
      case 'persistent': return 0;
      case 'time': return this.next;
    }
    return undefined;
  }
  lgSet(name, v) {
    if (name === 'period') this.period = toInt(v);
    if (name === 'target') this.target = v;
  }
  lgIlk() { return 'timeout'; }
  lgRepr() { return 'timeout("' + this.name + '")'; }
}

// script("name"): a script member as an object, which makes instances with new.
class ScriptRef {
  constructor(rt, script) { this.rt = rt; this.script = script; }
  lgCall(name, args) {
    if (name === 'new') return this.rt.newInstance(this.script, args);
    const h = this.script.handlers[name];
    if (h) return h.call(this.rt.scriptSelf(this.script), this, ...args);
    throw new L.LingoError('script has no handler ' + name);
  }
  lgGet(name) {
    if (name === 'name') return this.script.name;
    if (name === 'handlers') return new LList(Object.keys(this.script.handlers).map(sym));
    return undefined;
  }
  lgIlk() { return 'script'; }
  lgRepr() { return '(script "' + this.script.name + '")'; }
  lgEquals(o) { return o instanceof ScriptRef && o.script === this.script; }
}

export class Runtime {
  constructor({ game, data, scripts, canvas, assetBase, options }) {
    this.game = game;
    this.data = data;
    this.scriptsModule = scripts;
    this.canvas = canvas;
    this.assetBase = assetBase;
    this.options = options || {};
    this.stage = { ...data.stage };
    this.baseStage = { width: data.stage.width, height: data.stage.height };
    // A layout (src/online/layout.js) may size the stage to the window; without one the
    // stage is the movie's, scaled to fit.
    this.layout = this.options.layout || null;
    this.box = null;
    this.globals = Object.create(null);
    this.casts = [];
    this.nameIndex = new Map();
    this.scriptByMember = new Map();
    this.movieScripts = [];
    this.scriptSelves = new Map();
    this.sprites = [];
    this.channels = data.channels || 1000;
    this.actorList = new LList();
    this.timeouts = new Map();
    this.frame = 0;
    this.goTarget = null;
    this.goPending = false;
    this.frameScript = null;     // { key, instances }
    this.errors = [];
    this.textMeasure = new TextMeasure();
    this.renderer = new Renderer(this, canvas);
    this.sound = new SoundSystem(this);
    this.nullMember = new NullMember(this);
    this.mouse = { x: 0, y: 0, down: false, clickOn: 0, rollover: 0, downSprite: 0 };
    this.keyInfo = { key: '', keyCode: 0, shift: false, control: false, alt: false, meta: false };
    this.exitLock = 0;
    this.cursorSpec = 0;
    this.cursorDirty = true;
    this.cursorCache = new Map();
    this.zOrderDirty = true;
    this.passed = false;
    this.puppetTempo = 0;
    this.inFrameCycle = 0;
    this.startTime = performance.now();
    this.testMode = !!this.options.test;
    this.virtualTime = 0;
    this.rng = this.options.seed !== undefined ? mulberry32(this.options.seed) : Math.random;
    this.builtins = makeBuiltins(this);
    this.prefPrefix = 'lego-wb-html5:';
    this.framesData = data.score;
    this.labels = data.labels;
    this.spanIds = computeSpans(data.score, this.channels);
    L.setWarningHandler((msg) => { if (this.options.verbose) console.warn('[lingo] ' + msg); });
  }

  // ---------- loading ----------

  async load(onProgress) {
    const bin = await fetchBytes(this.assetBase + 'bitmaps.bin');
    const snd = await fetchBytes(this.assetBase + 'sounds.bin');
    this.bitmapBytes = bin;
    const winPal = this.findPalette();
    LImage.palette = winPal;
    const scripts = this.scriptsModule.scripts;
    for (const s of scripts) this.scriptByMember.set(s.castLib + ':' + s.member, s);
    this.data.casts.forEach((c, i) => {
      const lib = new CastLib(this, i + 1, c.name);
      this.casts.push(lib);
      for (const [numStr, rec] of Object.entries(c.members)) {
        const n = parseInt(numStr, 10);
        const m = this.makeMember(i + 1, n, rec);
        lib.members.set(n, m);
      }
    });
    // names: the first member of that name, in cast order
    for (const lib of this.casts) {
      const nums = [...lib.members.keys()].sort((a, b) => a - b);
      for (const n of nums) {
        const m = lib.members.get(n);
        if (m.name) {
          const k = m.name.toLowerCase();
          if (!this.nameIndex.has(k)) this.nameIndex.set(k, m);
        }
      }
    }
    for (const s of scripts) if (s.type === 'movie') this.movieScripts.push(s);
    this.movieHandlers = Object.create(null);
    for (const s of this.movieScripts) {
      for (const [name, fn] of Object.entries(s.handlers)) {
        if (!this.movieHandlers[name]) this.movieHandlers[name] = { fn, script: s };
      }
    }
    // decode the bitmaps and sounds
    const jobs = [];
    let done = 0, total = 0;
    for (const lib of this.casts) {
      for (const m of lib.members.values()) {
        if (m instanceof BitmapMember && m.rec.png) {
          total++;
          const [off, len] = m.rec.png;
          jobs.push(createImageBitmap(new Blob([new Uint8Array(bin, off, len)], { type: 'image/png' }))
            .then(b => { m.source = b; done++; if (onProgress) onProgress(done / total); })
            .catch(() => { done++; }));
        } else if (m instanceof SoundMember && m.rec.data) {
          const [off, len] = m.rec.data;
          jobs.push(this.sound.decode(m, snd.slice(off, off + len)));
        }
      }
    }
    await Promise.all(jobs);
    this.scriptsModule.bind(this);
  }
  findPalette() {
    // the movie's palette is Windows' system palette; take it from a palette member if the
    // movie has one by that name, else the built-in one baked into the data
    return this.data.systemPalette;
  }
  makeMember(lib, n, rec) {
    switch (rec.type) {
      case 'bitmap': {
        const m = new BitmapMember(this, lib, n, rec);
        if (rec.indices) {
          const self = this;
          const get = m.get.bind(m);
          m.get = function (name) {
            const r = get(name);
            if (name === 'image' && r && !r.indices && this._indicesFresh !== false) {
              r.indices = unrle(new Uint8Array(self.bitmapBytes, rec.indices[0], rec.indices[1]), m.w * m.h);
              this._indicesFresh = false;
            }
            return r;
          };
        }
        return m;
      }
      case 'shape': return new ShapeMember(this, lib, n, rec);
      case 'sound': return new SoundMember(this, lib, n, rec);
      case 'script': return new ScriptMember(this, lib, n, rec, this.scriptByMember.get(lib + ':' + n));
      case 'palette': return new PaletteMember(this, lib, n, rec);
      case 'font': return new FontMember(this, lib, n, rec);
      case 'text': return new TextMember(this, lib, n, rec);
      case 'button': return new ButtonMember(this, lib, n, rec);
      default: return new Member(this, lib, n, rec);
    }
  }

  // ---------- members and scripts ----------

  memberRef(lib, n) {
    const c = this.casts[lib - 1];
    if (!c) return null;
    return c.members.get(n) || null;
  }
  // member(x [, castLib])
  member(x, lib) {
    if (x instanceof Member) return x;
    let libNum = 0;
    if (lib !== undefined) {
      if (typeof lib === 'string') {
        const i = this.casts.findIndex(c => c.name.toLowerCase() === lib.toLowerCase());
        libNum = i + 1;
      } else if (lib instanceof CastLib) libNum = lib.number;
      else libNum = toInt(lib);
    }
    if (typeof x === 'string' || x instanceof LSymbol) {
      const name = str(x).toLowerCase();
      if (libNum > 0) {
        const c = this.casts[libNum - 1];
        if (c) for (const m of c.members.values()) if (m.name.toLowerCase() === name) return m;
        return this.nullMember;
      }
      return this.nameIndex.get(name) || this.nullMember;
    }
    let n = toInt(x);
    if (libNum === 0) {
      if (n > 65535) { libNum = n >> 16; n = n & 0xffff; } else libNum = 1;
    }
    const c = this.casts[libNum - 1];
    if (!c) return this.nullMember;
    let m = c.members.get(n);
    if (!m) {
      // an empty slot: a member of no type, which scripts can still test
      m = new Member(this, libNum, n, { name: '', type: 'empty' });
      c.members.set(n, m);
    }
    return m;
  }
  renameMember(m, name) {
    if (m.name) {
      const k = m.name.toLowerCase();
      if (this.nameIndex.get(k) === m) this.nameIndex.delete(k);
    }
    m.name = name;
    const k = name.toLowerCase();
    if (k && !this.nameIndex.has(k)) this.nameIndex.set(k, m);
  }
  scriptNamed(x, lib) {
    const m = this.member(x, lib);
    if (m instanceof ScriptMember && m.script) return m.script;
    return null;
  }
  scriptObject(m) { return m.script ? new ScriptRef(this, m.script) : undefined; }
  // new(#bitmap) and the like: a member in the first free slot of the first cast.
  newMember(type) {
    const c = this.casts[0];
    let n = 1;
    while (c.members.has(n) && c.members.get(n).rec && c.members.get(n).rec.type !== 'empty') n++;
    const rec = { name: '', type };
    const m = type === 'bitmap' ? new BitmapMember(this, 1, n, { ...rec, width: 0, height: 0, regX: 0, regY: 0 })
      : type === 'text' ? new TextMember(this, 1, n, rec) : type === 'sound' ? new SoundMember(this, 1, n, rec)
        : new Member(this, 1, n, rec);
    c.members.set(n, m);
    return m;
  }
  duplicateMember(m, where) {
    const n = this.newMember(m.rec ? m.rec.type : 'empty');
    return n;
  }
  eraseMember(m) {
    const c = this.casts[m.castLib - 1];
    if (c) c.members.delete(m.number);
    if (m.name && this.nameIndex.get(m.name.toLowerCase()) === m) this.nameIndex.delete(m.name.toLowerCase());
  }
  // The object a movie or member script's handlers run as.
  scriptSelf(script) {
    let s = this.scriptSelves.get(script);
    if (!s) { s = new LInstance(script); this.scriptSelves.set(script, s); }
    return s;
  }
  newInstance(script, args) {
    const inst = new LInstance(script);
    const h = script.handlers['new'];
    if (h) return h.call(inst, inst, ...args);
    return inst;
  }

  // ---------- calling handlers ----------

  // A handler called by name, as Lingo resolves it: an object's own handler when the
  // first argument is an object that has it, then this script's, then a movie script's,
  // then a built-in function.
  call(self, script, name, ...args) {
    const a0 = args[0];
    if (a0 instanceof LInstance) {
      const h = a0.findHandler(name);
      if (h) return h.fn.call(h.inst, a0, ...args.slice(1));
    } else if (a0 instanceof ScriptRef) {
      if (name === 'new') return this.newInstance(a0.script, args.slice(1));
      const h = a0.script.handlers[name];
      if (h) return h.call(this.scriptSelf(a0.script), ...args);
    }
    const own = script.handlers[name];
    if (own) return own.call(self, ...args);
    const mh = this.movieHandlers[name];
    if (mh) return mh.fn.call(this.scriptSelf(mh.script), ...args);
    const b = this.builtins[name];
    if (b) return b(...args);
    const lf = L.listFunction(name, args);
    if (lf !== L.NOT_FOUND) return lf;
    if (a0 && a0.lgCall) return a0.lgCall(name, args.slice(1));
    this.warn('Handler not defined: ' + name);
    return undefined;
  }
  warn(msg) {
    if (this.options.verbose) console.warn(msg);
  }
  // Run a handler as an event, keeping an error in it from stopping the movie.
  guard(fn) {
    try {
      return fn();
    } catch (e) {
      this.reportError(e);
      return undefined;
    }
  }
  reportError(e) {
    this.errors.push(String(e && e.stack || e));
    console.error('Script error:', e);
    if (this.onError) this.onError(e);
  }

  // An event to one script instance; true if it had a handler.
  sendTo(inst, event, args) {
    if (!(inst instanceof LInstance)) return false;
    const h = inst.findHandler(event);
    if (!h) return false;
    this.passed = false;
    this.guard(() => h.fn.call(h.inst, inst, ...args));
    return !this.passed;
  }
  // An event to a sprite's behaviors: all of them hear it.
  sendSprite(ch, event, args = []) {
    const s = this.sprites[ch];
    if (!s) return false;
    let handled = false;
    for (const inst of s.scriptInstances.slice()) {
      if (inst instanceof LInstance && inst.findHandler(event)) {
        if (this.sendTo(inst, event, args)) handled = true;
      }
    }
    return handled;
  }
  sendMemberScript(ch, event, args) {
    const s = this.sprites[ch];
    if (!s || !s.member || !s.member.rec || !s.member.rec.hasScript) return false;
    const script = this.scriptByMember.get(s.member.castLib + ':' + s.member.number);
    if (!script) return false;
    const h = script.handlers[event];
    if (!h) return false;
    this.passed = false;
    this.guard(() => h.call(this.scriptSelf(script), this.scriptSelf(script), ...args));
    return !this.passed;
  }
  sendFrameScript(event, args) {
    if (!this.frameScript) return false;
    let handled = false;
    for (const inst of this.frameScript.instances) if (this.sendTo(inst, event, args)) handled = true;
    return handled;
  }
  sendMovie(event, args = []) {
    let handled = false;
    for (const s of this.movieScripts) {
      const h = s.handlers[event];
      if (h) {
        this.passed = false;
        this.guard(() => h.call(this.scriptSelf(s), ...args));
        handled = true;
      }
    }
    return handled;
  }
  // prepareFrame, enterFrame, exitFrame: every sprite, then the frame script.
  frameEvent(event) {
    for (let ch = 1; ch < this.sprites.length; ch++) {
      const s = this.sprites[ch];
      if (s && s.scriptInstances.length) this.sendSprite(ch, event);
    }
    if (!this.sendFrameScript(event, [])) this.sendMovie(event);
  }

  // ---------- the score ----------

  sprite(n) {
    n = toInt(n);
    if (n < 0) n = 0;
    let s = this.sprites[n];
    if (!s) { s = new Sprite(this, n); this.sprites[n] = s; }
    return s;
  }
  frameCount() { return this.framesData.length; }
  labelFrame(name) {
    const k = str(name).toLowerCase();
    const l = this.labels.find(x => x.name.toLowerCase() === k);
    return l ? l.frame : 0;
  }
  // How far a sprite is zoomed beyond the stage's scale: 1, unless a layout zooms some
  // sprites (World Builder Online's map: src/online/layout.js), which are then drawn, and
  // tested for the mouse, at that zoom about the stage's corner.
  zoomOf(s) {
    return this.layout && this.layout.zoomOf ? this.layout.zoomOf(s) : 1;
  }
  // The marker a frame is under: the last one at or before it.
  labelAt(f) {
    let name = null;
    for (const l of this.labels) if (l.frame <= f) name = l.name;
    return name;
  }
  // The window changed the stage's size: sprites anchored to its edges move with them.
  setStageSize(w, h) {
    this.stage.width = w;
    this.stage.height = h;
    const ex = w - this.baseStage.width, ey = h - this.baseStage.height;
    for (const s of this.sprites) {
      const a = s && s.anchor;
      if (!a) continue;
      const dx = Math.round(a.ax * ex), dy = Math.round(a.ay * ey);
      s.locH += dx - a.dx;
      s.locV += dy - a.dy;
      a.dx = dx;
      a.dy = dy;
      if (a.grow) a.grow(s, ex, ey);
    }
    if (this.layout) {
      this.box = this.layout.boxFor(this.labelAt(this.frame), this);
      if (this.started) this.layout.resized(this);
    }
    this.needsDraw = true;
  }
  frameLabel(f) {
    let label = null;
    for (const l of this.labels) if (l.frame === f) label = l.name;
    return label;
  }
  go(target) {
    let f;
    if (target instanceof LSymbol && ['next', 'previous', 'loop'].includes(target.key)) {
      // go next, go previous, go loop: by markers
      f = this.builtins.marker(target.key === 'next' ? 1 : target.key === 'previous' ? -1 : 0);
    } else if (typeof target === 'string' || target instanceof LSymbol) {
      f = this.labelFrame(target);
      if (!f) { this.warn('go: no marker ' + str(target)); return; }
    } else f = toInt(target);
    if (f < 1) f = 1;
    if (f > this.frameCount()) f = this.frameCount();
    if (this.started && !this.inFrameCycle) {
      // From an event handler, Director suspends the handler, moves the playhead and runs
      // the new frame's beginSprite, prepareFrame and enterFrame, then lets the handler
      // finish.  So the frame changes here, before go returns.
      this.goPending = false;
      this.goTarget = null;
      this.enterFrameNow(f);
      return;
    }
    this.goTarget = f;
    this.goPending = true;
  }
  enterFrameNow(f) {
    this.inFrameCycle++;
    try {
      this.enterScoreFrame(f);
      this.stepActors();
      this.frameEvent('prepareframe');
      this.needsDraw = true;
      this.frameEvent('enterframe');
    } finally {
      this.inFrameCycle--;
    }
  }
  behaviorInstances(list) {
    const out = [];
    for (const [lib, num, params] of list) {
      const script = this.scriptByMember.get(lib + ':' + num);
      if (!script) continue;
      const inst = new LInstance(script);
      if (params) {
        const p = L.value(params);
        if (p instanceof LPropList) {
          for (let i = 0; i < p.k.length; i++) inst.$[str(p.k[i]).toLowerCase()] = p.v[i];
        }
      }
      out.push(inst);
    }
    return out;
  }
  // Move the channels to frame f: sprites whose span ends are told so, and new ones begin.
  enterScoreFrame(f) {
    // a new marker may want another stage size: settle it before its sprites are placed
    if (this.layout && this.renderer && this.labelAt(f) !== this.labelAt(this.frame)) this.renderer.resize();
    const fr = this.framesData[f - 1];
    const spans = this.spanIds[f - 1];
    const begins = [];
    const ends = [];
    const maxCh = Math.max(this.sprites.length - 1, spans.length - 1);
    for (let ch = 1; ch <= maxCh; ch++) {
      const s = this.sprites[ch];
      const span = spans[ch] || 0;
      if (s && s.puppet) continue;
      if (!s && !span) continue;
      const spr = this.sprite(ch);
      if (spr.spanKey === span) continue;
      if (spr.scriptInstances.length && spr.fromScore) ends.push(spr);
      const sp = fr.sprites[ch];
      spr.endInstances = spr.scriptInstances;
      spr.loadFromScore(sp);
      spr.anchor = null;
      spr.nine = null;
      if (this.layout && sp) this.layout.anchor(this, this.labelAt(f), ch, spr);
      spr.spanKey = span;
      spr.scriptInstances = sp && sp.behaviors ? this.behaviorInstances(sp.behaviors) : [];
      spr.fromScore = !!(sp && sp.behaviors);
      for (const inst of spr.scriptInstances) inst.spriteNum = ch;
      if (spr.scriptInstances.length) begins.push(spr);
      this.zOrderDirty = true;
    }
    // the frame script, a sprite in the script channel
    const fkey = fr.script ? fr.script.join(':') + '@' + spans[0] : null;
    const oldFrameScript = this.frameScript;
    let newFrameScript = oldFrameScript;
    if (!oldFrameScript || oldFrameScript.key !== fkey) {
      newFrameScript = fkey ? { key: fkey, instances: this.behaviorInstances([fr.script]) } : null;
    }
    // endSprite for what ends, then beginSprite for what begins
    for (const spr of ends) {
      for (const inst of spr.endInstances) this.sendTo(inst, 'endsprite', []);
    }
    if (oldFrameScript && oldFrameScript !== newFrameScript) {
      for (const inst of oldFrameScript.instances) this.sendTo(inst, 'endsprite', []);
    }
    this.frame = f;
    this.frameScript = newFrameScript;
    if (this.layout) this.box = this.layout.boxFor(this.labelAt(f), this);
    for (const spr of begins) {
      for (const inst of spr.scriptInstances.slice()) this.sendTo(inst, 'beginsprite', []);
    }
    if (newFrameScript && newFrameScript !== oldFrameScript) {
      for (const inst of newFrameScript.instances) this.sendTo(inst, 'beginsprite', []);
    }
  }

  // ---------- running ----------

  millis() {
    return this.testMode ? Math.round(this.virtualTime) : Math.round(performance.now() - this.startTime);
  }
  tempo() {
    if (this.puppetTempo) return this.puppetTempo;
    const fr = this.framesData[this.frame - 1];
    return (fr && fr.tempo) || this.data.frameRate || 15;
  }
  start() {
    this.inFrameCycle = 1;
    this.sendMovie('preparemovie');
    this.enterScoreFrame(1);
    this.stepActors();
    this.frameEvent('prepareframe');
    this.sendMovie('startmovie');
    this.renderer.resize();
    this.renderer.draw();
    this.frameEvent('enterframe');
    this.inFrameCycle = 0;
    this.started = true;
  }
  // One frame of the movie.
  tick() {
    this.inFrameCycle++;
    try {
      this.frameCycle();
    } finally {
      this.inFrameCycle--;
    }
  }
  frameCycle() {
    if (!this.goPending) this.frameEvent('exitframe');
    let next = this.goPending ? this.goTarget : this.frame + 1;
    this.goPending = false;
    this.goTarget = null;
    if (next > this.frameCount()) next = 1;   // the end of the score loops, as a projector does
    this.enterScoreFrame(next);
    this.stepActors();
    this.frameEvent('prepareframe');
    this.mouseWithin();
    this.frameEvent('enterframe');
    this.checkTimeouts();
    this.sound.pump();
  }
  stepActors() {
    const list = this.actorList;
    for (const o of list.a.slice()) {
      // an actor taken off the list by another's stepFrame is not stepped
      if (o instanceof LInstance && list.a.includes(o)) {
        const h = o.findHandler('stepframe');
        if (h) this.guard(() => h.fn.call(h.inst, o));
      }
    }
  }
  checkTimeouts() {
    const now = this.millis();
    for (const t of [...this.timeouts.values()]) {
      if (t.active && now >= t.next) {
        t.next = now + t.period;
        const handler = str(t.handler).toLowerCase();
        if (t.target instanceof LInstance) {
          const h = t.target.findHandler(handler);
          if (h) this.guard(() => h.fn.call(h.inst, t.target, t));
        } else {
          const mh = this.movieHandlers[handler];
          if (mh) this.guard(() => mh.fn.call(this.scriptSelf(mh.script), t));
        }
      }
    }
  }
  run() {
    this.start();
    let next = performance.now();
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      if (this.testMode) return;
      const period = 1000 / this.tempo();
      let ticked = false;
      if (now >= next) {
        this.tick();
        ticked = true;
        next += period;
        if (next < now) next = now + period;
      }
      this.sound.pump();
      this.updateCursor();
      if (ticked || this.needsDraw) {
        this.renderer.resize();
        this.renderer.draw();
        this.needsDraw = false;
      }
    };
    this.raf = requestAnimationFrame(loop);
    this.installInput();
  }
  // Test mode: the clock stands still and frames move only when asked.
  step(n = 1) {
    for (let i = 0; i < n; i++) {
      this.virtualTime += 1000 / this.tempo();
      this.tick();
    }
    this.renderer.resize();
    this.renderer.draw();
  }

  // ---------- input ----------

  // The sprite a mouse event goes to: the topmost one under the pointer that listens to
  // the mouse (it has behaviors, or its member has a script).  Sprites without scripts,
  // such as the labels laid over buttons, let the event through.
  spriteAt(x, y, any = false) {
    const list = this.renderer.sorted();
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (!any && !this.listensToMouse(s)) continue;
      // (nor is one the page doesn't draw, put out of sight: see the renderer)
      if (this.layout && this.layout.parked && this.layout.parked(s)) continue;
      // (a sprite the layout zooms is tested where it is drawn: see zoomOf)
      const z = this.zoomOf(s);
      if (this.renderer.hit(s, x / z, y / z)) return s.channel;
    }
    return 0;
  }
  // A sprite takes mouse events if a behavior of it, or its member's script, has a mouse
  // handler.  The labels over the game's buttons carry only a behavior that sets their
  // locZ, and the button under them still gets the click.
  listensToMouse(s) {
    for (const inst of s.scriptInstances) {
      if (inst instanceof LInstance) {
        for (const ev of MOUSE_EVENTS) if (inst.findHandler(ev)) return true;
      }
    }
    const m = s.member;
    if (m && m.rec && m.rec.hasScript) {
      const script = this.scriptByMember.get(m.castLib + ':' + m.number);
      if (script) for (const ev of MOUSE_EVENTS) if (script.handlers[ev]) return true;
    }
    return false;
  }
  installInput() {
    const c = this.canvas;
    const pos = (e) => {
      const [x, y] = this.renderer.toStage(e.clientX, e.clientY);
      this.mouse.x = x;
      this.mouse.y = y;
    };
    c.addEventListener('pointermove', (e) => { pos(e); this.rollover(); });
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.sound.resume();
      c.focus();
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      pos(e);
      this.mouseDown();
      e.preventDefault();
    });
    c.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      pos(e);
      this.mouseUp();
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    // (keys typed into the page's own controls, a page around the game may have, are theirs)
    const forPage = (e) => e.target !== c && e.target instanceof Element &&
      !!e.target.closest('input, textarea, select, button, a[href], [contenteditable]');
    window.addEventListener('keydown', (e) => {
      this.sound.resume();
      if (forPage(e)) return;
      if (e.ctrlKey && (e.key === 'r' || e.key === 'R')) return;
      this.keyDown(e);
      if (e.key.startsWith('Arrow') || e.key === ' ' || e.key === 'Backspace') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { if (!forPage(e)) this.keyUp(e); });
    window.addEventListener('resize', () => { this.needsDraw = true; });
  }
  rollover() {
    const ch = this.spriteAt(this.mouse.x, this.mouse.y);
    if (ch !== this.mouse.rollover) {
      const old = this.mouse.rollover;
      this.mouse.rollover = ch;
      if (old) this.dispatchMouse('mouseleave', old);
      if (ch) this.dispatchMouse('mouseenter', ch);
      this.cursorDirty = true;
    }
  }
  mouseWithin() {
    this.rollover();
    if (this.mouse.rollover) this.dispatchMouse('mousewithin', this.mouse.rollover, true);
  }
  // A mouse event to a sprite, then to its member's script, the frame script and the
  // movie scripts, until something handles it.
  dispatchMouse(event, ch, spriteOnly = false) {
    if (ch && this.sendSprite(ch, event, [])) return;
    if (spriteOnly) return;
    if (ch && this.sendMemberScript(ch, event, [])) return;
    if (this.sendFrameScript(event, [])) return;
    this.sendMovie(event);
  }
  mouseDown() {
    this.mouse.down = true;
    this.rollover();
    const ch = this.spriteAt(this.mouse.x, this.mouse.y);
    this.mouse.clickOn = ch;
    this.mouse.downSprite = ch;
    this.mouse.lastClick = this.millis();
    this.dispatchMouse('mousedown', ch);
    this.needsDraw = true;
  }
  mouseUp() {
    this.mouse.down = false;
    const ch = this.spriteAt(this.mouse.x, this.mouse.y);
    const down = this.mouse.downSprite;
    if (down && ch !== down) {
      this.dispatchMouse('mouseupoutside', down, true);
    } else {
      this.dispatchMouse('mouseup', ch);
    }
    this.mouse.downSprite = 0;
    this.rollover();
    this.needsDraw = true;
  }
  keyDown(e) {
    this.keyInfo.keyCode = KEYCODES[e.code] !== undefined ? KEYCODES[e.code] : 0;
    this.keyInfo.key = e.key.length === 1 ? e.key : (e.key === 'Enter' ? '\r' : e.key === 'Tab' ? '\t' : e.key === 'Backspace' ? '\b' : '');
    this.keyInfo.shift = e.shiftKey;
    this.keyInfo.control = e.ctrlKey;
    this.keyInfo.alt = e.altKey;
    this.keyInfo.meta = e.metaKey;
    if (this.sendFrameScript('keydown', [])) return;
    this.sendMovie('keydown');
  }
  keyUp(e) {
    this.keyInfo.shift = e.shiftKey;
    this.keyInfo.control = e.ctrlKey;
    if (this.sendFrameScript('keyup', [])) return;
    this.sendMovie('keyup');
  }

  // ---------- cursor ----------

  updateCursor() {
    let spec = this.cursorSpec;
    const ro = this.mouse.rollover ? this.sprites[this.mouse.rollover] : null;
    if (ro && ro.cursor && toInt(ro.cursor) !== 0) spec = ro.cursor;
    const key = spec instanceof LList ? spec.a.map(x => toInt(x)).join(',') : String(toInt(spec));
    if (key === this.cursorKey && !this.cursorDirty) return;
    this.cursorKey = key;
    this.cursorDirty = false;
    this.canvas.style.cursor = this.cssCursor(spec, key);
  }
  cssCursor(spec, key) {
    if (this.cursorCache.has(key)) return this.cursorCache.get(key);
    let css = 'default';
    if (spec instanceof LList && spec.a.length) {
      const img = this.member(toInt(spec.a[0]), 1);
      const mask = spec.a.length > 1 ? this.member(toInt(spec.a[1]), 1) : null;
      if (img instanceof BitmapMember) {
        const ip = img.pixels();
        const w = ip.width, h = ip.height;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        const d = new ImageData(new Uint8ClampedArray(ip.data), w, h);
        let md = null;
        if (mask instanceof BitmapMember) {
          const mp = mask.pixels();
          if (mp.width === w && mp.height === h) md = mp.data;
        }
        for (let i = 0; i < w * h; i++) {
          const black = d.data[i * 4] < 128;
          const opaque = md ? md[i * 4] < 128 : black;
          d.data[i * 4 + 3] = opaque ? 255 : 0;
        }
        ctx.putImageData(d, 0, 0);
        css = 'url(' + c.toDataURL() + ') ' + Math.max(0, img.regX) + ' ' + Math.max(0, img.regY) + ', default';
      }
    } else {
      const n = toInt(spec);
      css = n === 200 ? 'none' : n === 1 ? 'text' : n === 2 || n === 3 ? 'crosshair' : n === 4 ? 'wait' : n === 280 ? 'pointer' : 'default';
    }
    this.cursorCache.set(key, css);
    return css;
  }

  // ---------- colours ----------

  paletteRGB(i) { return LImage.paletteRGB(i); }
  paletteColor(i) { const [r, g, b] = this.paletteRGB(i); return new LColor(r, g, b); }
  rgb(r, g, b) { return new LColor(r, g, b); }
  colorRGB(v) {
    if (v instanceof LColor) return v.index !== undefined && v.r === undefined ? this.paletteRGB(v.index) : [v.r, v.g, v.b];
    if (typeof v === 'number') return this.paletteRGB(v);
    if (typeof v === 'string' && v[0] === '#') {
      const h = v.slice(1);
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    return [0, 0, 0];
  }

  // ---------- "the" ----------

  the(name) {
    switch (name) {
      case 'milliseconds': return this.millis();
      case 'ticks': return Math.floor(this.millis() * 60 / 1000);
      case 'timer': return Math.floor((this.millis() - (this.timerStart || 0)) * 60 / 1000);
      case 'frame': return this.frame;
      case 'framelabel': { const l = this.frameLabel(this.frame); return l === null ? 0 : l; }
      case 'labellist': return this.labels.map(l => l.name + '\r').join('');
      case 'frametempo': return this.tempo();
      case 'lastframe': return this.frameCount();
      case 'actorlist': return this.actorList;
      case 'mouseloc': return new LPoint(this.mouse.x, this.mouse.y);
      case 'mouseh': return this.mouse.x;
      case 'mousev': return this.mouse.y;
      case 'mousedown': case 'stilldown': return this.mouse.down ? 1 : 0;
      case 'mouseup': return this.mouse.down ? 0 : 1;
      case 'clickon': return this.mouse.clickOn;
      case 'rollover': return this.mouse.rollover;
      case 'clickloc': return new LPoint(this.mouse.x, this.mouse.y);
      case 'keycode': return this.keyInfo.keyCode;
      case 'key': return this.keyInfo.key;
      case 'shiftdown': return this.keyInfo.shift ? 1 : 0;
      case 'controldown': return this.keyInfo.control ? 1 : 0;
      case 'optiondown': case 'altdown': return this.keyInfo.alt ? 1 : 0;
      case 'commanddown': return (this.keyInfo.control || this.keyInfo.meta) ? 1 : 0;
      case 'runmode': return 'Plugin';
      case 'environment': return L.plist([sym('shockMachine'), 0, sym('shockMachineVersion'), '', sym('platform'), 'Windows,32',
        sym('runMode'), 'Plugin', sym('colorDepth'), 32, sym('internetConnected'), sym('online'),
        sym('uiLanguage'), 'English', sym('osLanguage'), 'English', sym('productBuildVersion'), '178']);
      case 'platform': return 'Windows,32';
      case 'moviepath': return new URL('.', location.href).href;
      case 'moviename': return this.data.name + '.dcr';
      case 'movie': return this.data.name + '.dcr';
      case 'stageleft': return 0;
      case 'stagetop': return 0;
      case 'stageright': return this.box ? this.box.w : this.stage.width;
      case 'stagebottom': return this.box ? this.box.h : this.stage.height;
      case 'stagecolor': return 0;
      case 'colordepth': return 32;
      case 'exitlock': return this.exitLock;
      case 'idleloadmode': return 0;
      case 'itemdelimiter': return L.itemDelimiter;
      case 'floatprecision': return L.floatPrecision;
      case 'number of castlibs': return this.casts.length;
      case 'paramcount': return 0;
      case 'maxinteger': return 2147483647;
      case 'pi': return L.PI;
      case 'randomseed': return 0;
      case 'soundenabled': return 1;
      case 'soundlevel': return 7;
      case 'lastclick': return Math.floor((this.millis() - (this.mouse.lastClick || 0)) * 60 / 1000);
      case 'lastevent': case 'lastkey': case 'lastroll': return 0;
      case 'productversion': return '8.0';
      case 'version': return '8.0';
      case 'date': return new Date().toLocaleDateString();
      case 'time': return new Date().toLocaleTimeString();
    }
    this.warn('the ' + name);
    return undefined;
  }
  setThe(name, v) {
    switch (name) {
      case 'actorlist': this.actorList = v instanceof LList ? v : new LList(); return;
      case 'exitlock': this.exitLock = toInt(v); return;
      case 'itemdelimiter': L.setItemDelimiter(str(v).charAt(0) || ','); return;
      case 'floatprecision': L.setFloatPrecision(toInt(v)); return;
      case 'idleloadmode': case 'idleloadperiod': case 'idleloadtag': case 'soundenabled': case 'soundlevel':
      case 'randomseed': case 'stagecolor': case 'keyboardfocussprite': case 'updatemovieenabled':
        return;
    }
    this.warn('set the ' + name);
  }
  theNumberOf(what, obj) {
    if (what === 'castmembers' || what === 'members') {
      const c = obj instanceof CastLib ? obj : this.casts[toInt(obj) - 1];
      if (!c) return 0;
      return Math.max(0, ...c.members.keys());
    }
    return 0;
  }
  spriteIntersects(a, b) {
    const sa = this.sprite(a), sb = this.sprite(b);
    const r1 = sa.rect(), r2 = sb.rect();
    return r1.l < r2.r && r2.l < r1.r && r1.t < r2.b && r2.t < r1.b ? 1 : 0;
  }
  spriteWithin(a, b) {
    const r1 = this.sprite(a).rect(), r2 = this.sprite(b).rect();
    return r1.l >= r2.l && r1.r <= r2.r && r1.t >= r2.t && r1.b <= r2.b ? 1 : 0;
  }
  put(v) {
    if (this.options.verbose || this.testMode) console.log('-- ' + L.repr(v, false));
  }
  soundCommand(cmd, ...args) {
    if (cmd === 'stop') this.sound.channel(args[0]).stop();
    else if (cmd === 'fadein') this.sound.channel(args[0]).lgCall('fadein', [toInt(args[1]) * 1000 / 60]);
    else if (cmd === 'fadeout') this.sound.channel(args[0]).lgCall('fadeout', [toInt(args[1]) * 1000 / 60]);
  }
  playCommand() { /* play frame / play done: not used by these games */ }
}

// Which score sprites belong to the same span: a sprite unchanged from one frame to the
// next is the same sprite, carried on.
function computeSpans(score, channels) {
  const out = [];
  let id = 1;
  let prev = null;
  let prevIds = [];
  for (let f = 0; f < score.length; f++) {
    const fr = score[f];
    const ids = [];
    const keys = {};
    for (const [chs, sp] of Object.entries(fr.sprites)) {
      const ch = parseInt(chs, 10);
      const key = sp.span ? 'span:' + sp.span.join('-') + ':' + JSON.stringify(sp.behaviors || []) + JSON.stringify(sp.member) : JSON.stringify(sp);
      keys[ch] = key;
      if (prev && prev[ch] === key) ids[ch] = prevIds[ch];
      else ids[ch] = id++;
    }
    const skey = fr.script ? JSON.stringify(fr.script) : null;
    if (skey && prev && prev.script === skey) ids[0] = prevIds[0];
    else ids[0] = id++;
    keys.script = skey;
    out.push(ids);
    prev = keys;
    prevIds = ids;
  }
  return out;
}

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('could not load ' + url);
  return r.arrayBuffer();
}
function unrle(src, n) {
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i + 1 < src.length && o < n; i += 2) {
    const c = src[i], v = src[i + 1];
    out.fill(v, o, Math.min(n, o + c));
    o += c;
  }
  return out;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------- built-in functions ----------

function makeBuiltins(rt) {
  const B = Object.create(null);
  B.voidp = (x) => x === undefined ? 1 : 0;
  B.point = (h, v) => new LPoint(h === undefined ? 0 : h, v === undefined ? 0 : v);
  B.rect = (a, b, c, d) => {
    if (a instanceof LPoint && b instanceof LPoint) return new LRect(a.h, a.v, b.h, b.v);
    return new LRect(a || 0, b || 0, c || 0, d || 0);
  };
  B.member = (x, lib) => rt.member(x, lib);
  B.field = (x, lib) => rt.member(x, lib);
  B.sprite = (n) => rt.sprite(n);
  B.sound = (n) => rt.sound.channel(n);
  B.script = (x, lib) => {
    if (x instanceof ScriptRef) return x;
    const s = rt.scriptNamed(x, lib);
    if (!s) throw new L.LingoError('Script not found: ' + str(x));
    return new ScriptRef(rt, s);
  };
  B.castlib = (x) => {
    if (typeof x === 'string') return rt.casts.find(c => c.name.toLowerCase() === x.toLowerCase());
    return rt.casts[toInt(x) - 1];
  };
  B.window = () => undefined;
  B.integer = (x) => {
    if (x === undefined) return undefined;
    if (typeof x === 'number') return x;
    if (x instanceof L.LFloat) return L.roundInt(x.v);
    if (typeof x === 'string') {
      const n = L.strToNum(x);
      if (n === undefined) return undefined;
      return n instanceof L.LFloat ? L.roundInt(n.v) : n;
    }
    return undefined;
  };
  B.float = (x) => {
    if (typeof x === 'string') { const n = L.strToNum(x); return n === undefined ? x : new L.LFloat(num(n)); }
    if (x === undefined) return undefined;
    return new L.LFloat(num(x));
  };
  B.string = (x) => L.str(x);
  B.symbol = (x) => {
    if (x instanceof LSymbol) return x;
    // Director reads the name out of the string: the config files' "#trigger = #delay"
    // gives the key "trigger " and must still find #trigger.
    const s = str(x).trim();
    if (!s) return sym('');
    return sym(s.replace(/^#/, ''));
  };
  B.value = (x) => L.value(x);
  B.ilk = (x, w) => L.ilk(x, w);
  B.random = (n) => {
    n = toInt(n);
    if (n <= 0) return 1;
    return 1 + Math.floor(rt.rng() * n);
  };
  B.abs = (x) => x instanceof L.LFloat ? new L.LFloat(Math.abs(x.v)) : Math.abs(toInt(x));
  B.sqrt = (x) => new L.LFloat(Math.sqrt(num(x)));
  B.power = (a, b) => new L.LFloat(Math.pow(num(a), num(b)));
  B.sin = (x) => new L.LFloat(Math.sin(num(x)));
  B.cos = (x) => new L.LFloat(Math.cos(num(x)));
  B.tan = (x) => new L.LFloat(Math.tan(num(x)));
  B.atan = (a, b) => new L.LFloat(b === undefined ? Math.atan(num(a)) : Math.atan2(num(a), num(b)));
  B.exp = (x) => new L.LFloat(Math.exp(num(x)));
  B.log = (x) => new L.LFloat(Math.log(num(x)));
  B.min = (...a) => {
    if (a.length === 1 && a[0] instanceof LList) a = a[0].a;
    return a.reduce((m, x) => (m === undefined || L.lt(x, m)) ? x : m, undefined);
  };
  B.max = (...a) => {
    if (a.length === 1 && a[0] instanceof LList) a = a[0].a;
    return a.reduce((m, x) => (m === undefined || L.gt(x, m)) ? x : m, undefined);
  };
  B.bitand = (a, b) => toInt(a) & toInt(b);
  B.bitor = (a, b) => toInt(a) | toInt(b);
  B.bitxor = (a, b) => toInt(a) ^ toInt(b);
  B.bitnot = (a) => ~toInt(a);
  B.offset = (a, b) => str(b).toLowerCase().indexOf(str(a).toLowerCase()) + 1;
  B.length = (s) => str(s).length;
  B.chars = (s, a, b) => str(s).slice(toInt(a) - 1, toInt(b));
  B.numtochar = (n) => String.fromCharCode(toInt(n));
  B.chartonum = (s) => { s = str(s); return s.length ? s.charCodeAt(0) : 0; };
  B.list = (...a) => new LList(a);
  B.listp = (x) => (x instanceof LList || x instanceof LPropList || x instanceof LPoint || x instanceof LRect) ? 1 : 0;
  B.objectp = (x) => (x !== undefined && typeof x === 'object' && !(x instanceof LSymbol)) ? 1 : 0;
  B.stringp = (x) => typeof x === 'string' ? 1 : 0;
  B.symbolp = (x) => x instanceof LSymbol ? 1 : 0;
  B.integerp = (x) => typeof x === 'number' ? 1 : 0;
  B.floatp = (x) => x instanceof L.LFloat ? 1 : 0;
  B.nothing = () => undefined;
  B.rgb = (r, g, b) => {
    if (typeof r === 'string') { const c = rt.colorRGB(r); return new LColor(...c); }
    return new LColor(toInt(r), toInt(g), toInt(b));
  };
  B.color = (t, a, b, c) => {
    if (str(t).toLowerCase() === 'paletteindex') return B.paletteindex(a);
    return new LColor(toInt(a), toInt(b), toInt(c));
  };
  B.paletteindex = (n) => new LColor(undefined, undefined, undefined, toInt(n));
  B.go = (target) => rt.go(target);
  B.marker = (n) => {
    if (typeof n === 'string') return rt.labelFrame(n);
    n = toInt(n);
    const labels = rt.labels.map(l => l.frame);
    const f = rt.frame;
    let cur = -1;
    for (let i = 0; i < labels.length; i++) if (labels[i] <= f) cur = i;
    const idx = cur + n;
    if (n === 0) return cur >= 0 ? labels[cur] : 1;
    if (idx < 0) return labels.length ? labels[0] : 1;
    if (idx >= labels.length) return labels[labels.length - 1];
    return labels[idx];
  };
  B.label = (n) => rt.labelFrame(n);
  B.updatestage = () => { rt.needsDraw = true; };
  B.puppetsprite = (n, on) => { rt.sprite(n).puppet = !!toInt(on); };
  B.puppettempo = (n) => { rt.puppetTempo = toInt(n); };
  B.puppetsound = (a, b) => {
    if (b === undefined) { const m = rt.member(a); rt.sound.channel(1).lgCall('play', [m]); return; }
    rt.sound.channel(a).lgCall('play', [rt.member(b)]);
  };
  B.soundbusy = (n) => rt.sound.channel(n).isBusy() ? 1 : 0;
  B.cursor = (spec) => { rt.cursorSpec = spec; rt.cursorDirty = true; };
  // (not Director's: how far a layout zooms the map, for the scripts that size the map's
  // view; 1 without one)
  B.mapzoom = () => (rt.layout && rt.layout.zoom) || 1;
  B.image = (w, h, depth) => LImage.blank(toInt(w), toInt(h), toInt(depth) || 32);
  B.new_ = (x, ...args) => {
    if (x instanceof ScriptRef) return rt.newInstance(x.script, args);
    if (x instanceof LSymbol) return rt.newMember(x.name.toLowerCase());
    if (x instanceof LInstance) { const h = x.findHandler('new'); if (h) return h.fn.call(h.inst, x, ...args); }
    throw new L.LingoError('new: not a script');
  };
  B.new = B.new_;
  B.timeout = (name) => {
    const k = str(name);
    return rt.timeouts.get(k) || new Timeout(rt, k);
  };
  B.call = (handler, target, ...args) => {
    const name = str(handler).toLowerCase();
    const targets = target instanceof LList ? target.a.slice() : [target];
    let result;
    for (const t of targets) {
      if (t instanceof LInstance) {
        const h = t.findHandler(name);
        if (h) result = h.fn.call(h.inst, t, ...args);
      } else if (t instanceof Sprite) {
        result = t.lgCall(name, args);
      }
    }
    return result;
  };
  B.callancestor = (handler, target, ...args) => {
    const name = str(handler).toLowerCase();
    if (target instanceof LInstance && target.$.ancestor instanceof LInstance) {
      const h = target.$.ancestor.findHandler(name);
      if (h) return h.fn.call(h.inst, target, ...args);
    }
  };
  B.sendsprite = (n, msg, ...args) => {
    const s = rt.sprite(n);
    let result;
    for (const inst of s.scriptInstances.slice()) {
      const h = inst instanceof LInstance ? inst.findHandler(str(msg).toLowerCase()) : null;
      if (h) result = h.fn.call(h.inst, inst, ...args);
    }
    return result;
  };
  B.sendallsprites = (msg, ...args) => {
    for (let ch = 1; ch < rt.sprites.length; ch++) if (rt.sprites[ch]) B.sendsprite(ch, msg, ...args);
  };
  B.pass = () => { rt.passed = true; };
  B.stopevent = () => { rt.passed = false; };
  B.alert = (msg) => { console.warn('alert: ' + str(msg)); };
  B.beep = () => {};
  B.halt = () => {};
  B.quit = () => {};
  B.put = (v) => rt.put(v);
  B.starttimer = () => { rt.timerStart = rt.millis(); };
  B.setpref = (name, text) => {
    try { localStorage.setItem(rt.prefPrefix + str(name), str(text)); } catch (e) { /* storage blocked */ }
  };
  B.getpref = (name) => {
    try {
      const v = localStorage.getItem(rt.prefPrefix + str(name));
      return v === null ? undefined : v;
    } catch (e) { return undefined; }
  };
  // The network: everything the movie fetched came with it.
  let netId = 0;
  B.preloadnetthing = () => ++netId;
  B.getnettext = () => ++netId;
  B.netdone = () => 1;
  B.neterror = () => 'OK';
  B.nettextresult = () => '';
  B.netabort = () => {};
  B.gotoneturl = () => {};
  B.gotonetpage = () => {};
  B.getstreamstatus = (id) => L.plist([sym('URL'), str(id), sym('state'), 'Complete', sym('bytesSoFar'), 100,
    sym('bytesTotal'), 100, sym('error'), 'OK']);
  B.frameready = () => 1;
  B.mediaready = () => 1;
  B.preload = () => {};
  B.preloadmember = () => {};
  B.unloadmember = () => {};
  B.importfileinto = () => {};
  B.sndloadnetsource = () => {};
  B.externalparamvalue = () => undefined;
  B.externalparamname = () => undefined;
  B.externalparamcount = () => 0;
  B.xtra = () => undefined;
  B.inflate = (r, h, v) => new LRect(L.sub(r.l, h), L.sub(r.t, v), L.add(r.r, h), L.add(r.b, v));
  B.union = (a, b) => L.mc(a, 'union', b);
  B.intersect = (a, b) => L.mc(a, 'intersect', b);
  B.inside = (p, r) => L.mc(p, 'inside', r);
  B.map = (r) => r;
  B.duplicate = (x) => L.duplicate(x);
  B.param = () => undefined;
  B.rollover = (n) => n === undefined ? rt.mouse.rollover : (rt.mouse.rollover === toInt(n) ? 1 : 0);
  return B;
}
