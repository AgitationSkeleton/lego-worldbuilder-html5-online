// Drawing the stage: the sprites in locZ order, with Director's inks.
//
// The stage is drawn straight at the window's resolution (scaled to fit, letterboxed),
// so text is laid out at the movie's size but drawn sharp.

import { BitmapMember, TextMember, ShapeMember, ButtonMember } from './members.js';

const INK_COPY = 0, INK_MATTE = 8, INK_BLEND = 32, INK_BG_TRANSPARENT = 36;

export class Renderer {
  constructor(runtime, canvas) {
    this.runtime = runtime;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.ox = 0;
    this.oy = 0;
    this.dpr = 1;
    this.textCache = new WeakMap();
    this.order = [];
  }
  resize() {
    const rt = this.runtime;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cssW = Math.max(1, this.canvas.clientWidth), cssH = Math.max(1, this.canvas.clientHeight);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
    if (rt.layout) {
      // The layout decides the stage's size for the window, and how large it is drawn.
      const L = rt.layout.stageFor(cssW, cssH, rt);
      if (L.width !== rt.stage.width || L.height !== rt.stage.height) rt.setStageSize(L.width, L.height);
      this.scale = L.scale * dpr;
    } else {
      this.scale = Math.min(w / rt.stage.width, h / rt.stage.height);
    }
    const st = rt.stage;
    this.ox = Math.round((w - st.width * this.scale) / 2);
    this.oy = Math.round((h - st.height * this.scale) / 2);
  }
  // Stage coordinates of a point on the page (inside the box, when a frame is drawn in one).
  toStage(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    let x = ((clientX - r.left) * this.dpr - this.ox) / this.scale;
    let y = ((clientY - r.top) * this.dpr - this.oy) / this.scale;
    const box = this.runtime.box;
    if (box) { x -= box.x; y -= box.y; }
    return [Math.floor(x), Math.floor(y)];
  }
  sorted() {
    const rt = this.runtime;
    const list = [];
    for (const s of rt.sprites) if (s && s.member && s.visible) list.push(s);
    list.sort((a, b) => (a.locZ - b.locZ) || (a.channel - b.channel));
    return list;
  }
  draw() {
    const rt = this.runtime;
    const ctx = this.ctx;
    const st = rt.stage;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, st.width, st.height);
    ctx.clip();
    ctx.fillStyle = 'rgb(' + st.color.join(',') + ')';
    ctx.fillRect(0, 0, st.width, st.height);
    ctx.imageSmoothingEnabled = this.scale !== Math.round(this.scale);
    ctx.imageSmoothingQuality = 'high';
    if (rt.layout && rt.layout.beforeDraw) rt.layout.beforeDraw(rt);
    const list = this.sorted();
    this.order = list;
    const box = rt.box;
    if (box) {
      // A frame made for the original stage is drawn at its size in the middle, over its
      // own backdrop spread out and blurred to fill the rest.
      this.drawBackdrop(ctx, list[0], st);
      ctx.translate(box.x, box.y);
      ctx.beginPath();
      ctx.rect(0, 0, box.w, box.h);
      ctx.clip();
      ctx.fillStyle = 'rgb(' + st.color.join(',') + ')';
      ctx.fillRect(0, 0, box.w, box.h);
    }
    for (const s of list) this.drawSprite(ctx, s);
    ctx.restore();
  }
  drawBackdrop(ctx, s, st) {
    if (!s || !(s.member instanceof BitmapMember)) return;
    const src = s.member.drawable();
    const k = Math.max(st.width / src.width, st.height / src.height) * 1.1;
    const w = src.width * k, h = src.height * k;
    ctx.save();
    ctx.filter = 'blur(18px)';
    ctx.drawImage(src, (st.width - w) / 2, (st.height - h) / 2, w, h);
    ctx.restore();
  }
  drawSprite(ctx, s) {
    const m = s.member;
    const alpha = s.blend / 100;
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    if (m instanceof BitmapMember) {
      const src = this.inked(m, s);
      if (!src) return;
      const w = s.width, h = s.height;
      if (w <= 0 || h <= 0) return;
      const x = s.left, y = s.top;
      if (s.nine && (w !== m.width || h !== m.height)) {
        drawNine(ctx, src, x, y, w, h, s.nine);
      } else if (s.flipH || s.flipV) {
        ctx.save();
        ctx.translate(x + (s.flipH ? w : 0), y + (s.flipV ? h : 0));
        ctx.scale(s.flipH ? -1 : 1, s.flipV ? -1 : 1);
        ctx.drawImage(src, 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(src, x, y, w, h);
      }
    } else if (m instanceof TextMember) {
      this.drawText(ctx, s, m);
    } else if (m instanceof ShapeMember) {
      this.drawShape(ctx, s, m);
    }
    ctx.globalAlpha = 1;
  }
  spriteRGB(s, fore) {
    if (fore && s.foreRGB) return s.foreRGB;
    if (!fore && s.backRGB) return s.backRGB;
    return this.runtime.paletteRGB(fore ? s.foreColor : s.backColor);
  }
  drawShape(ctx, s, m) {
    const rgb = this.spriteRGB(s, true);
    const x = s.left, y = s.top, w = s.width, h = s.height;
    const r = m.rec;
    ctx.fillStyle = ctx.strokeStyle = 'rgb(' + rgb.join(',') + ')';
    if (r.shapeType === 'oval') {
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, Math.max(0, w / 2), Math.max(0, h / 2), 0, 0, Math.PI * 2);
      if (r.filled) ctx.fill(); else if (r.lineSize) { ctx.lineWidth = r.lineSize; ctx.stroke(); }
      return;
    }
    if (r.shapeType === 'line') {
      ctx.lineWidth = Math.max(1, r.lineSize);
      ctx.beginPath();
      if (r.lineDirection === 6) { ctx.moveTo(x, y + h); ctx.lineTo(x + w, y); } else { ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); }
      ctx.stroke();
      return;
    }
    if (r.filled) {
      if (s.ink !== INK_BG_TRANSPARENT || rgb.join() !== this.spriteRGB(s, false).join()) ctx.fillRect(x, y, w, h);
    } else if (r.lineSize > 0) {
      const lw = r.lineSize;
      ctx.fillRect(x, y, w, lw);
      ctx.fillRect(x, y + h - lw, w, lw);
      ctx.fillRect(x, y, lw, h);
      ctx.fillRect(x + w - lw, y, lw, h);
    }
  }
  drawText(ctx, s, m) {
    const layout = m.layout();
    const w = m.width, h = layout.height;
    const x = s.locH - m.regX, y = s.locV - m.regY;
    if (s.ink === INK_COPY) {
      ctx.fillStyle = 'rgb(' + this.spriteRGB(s, false).join(',') + ')';
      ctx.fillRect(x, y, w, h);
    }
    const scale = this.scale;
    let entry = this.textCache.get(m);
    if (!entry || entry.version !== m.version || entry.scale !== scale) {
      const c = entry && entry.canvas ? entry.canvas : document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(w * scale) + 2);
      c.height = Math.max(1, Math.ceil(h * scale) + 2);
      const tctx = c.getContext('2d');
      tctx.setTransform(scale, 0, 0, scale, 0, 0);
      tctx.textBaseline = 'alphabetic';
      layout.draw(tctx, this.runtime.textMeasure);
      entry = { canvas: c, version: m.version, scale };
      this.textCache.set(m, entry);
    }
    ctx.drawImage(entry.canvas, x, y, entry.canvas.width / scale, entry.canvas.height / scale);
  }
  // A bitmap with the sprite's ink applied, kept for the next time.
  inked(m, s) {
    const ink = s.ink;
    // A bitmap of 8 bits or fewer takes the sprite's colours: black becomes its foreground
    // colour and white its background colour.
    let fore = null, back = null;
    if (m.depth <= 8) {
      const f = this.spriteRGB(s, true), b = this.spriteRGB(s, false);
      if (f[0] || f[1] || f[2]) fore = f;
      if (b[0] !== 255 || b[1] !== 255 || b[2] !== 255) back = b;
    }
    if (ink !== INK_MATTE && ink !== INK_BG_TRANSPARENT && !fore && !back) return m.drawable();
    const bg = ink === INK_BG_TRANSPARENT ? this.spriteRGB(s, false) : [255, 255, 255];
    const key = ink + ':' + bg.join(',') + ':' + (fore ? fore.join(',') : '') + ':' + (back ? back.join(',') : '');
    let c = m.inkCache.get(key);
    if (c) return c;
    c = makeInked(m, ink, bg, fore, back);
    m.inkCache.set(key, c);
    return c;
  }
  // Is a stage point on a sprite?  Matte sprites only where they are not transparent.
  hit(s, x, y) {
    const m = s.member;
    if (!m || !s.visible) return false;
    const l = s.left, t = s.top, w = s.width, h = s.height;
    if (m instanceof TextMember) {
      const tl = s.locH - m.regX, tt = s.locV - m.regY;
      return x >= tl && y >= tt && x < tl + m.width && y < tt + m.height;
    }
    if (x < l || y < t || x >= l + w || y >= t + h) return false;
    if (m instanceof BitmapMember && s.ink === INK_MATTE) {
      const c = this.inked(m, s);
      let mask = c._mask;
      if (!mask) {
        const cc = c.getContext ? c : null;
        if (!cc) return true;
        mask = c._mask = cc.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      }
      let px = Math.floor((x - l) * m.width / w), py = Math.floor((y - t) * m.height / h);
      if (s.flipH) px = m.width - 1 - px;
      if (s.flipV) py = m.height - 1 - py;
      return mask[(py * c.width + px) * 4 + 3] > 0;
    }
    return true;
  }
}

// A bitmap stretched by its middle: the corners keep their size, the edges stretch along
// their length, so a frame's line keeps its thickness.
function drawNine(ctx, src, x, y, w, h, n) {
  const sw = src.width, sh = src.height;
  const l = Math.min(n.l, sw), t = Math.min(n.t, sh), r = Math.min(n.r, sw - l), b = Math.min(n.b, sh - t);
  const cols = [[0, l, x, l], [l, sw - l - r, x + l, w - l - r], [sw - r, r, x + w - r, r]];
  const rows = [[0, t, y, t], [t, sh - t - b, y + t, h - t - b], [sh - b, b, y + h - b, b]];
  for (const [sx, sW, dx, dW] of cols) {
    for (const [sy, sH, dy, dH] of rows) {
      if (sW > 0 && sH > 0 && dW > 0 && dH > 0) ctx.drawImage(src, sx, sy, sW, sH, dx, dy, dW, dH);
    }
  }
}

function makeInked(m, ink, bg, fore, back) {
  const src = m.canvas();
  const w = src.width, h = src.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const [br, bgG, bb] = bg;
  if (ink === INK_BG_TRANSPARENT) {
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === br && d[i + 1] === bgG && d[i + 2] === bb) d[i + 3] = 0;
    }
  } else if (ink === INK_MATTE) {
    // Matte: the white that reaches the edges of the bitmap is taken away.
    const seen = new Uint8Array(w * h);
    const stack = [];
    const isBg = (p) => d[p * 4] === 255 && d[p * 4 + 1] === 255 && d[p * 4 + 2] === 255;
    const push = (p) => { if (!seen[p] && isBg(p)) { seen[p] = 1; stack.push(p); } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (stack.length) {
      const p = stack.pop();
      d[p * 4 + 3] = 0;
      const x = p % w, y = (p - x) / w;
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
  }
  // Colouring comes after transparency, which is decided on the bitmap's own colours.
  if (fore || back) {
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (fore && r === 0 && g === 0 && b === 0) { d[i] = fore[0]; d[i + 1] = fore[1]; d[i + 2] = fore[2]; }
      else if (back && r === 255 && g === 255 && b === 255) { d[i] = back[0]; d[i + 1] = back[1]; d[i + 2] = back[2]; }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
