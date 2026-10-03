// Lingo's image objects (imaging Lingo).  An image keeps its own pixels (RGBA, row by row)
// and every operation works on them; the canvas it is drawn from is only ever written to,
// from those pixels, when it has changed.  (A canvas's pixels read back are not to be
// trusted: some browsers change them a little on each read.  See png.js.)

import { LColor, LRect, LPoint, LPropList, num, toInt, sym, LingoError } from './lingo.js';

export class LImage {
  constructor(w, h, depth) {
    this.width = Math.max(1, w | 0);
    this.height = Math.max(1, h | 0);
    this.depth = depth || 32;
    this.useAlpha = false;
    this.buf = new Uint8ClampedArray(this.width * this.height * 4);
    this._canvas = null;
    this._dirty = true;     // the canvas is behind the pixels
    this.indices = null;    // palette indices, for indexed bitmaps read with getPixel
    this.palette = null;
    this.onChange = null;
  }
  static blank(w, h, depth) {
    const im = new LImage(w, h, depth);
    // a new image is white, as Director makes them
    im.buf.fill(255);
    return im;
  }
  // From pixels (RGBA, row by row), copied.
  static fromPixels(px, w, h, depth, useAlpha) {
    const im = new LImage(w, h, depth);
    if (px && px.length === im.buf.length) im.buf.set(px);
    else im.buf.fill(255);
    im.useAlpha = !!useAlpha;
    return im;
  }
  get canvas() {
    if (!this._canvas) {
      this._canvas = document.createElement('canvas');
      this._canvas.width = this.width;
      this._canvas.height = this.height;
      this._dirty = true;
    }
    if (this._dirty) {
      this._canvas.getContext('2d').putImageData(new ImageData(this.buf, this.width, this.height), 0, 0);
      this._dirty = false;
    }
    return this._canvas;
  }
  touched() {
    this._dirty = true;
    this.changed();
  }
  changed() { if (this.onChange) this.onChange(); }
  duplicateImage() {
    const im = LImage.fromPixels(this.buf, this.width, this.height, this.depth, this.useAlpha);
    if (this.indices) { im.indices = this.indices.slice(); im.palette = this.palette; }
    return im;
  }
  getPixel(x, y) {
    x = x | 0; y = y | 0;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    if (this.indices && this.depth <= 8) return new LColor(0, 0, 0, this.indices[y * this.width + x]);
    const o = (y * this.width + x) * 4;
    return new LColor(this.buf[o], this.buf[o + 1], this.buf[o + 2]);
  }
  setPixel(x, y, c) {
    x = x | 0; y = y | 0;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    const rgb = this.rgbOf(c);
    const o = (y * this.width + x) * 4;
    this.buf[o] = rgb[0]; this.buf[o + 1] = rgb[1]; this.buf[o + 2] = rgb[2]; this.buf[o + 3] = 255;
    if (this.indices && c instanceof LColor && c.index !== undefined) this.indices[y * this.width + x] = c.index;
    this.touched();
    return 1;
  }
  rgbOf(c) {
    if (c instanceof LColor) {
      if (c.index !== undefined && c.r === undefined) return LImage.paletteRGB(c.index);
      return [c.r | 0, c.g | 0, c.b | 0];
    }
    if (typeof c === 'number') return LImage.paletteRGB(c);
    return [0, 0, 0];
  }
  fill(rect, c) {
    const rgb = this.rgbOf(c);
    const l = Math.max(0, Math.round(num(rect.l))), t = Math.max(0, Math.round(num(rect.t)));
    const r = Math.min(this.width, Math.round(num(rect.r))), b = Math.min(this.height, Math.round(num(rect.b)));
    for (let y = t; y < b; y++) {
      for (let x = l; x < r; x++) {
        const o = (y * this.width + x) * 4;
        this.buf[o] = rgb[0]; this.buf[o + 1] = rgb[1]; this.buf[o + 2] = rgb[2]; this.buf[o + 3] = 255;
      }
    }
    this.indices = null;
    this.touched();
  }
  // Copy ink: the source rect's pixels, scaled to the destination rect (nearest pixel), in
  // place of what is there, alpha and all, unless the source uses its alpha; #blend mixes.
  copyPixels(src, destRect, srcRect, params) {
    if (!(src instanceof LImage)) return;
    let blend = 100;
    if (params instanceof LPropList) {
      const i = params.find(sym('blend'));
      if (i >= 0) blend = num(params.v[i]);
    }
    let dl, dt, dw, dh;
    if (destRect instanceof LRect) {
      dl = Math.round(num(destRect.l)); dt = Math.round(num(destRect.t));
      dw = Math.round(num(destRect.r)) - dl; dh = Math.round(num(destRect.b)) - dt;
    } else {
      dl = 0; dt = 0; dw = this.width; dh = this.height;
    }
    const sl = Math.round(num(srcRect.l)), st = Math.round(num(srcRect.t));
    const sw = Math.round(num(srcRect.r)) - sl, sh = Math.round(num(srcRect.b)) - st;
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
    const k = Math.max(0, Math.min(1, blend / 100));
    const s = src.buf, d = this.buf;
    for (let y = 0; y < dh; y++) {
      const ty = dt + y;
      if (ty < 0 || ty >= this.height) continue;
      const sy = st + Math.floor(y * sh / dh);
      if (sy < 0 || sy >= src.height) continue;
      for (let x = 0; x < dw; x++) {
        const tx = dl + x;
        if (tx < 0 || tx >= this.width) continue;
        const sx = sl + Math.floor(x * sw / dw);
        if (sx < 0 || sx >= src.width) continue;
        const so = (sy * src.width + sx) * 4, o = (ty * this.width + tx) * 4;
        const a = src.useAlpha ? (s[so + 3] / 255) * k : k;
        if (a >= 1) {
          d[o] = s[so]; d[o + 1] = s[so + 1]; d[o + 2] = s[so + 2]; d[o + 3] = src.useAlpha ? 255 : s[so + 3];
        } else if (a > 0) {
          d[o] = d[o] + (s[so] - d[o]) * a;
          d[o + 1] = d[o + 1] + (s[so + 1] - d[o + 1]) * a;
          d[o + 2] = d[o + 2] + (s[so + 2] - d[o + 2]) * a;
          d[o + 3] = Math.max(d[o + 3], 255 * a);
        }
      }
    }
    this.indices = null;
    this.touched();
  }
  crop(r) {
    const l = Math.round(num(r.l)), t = Math.round(num(r.t));
    const w = Math.round(num(r.r)) - l, h = Math.round(num(r.b)) - t;
    const im = LImage.blank(w, h, this.depth);
    im.useAlpha = this.useAlpha;
    for (let y = 0; y < im.height; y++) {
      const sy = t + y;
      if (sy < 0 || sy >= this.height) continue;
      for (let x = 0; x < im.width; x++) {
        const sx = l + x;
        if (sx < 0 || sx >= this.width) continue;
        const so = (sy * this.width + sx) * 4, o = (y * im.width + x) * 4;
        im.buf[o] = this.buf[so]; im.buf[o + 1] = this.buf[so + 1]; im.buf[o + 2] = this.buf[so + 2]; im.buf[o + 3] = this.buf[so + 3];
      }
    }
    return im;
  }
  lgGet(name) {
    switch (name) {
      case 'width': return this.width;
      case 'height': return this.height;
      case 'rect': return new LRect(0, 0, this.width, this.height);
      case 'depth': return this.depth;
      case 'usealpha': return this.useAlpha ? 1 : 0;
      case 'ilk': return sym('image');
    }
    return undefined;
  }
  lgSet(name, v) {
    if (name === 'usealpha') { this.useAlpha = !!toInt(v); this.touched(); }
  }
  lgCall(name, args) {
    switch (name) {
      case 'getpixel': {
        if (args[0] instanceof LPoint) return this.getPixel(toInt(args[0].h), toInt(args[0].v));
        return this.getPixel(toInt(args[0]), toInt(args[1]));
      }
      case 'setpixel': {
        if (args[0] instanceof LPoint) return this.setPixel(toInt(args[0].h), toInt(args[0].v), args[1]);
        return this.setPixel(toInt(args[0]), toInt(args[1]), args[2]);
      }
      case 'copypixels': this.copyPixels(args[0], args[1], args[2], args[3]); return;
      case 'fill': {
        if (args[0] instanceof LRect) this.fill(args[0], args[1]);
        else this.fill(new LRect(args[0], args[1], args[2], args[3]), args[4]);
        return;
      }
      case 'duplicate': return this.duplicateImage();
      case 'crop': return this.crop(args[0]);
    }
    throw new LingoError('image has no method ' + name);
  }
  lgIlk() { return 'image'; }
  lgRepr() { return '<image:' + this.width + 'x' + this.height + '>'; }
}

// The movie's palette, for colours given as palette indices.
LImage.palette = null;
LImage.paletteRGB = (i) => {
  const p = LImage.palette;
  i = i | 0;
  if (!p || i < 0 || i > 255) return [0, 0, 0];
  return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
};
