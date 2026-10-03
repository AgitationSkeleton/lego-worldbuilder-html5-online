// Cast libraries and their members: what Lingo sees through member(...), and what the
// renderer draws.

import { LPoint, LRect, LList, sym, str, toInt, num, LingoError, onWarning, repr, gp } from './lingo.js';
import { TextLayout, parseHtml } from './text.js';
import { LImage } from './image.js';
import { decodePNG } from './png.js';

export class CastLib {
  constructor(runtime, number, name) {
    this.runtime = runtime;
    this.number = number;
    this.name = name;
    this.members = new Map();
  }
  lgGet(name) {
    switch (name) {
      case 'name': return this.name;
      case 'number': return this.number;
      case 'filename': return '';
      case 'preloadmode': return 0;
    }
    return undefined;
  }
  lgSet(name, v) { /* fileName and the like: nothing to load */ }
  lgCall(name, args) {
    if (name === 'member') return this.runtime.member(args[0], this.number);
    throw new LingoError('castLib has no method ' + name);
  }
  lgIlk() { return 'castLib'; }
  lgRepr() { return '(castLib ' + this.number + ')'; }
}

export class Member {
  constructor(runtime, castLib, number, rec) {
    this.runtime = runtime;
    this.castLib = castLib;
    this.number = number;
    this.name = rec ? rec.name : '';
    this.rec = rec;
    this.version = 0;   // bumped when what the member looks like changes
  }
  get typeName() { return 'empty'; }
  get width() { return 0; }
  get height() { return 0; }
  get regX() { return 0; }
  get regY() { return 0; }
  lgGet(name) {
    switch (name) {
      case 'name': return this.name;
      case 'number': return this.castLib * 65536 + this.number;
      case 'membernum': return this.number;
      case 'castlibnum': return this.castLib;
      case 'type': return sym(this.typeName);
      case 'width': return this.width;
      case 'height': return this.height;
      case 'rect': return new LRect(0, 0, this.width, this.height);
      case 'regpoint': return new LPoint(this.regX, this.regY);
      case 'filename': return '';
      case 'scripttext': return '';
      case 'mediaready': return 1;
      case 'loaded': return 1;
      case 'ilk': return sym('member');
    }
    return this.get(name);
  }
  get(name) {
    onWarning('member property ' + name + ' (' + this.typeName + ' ' + this.name + ')');
    return undefined;
  }
  lgSet(name, v) {
    if (name === 'name') { this.runtime.renameMember(this, str(v)); return; }
    this.set(name, v);
  }
  set(name, v) {
    if (name === 'filename' || name === 'font') return;
    onWarning('cannot set member property ' + name + ' (' + this.typeName + ' ' + this.name + ')');
  }
  lgCall(name, args) {
    if (name === 'duplicate') return this.runtime.duplicateMember(this, args[0]);
    if (name === 'erase') { this.runtime.eraseMember(this); return; }
    throw new LingoError('member has no method ' + name);
  }
  lgIlk() { return 'member'; }
  lgRepr() { return '(member ' + this.number + ' of castLib ' + this.castLib + ')'; }
  lgEquals(o) { return o instanceof Member && o.castLib === this.castLib && o.number === this.number; }
}

// What member("no such name") gives: Director answers with member -1, and scripts test
// its memberNum.
export class NullMember extends Member {
  constructor(runtime) { super(runtime, 1, -1, null); }
  lgGet(name) {
    switch (name) {
      case 'membernum': case 'number': return -1;
      case 'name': return '';
      case 'type': return sym('empty');
      case 'text': return '';
    }
    return undefined;
  }
  lgSet() {}
}

export class BitmapMember extends Member {
  constructor(runtime, castLib, number, rec) {
    super(runtime, castLib, number, rec);
    this.w = rec ? rec.width : 0;
    this.h = rec ? rec.height : 0;
    this.rx = rec ? rec.regX : 0;
    this.ry = rec ? rec.regY : 0;
    this.source = null;   // ImageBitmap or canvas, set when the assets are decoded
    this._image = null;   // the Lingo image, made when asked for
    this.alpha = rec ? !!rec.alpha : false;
    this.depth = rec ? rec.depth : 32;
    this.inkCache = new Map();
  }
  get typeName() { return 'bitmap'; }
  get width() { return this.w; }
  get height() { return this.h; }
  get regX() { return this.rx; }
  get regY() { return this.ry; }
  // The exact pixels, {data (RGBA, row by row), width, height}: the Lingo image's if it has
  // one, else the PNG's, decoded here when first asked for (png.js says why not by the
  // browser).
  pixels() {
    if (this._image) return { data: this._image.buf, width: this._image.width, height: this._image.height };
    if (!this._pixels) {
      const w = Math.max(1, this.w), h = Math.max(1, this.h);
      const png = this.rec && this.rec.png;
      let px = null;
      if (png && this.runtime.bitmapBytes) {
        try {
          const im = decodePNG(new Uint8Array(this.runtime.bitmapBytes, png[0], png[1]));
          if (im.width === w && im.height === h) px = im.data;
        } catch (e) {
          onWarning('could not decode ' + this.name + ': ' + e.message);
        }
      }
      if (!px) px = new Uint8ClampedArray(w * h * 4).fill(255);
      this._pixels = { data: px, width: w, height: h };
    }
    return this._pixels;
  }
  // Pixels as a canvas, made from the exact pixels.
  canvas() {
    if (this._image) return this._image.canvas;
    if (!this._canvas) {
      const px = this.pixels();
      const c = document.createElement('canvas');
      c.width = px.width;
      c.height = px.height;
      c.getContext('2d').putImageData(new ImageData(px.data, px.width, px.height), 0, 0);
      this._canvas = c;
    }
    return this._canvas;
  }
  drawable() {
    if (this._image) return this._image.canvas;
    return this.source || this.canvas();
  }
  get(name) {
    switch (name) {
      case 'image':
        if (!this._image) {
          const px = this.pixels();
          this._image = LImage.fromPixels(px.data, px.width, px.height, this.depth === 32 ? 32 : this.depth, this.alpha);
          this._image.onChange = () => this.changed();
        }
        return this._image;
      case 'depth': return this.depth;
      case 'usealpha': return this.alpha ? 1 : 0;
      case 'palette': return sym('systemWin');
      case 'paletteref': return sym('systemWin');
    }
    return super.get(name);
  }
  set(name, v) {
    switch (name) {
      case 'image': {
        const img = v instanceof LImage ? v.duplicateImage() : null;
        if (!img) return;
        this._image = img;
        this._image.onChange = () => this.changed();
        // A new picture is registered at its centre.  (The minimap's sprite sits on the
        // middle of the right-hand panel and gets a picture the map's size: only so does a
        // map of any size come out in the middle, as it does in the original.)
        if (img.width !== this.w || img.height !== this.h) {
          this.rx = Math.floor(img.width / 2);
          this.ry = Math.floor(img.height / 2);
        }
        this.w = img.width;
        this.h = img.height;
        this.alpha = img.useAlpha;
        this.changed();
        return;
      }
      case 'regpoint':
        if (v instanceof LPoint) { this.rx = toInt(v.h); this.ry = toInt(v.v); this.changed(); }
        return;
      case 'usealpha': this.alpha = !!toInt(v); this.changed(); return;
    }
    super.set(name, v);
  }
  changed() {
    this.version++;
    this.inkCache.clear();
    this._canvas = null;
  }
}

export class ShapeMember extends Member {
  get typeName() { return 'shape'; }
  get width() { return this.rec.width; }
  get height() { return this.rec.height; }
  get regX() { return 0; }
  get regY() { return 0; }
  get(name) {
    switch (name) {
      case 'shapetype': return sym(this.rec.shapeType);
      case 'filled': return this.rec.filled;
      case 'linesize': return this.rec.lineSize;
      case 'forecolor': return this.rec.foreColor;
      case 'backcolor': return this.rec.backColor;
    }
    return super.get(name);
  }
}

export class SoundMember extends Member {
  constructor(runtime, castLib, number, rec) {
    super(runtime, castLib, number, rec);
    this.buffer = null;   // decoded AudioBuffer
  }
  get typeName() { return 'sound'; }
  get(name) {
    switch (name) {
      case 'duration': return this.buffer ? Math.round(this.buffer.duration * 1000) : 0;
      case 'samplerate': return this.buffer ? this.buffer.sampleRate : (this.rec.rate || 22050);
      case 'channelcount': return 1;
      case 'samplesize': return 16;
      case 'loop': return this.rec.loop ? 1 : 0;
    }
    return super.get(name);
  }
  set(name, v) {
    if (name === 'loop') { this.rec.loop = !!toInt(v); return; }
    super.set(name, v);
  }
}

export class ScriptMember extends Member {
  constructor(runtime, castLib, number, rec, script) {
    super(runtime, castLib, number, rec);
    this.script = script;
  }
  get typeName() { return 'script'; }
  get(name) {
    if (name === 'scripttype') return sym(this.rec.scriptType || 'movie');
    if (name === 'script') return this.runtime.scriptObject(this);
    return super.get(name);
  }
}

export class PaletteMember extends Member {
  get typeName() { return 'palette'; }
}

export class FontMember extends Member {
  get typeName() { return 'font'; }
}

// Text members (the Text Asset Xtra) and the one button.
export class TextMember extends Member {
  constructor(runtime, castLib, number, rec) {
    super(runtime, castLib, number, rec);
    const r = rec || {};
    this.text = r.text || '';
    this.styles = (r.styles || []).map(s => ({ ...s }));
    this.paras = (r.paras || []).map(p => ({ ...p }));
    this.runs = (r.runs || []).map(x => x.slice());
    this.paraRuns = (r.paraRuns || []).map(x => x.slice());
    this.rectW = r.rect ? r.rect.right - r.rect.left : 100;
    this.rectH = r.rect ? r.rect.bottom - r.rect.top : 20;
    this.rx = r.regX || 0;
    this.ry = r.regY || 0;
    this.layoutCache = null;
  }
  get typeName() { return 'text'; }
  get width() { return this.rectW; }
  get height() { return this.layout().height; }
  get regX() { return this.rx; }
  get regY() { return this.ry; }
  // The style of the first character: what text set from Lingo takes on.
  firstStyle() {
    const run = this.runs.length ? this.runs[0] : null;
    const st = run && this.styles[run[1]] ? this.styles[run[1]] : this.styles[0];
    return st || { family: 'Arial', size: 12, color: [0, 0, 0], spacing: 0, ascent: 11, descent: 3, leading: 0 };
  }
  firstPara() {
    const run = this.paraRuns.length ? this.paraRuns[0] : null;
    const p = run && this.paras[run[1]] ? this.paras[run[1]] : this.paras[0];
    return p || { align: 'left', lineHeight: 0, spaceBefore: 0, spaceAfter: 0 };
  }
  setText(t) {
    t = str(t).replace(/\n/g, '\r');
    if (t === this.text) return;
    // Director keeps the style of the first character for the whole of the new text.
    const st = this.firstStyle();
    const pa = this.firstPara();
    this.styles = [st];
    this.runs = [[0, 0]];
    this.paras = [pa];
    this.paraRuns = [[0, 0]];
    this.text = t;
    this.changed();
  }
  changed() {
    this.version++;
    this.layoutCache = null;
  }
  layout() {
    if (!this.layoutCache) this.layoutCache = new TextLayout(this, this.runtime.textMeasure);
    return this.layoutCache;
  }
  get(name) {
    switch (name) {
      case 'text': return this.text;
      case 'rtf': return new StyledText(this);
      case 'html': return this.text;
      case 'font': return this.firstStyle().font;
      case 'fontsize': return Math.round(this.firstStyle().size);
      case 'alignment': return sym(this.firstPara().align === 'justify' ? 'full' : this.firstPara().align);
      // member(x).line.count and the like: the chunks of its text (the sound scripts count
      // a music list's lines this way to choose a track)
      case 'line': case 'char': case 'word': case 'item':
      case 'lines': case 'chars': case 'words': case 'items':
        return gp(this.text, name);
      case 'length': return this.text.length;
      case 'boxtype': return sym('adjust');
      case 'wordwrap': return 1;
      case 'antialias': return 1;
      case 'editable': return 0;
      case 'color': { const c = this.firstStyle().color; return this.runtime.rgb(c[0], c[1], c[2]); }
      case 'fixedlinespace': return this.firstPara().lineHeight || 0;
    }
    return super.get(name);
  }
  set(name, v) {
    switch (name) {
      case 'text': this.setText(v); return;
      case 'rtf':
        if (v instanceof StyledText) { v.applyTo(this); return; }
        this.setText(str(v));
        return;
      case 'html': this.setHtml(str(v)); return;
      case 'alignment': {
        const a = str(v).toLowerCase();
        for (const p of this.paras) p.align = a === 'full' ? 'justify' : a;
        this.changed();
        return;
      }
      case 'font': for (const s of this.styles) { s.font = str(v); s.family = str(v).replace(/ \*$/, ''); } this.changed(); return;
      case 'fontsize': for (const s of this.styles) s.size = num(v); this.changed(); return;
      case 'color': {
        const c = this.runtime.colorRGB(v);
        for (const s of this.styles) s.color = c;
        this.changed();
        return;
      }
      case 'rect': if (v instanceof LRect) { this.rectW = toInt(v.r) - toInt(v.l); this.changed(); } return;
      case 'regpoint': if (v instanceof LPoint) { this.rx = toInt(v.h); this.ry = toInt(v.v); this.changed(); } return;
      case 'width': this.rectW = toInt(v); this.changed(); return;
      case 'boxtype': case 'wordwrap': case 'antialias': case 'editable': case 'autotab': return;
    }
    super.set(name, v);
  }
  setHtml(html) {
    const base = this.firstStyle();
    const basePara = this.firstPara();
    const r = parseHtml(html, base, basePara);
    this.text = r.text;
    this.styles = r.styles;
    this.runs = r.runs;
    this.paras = r.paras;
    this.paraRuns = r.paraRuns;
    this.changed();
  }
  lgCall(name, args) {
    switch (name) {
      case 'pointtoparagraph': return this.layout().pointToParagraph(args[0]);
      case 'pointtoline': return this.layout().pointToLine(args[0]);
      case 'pointtochar': return this.layout().pointToChar(args[0]);
      case 'charpostoloc': return this.layout().charPosToLoc(toInt(args[0]));
      case 'count': return 0;
    }
    return super.lgCall(name, args);
  }
}

// The styled text a text member's RTF property hands over: a copy of its runs and styles.
export class StyledText {
  constructor(m) {
    this.text = m.text;
    this.styles = m.styles.map(s => ({ ...s }));
    this.paras = m.paras.map(p => ({ ...p }));
    this.runs = m.runs.map(x => x.slice());
    this.paraRuns = m.paraRuns.map(x => x.slice());
  }
  applyTo(m) {
    m.text = this.text;
    m.styles = this.styles.map(s => ({ ...s }));
    m.paras = this.paras.map(p => ({ ...p }));
    m.runs = this.runs.map(x => x.slice());
    m.paraRuns = this.paraRuns.map(x => x.slice());
    m.changed();
  }
  lgIlk() { return 'string'; }
  lgRepr() { return this.text; }
  lgGet(name) { if (name === 'length') return this.text.length; return undefined; }
}

export class ButtonMember extends TextMember {
  constructor(runtime, castLib, number, rec) {
    super(runtime, castLib, number, { ...rec, styles: [{ family: 'Arial', font: 'Arial', size: 12, color: [0, 0, 0], spacing: 0, ascent: 11, descent: 3, leading: 0 }], paras: [{ align: 'center', lineHeight: 0, spaceBefore: 0, spaceAfter: 0 }], runs: [[0, 0]], paraRuns: [[0, 0]] });
  }
  get typeName() { return 'button'; }
}
