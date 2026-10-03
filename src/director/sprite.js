// Sprite channels: what sprite(n) is to Lingo, and what the renderer draws.

import { LPoint, LRect, LList, LColor, LInstance, sym, num, toInt, str, LingoError, onWarning } from './lingo.js';
import { Member, BitmapMember, TextMember, ShapeMember } from './members.js';

export class Sprite {
  constructor(runtime, channel) {
    this.runtime = runtime;
    this.channel = channel;
    this.clear();
    this.puppet = false;
    this.scriptInstances = [];
    this.spanKey = null;
  }
  clear() {
    this.member = null;
    this.locH = 0;
    this.locV = 0;
    this.locZ = this.channel;
    this.ink = 0;
    this.blend = 100;
    this.visible = true;
    this.w = null;         // set when the sprite is stretched from its member's size
    this.h = null;
    this.flipH = false;
    this.flipV = false;
    this.foreColor = 255;  // palette indices, unless an RGB colour is given
    this.backColor = 0;
    this.foreRGB = null;
    this.backRGB = null;
    this.cursor = 0;
    this.rotation = 0;
    this.moved = true;
  }
  // Load the channel from the score's sprite in a frame.
  loadFromScore(sp) {
    this.clear();
    if (!sp) return;
    this.member = this.runtime.memberRef(sp.member[0], sp.member[1]);
    this.locH = sp.locH;
    this.locV = sp.locV;
    this.ink = sp.ink;
    this.blend = sp.blend === undefined ? 100 : sp.blend;
    this.foreColor = sp.foreColor;
    this.backColor = sp.backColor;
    this.foreRGB = sp.foreRGB || null;
    this.backRGB = sp.backRGB || null;
    const m = this.member;
    // The score's size is used only for a shape, or a sprite stretched in the score; any
    // other sprite is its member's size, whatever size the score last saw it at (as
    // Director does, and ScummVM's Sprite::setCast: the minimap and the energy icon are
    // saved at sizes their members no longer have).
    if (m && (m instanceof ShapeMember || sp.stretch)) {
      this.w = sp.width;
      this.h = sp.height;
    }
    if (m instanceof TextMember && sp.width !== m.width) {
      // A text sprite's width is its member's: the score keeps the size it was laid out at.
      this.w = null;
    }
  }
  get width() {
    if (this.w !== null) return this.w;
    return this.member ? this.member.width : 0;
  }
  get height() {
    if (this.h !== null) return this.h;
    return this.member ? this.member.height : 0;
  }
  // Where the member's registration point lands, scaled if the sprite is stretched.
  get regX() {
    const m = this.member;
    if (!m) return 0;
    return m.width ? Math.round(m.regX * this.width / m.width) : 0;
  }
  get regY() {
    const m = this.member;
    if (!m) return 0;
    return m.height ? Math.round(m.regY * this.height / m.height) : 0;
  }
  get left() { return this.locH - this.regX; }
  get top() { return this.locV - this.regY; }
  rect() { return new LRect(this.left, this.top, this.left + this.width, this.top + this.height); }

  setMember(v) {
    let m = null;
    if (v instanceof Member) m = v;
    else if (v !== undefined && v !== 0 && v !== '') m = this.runtime.member(v);
    if (m && m.number < 0) m = null;
    if (m !== this.member) {
      this.member = m;
      // The sprite takes on its new member's size, as Director does.
      if (!(m instanceof ShapeMember)) { this.w = null; this.h = null; }
    }
  }

  lgGet(name) {
    switch (name) {
      case 'member': return this.member || this.runtime.nullMember;
      case 'castnum': case 'membernum': return this.member ? this.member.number : 0;
      case 'loc': return new LPoint(this.locH, this.locV);
      case 'loch': return this.locH;
      case 'locv': return this.locV;
      case 'locz': return this.locZ;
      case 'visible': case 'visibility': return this.visible ? 1 : 0;
      case 'ink': return this.ink;
      case 'blend': return this.blend;
      case 'rect': return this.rect();
      case 'width': return this.width;
      case 'height': return this.height;
      case 'left': return this.left;
      case 'top': return this.top;
      case 'right': return this.left + this.width;
      case 'bottom': return this.top + this.height;
      case 'spritenum': return this.channel;
      case 'puppet': return this.puppet ? 1 : 0;
      case 'scriptinstancelist': {
        const l = new LList(this.scriptInstances);
        return l;
      }
      case 'fliph': return this.flipH ? 1 : 0;
      case 'flipv': return this.flipV ? 1 : 0;
      case 'forecolor': return this.foreColor;
      case 'backcolor': return this.backColor;
      case 'color': return this.foreRGB ? new LColor(...this.foreRGB) : this.runtime.paletteColor(this.foreColor);
      case 'bgcolor': return this.backRGB ? new LColor(...this.backRGB) : this.runtime.paletteColor(this.backColor);
      case 'cursor': return this.cursor;
      case 'rotation': return this.rotation;
      case 'skew': return 0;
      case 'stretch': return this.w !== null ? 1 : 0;
      case 'trails': return 0;
      case 'moveablesprite': case 'editable': return 0;
      case 'ilk': return sym('sprite');
      case 'type': return 16;
      case 'quad': {
        const l = this.left, t = this.top, r = l + this.width, b = t + this.height;
        return new LList([new LPoint(l, t), new LPoint(r, t), new LPoint(r, b), new LPoint(l, b)]);
      }
    }
    // A behavior's property, through the sprite.
    for (const inst of this.scriptInstances) {
      if (inst instanceof LInstance && name in inst.$) return inst.$[name];
    }
    onWarning('sprite property ' + name);
    return undefined;
  }
  lgSet(name, v) {
    this.moved = true;
    switch (name) {
      case 'member': this.setMember(v); return;
      case 'castnum': case 'membernum': this.setMember(this.runtime.memberRef(1, toInt(v))); return;
      case 'loc':
        if (v instanceof LPoint) { this.locH = toInt(v.h); this.locV = toInt(v.v); }
        return;
      case 'loch': this.locH = toInt(v); return;
      case 'locv': this.locV = toInt(v); return;
      case 'locz': this.locZ = toInt(v); this.runtime.zOrderDirty = true; return;
      case 'visible': case 'visibility': this.visible = !!toInt(v); return;
      case 'ink': this.ink = toInt(v); return;
      case 'blend': this.blend = Math.max(0, Math.min(100, num(v))); return;
      case 'rect':
        if (v instanceof LRect) {
          const l = toInt(v.l), t = toInt(v.t), r = toInt(v.r), b = toInt(v.b);
          this.w = r - l;
          this.h = b - t;
          this.locH = l + this.regX;
          this.locV = t + this.regY;
        }
        return;
      case 'left': case 'top': case 'right': case 'bottom': {
        // one edge of the sprite's rect moved, the others kept: the sprite is resized (the
        // energy bar's stripe is drawn so, its right edge set from the unit's energy)
        const r = this.rect();
        const n = toInt(v);
        this.lgSet('rect', new LRect(name === 'left' ? n : r.l, name === 'top' ? n : r.t, name === 'right' ? n : r.r, name === 'bottom' ? n : r.b));
        return;
      }
      case 'width': this.w = toInt(v); if (this.h === null) this.h = this.height; return;
      case 'height': this.h = toInt(v); if (this.w === null) this.w = this.width; return;
      case 'puppet': this.puppet = !!toInt(v); return;
      case 'scriptinstancelist':
        this.scriptInstances = v instanceof LList ? v.a.slice() : [];
        for (const inst of this.scriptInstances) if (inst instanceof LInstance) inst.spriteNum = this.channel;
        return;
      case 'fliph': this.flipH = !!toInt(v); return;
      case 'flipv': this.flipV = !!toInt(v); return;
      case 'forecolor': this.foreColor = toInt(v); this.foreRGB = null; return;
      case 'backcolor': this.backColor = toInt(v); this.backRGB = null; return;
      case 'color': this.foreRGB = this.runtime.colorRGB(v); return;
      case 'bgcolor': this.backRGB = this.runtime.colorRGB(v); return;
      case 'cursor': this.cursor = v; this.runtime.cursorDirty = true; return;
      case 'rotation': this.rotation = num(v); return;
      case 'stretch': case 'trails': case 'moveablesprite': case 'editable': case 'skew': case 'constraint': return;
    }
    for (const inst of this.scriptInstances) {
      if (inst instanceof LInstance && name in inst.$) { inst.$[name] = v; return; }
    }
    onWarning('cannot set sprite property ' + name);
  }
  lgCall(name, args) {
    const m = this.member;
    switch (name) {
      case 'pointtoparagraph': case 'pointtoline': case 'pointtochar': case 'pointtoword': case 'pointtoitem': {
        if (!(m instanceof TextMember)) return -1;
        const p = args[0];
        const local = new LPoint(num(p.h) - this.left, num(p.v) - this.top);
        return m.lgCall(name === 'pointtoword' || name === 'pointtoitem' ? 'pointtochar' : name, [local]);
      }
      case 'intersects': return this.runtime.spriteIntersects(this.channel, args[0]);
      case 'within': return this.runtime.spriteWithin(this.channel, args[0]);
    }
    // sprite(n).handler(...) goes to the sprite's behaviors
    let result, handled = false;
    for (const inst of this.scriptInstances.slice()) {
      if (!(inst instanceof LInstance)) continue;
      const h = inst.findHandler(name);
      if (h) { result = h.fn.call(h.inst, inst, ...args); handled = true; }
    }
    if (!handled) onWarning('sprite ' + this.channel + ': no handler ' + name);
    return result;
  }
  lgIlk() { return 'sprite'; }
  lgRepr() { return '(sprite ' + this.channel + ')'; }
}
