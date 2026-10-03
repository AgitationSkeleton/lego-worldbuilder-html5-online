// Text members laid out and drawn: wrapped to the member's width, aligned, with the
// line heights and paragraph spacing Director's text engine gave them.

import { LPoint, num, toInt } from './lingo.js';

// What the port draws each of the movies' fonts with.  04b_08 is the movie's own
// (assets/fonts); Arial and Arial Black are the typefaces the movies embedded subsets of.
const FAMILIES = {
  'arial': "Arial, 'Liberation Sans', Arimo, Helvetica, sans-serif",
  'arial black': "'Arial Black', 'Archivo Black', Arial, sans-serif",
  'wb 04b_08': "'WB 04b_08', monospace",
  '04b_08': "'WB 04b_08', monospace",
  'courier': "'Courier New', Courier, monospace",
  'courier new': "'Courier New', Courier, monospace",
  'system': "Arial, sans-serif",
  'times new roman': "'Times New Roman', Times, serif",
};
export function cssFont(style) {
  const fam = (style.family || style.font || 'Arial').replace(/ \*$/, '').toLowerCase();
  const css = FAMILIES[fam] || ("'" + (style.family || 'Arial') + "', Arial, sans-serif");
  const weight = style.bold ? 'bold ' : (fam === 'arial black' ? '900 ' : '');
  const italic = style.italic ? 'italic ' : '';
  return italic + weight + num(style.size || 12) + 'px ' + css;
}

export class TextMeasure {
  constructor() {
    const c = document.createElement('canvas');
    this.ctx = c.getContext('2d');
    this.cache = new Map();
  }
  // A run's width: Director lays text out with each character a whole number of pixels
  // wide, so the characters' widths are rounded and added up (the browser's own width of
  // the run, in fractions of a pixel, breaks some lines elsewhere than the original did).
  width(text, style) {
    const font = cssFont(style);
    const key = font + '|' + (style.spacing || 0) + '|' + text;
    let w = this.cache.get(key);
    if (w === undefined) {
      this.ctx.font = font;
      w = 0;
      for (const ch of text) w += this.charWidth(ch, font);
      w += (style.spacing || 0) * text.length;
      if (this.cache.size > 20000) this.cache.clear();
      this.cache.set(key, w);
    }
    return w;
  }
  charWidth(ch, font) {
    const key = font + '|#|' + ch;
    let w = this.cache.get(key);
    if (w === undefined) {
      w = Math.round(this.ctx.measureText(ch).width);
      this.cache.set(key, w);
    }
    return w;
  }
}

function styleAt(m, i) {
  let s = 0;
  for (const [pos, idx] of m.runs) {
    if (pos <= i) s = idx; else break;
  }
  return m.styles[s] || m.styles[0] || { family: 'Arial', size: 12, color: [0, 0, 0], spacing: 0, ascent: 11, descent: 3, leading: 0 };
}
function paraAt(m, i) {
  let s = 0;
  for (const [pos, idx] of m.paraRuns) {
    if (pos <= i) s = idx; else break;
  }
  return m.paras[s] || m.paras[0] || { align: 'left', lineHeight: 0, spaceBefore: 0, spaceAfter: 0 };
}
function metrics(st) {
  // The ascent and descent Director worked out for the style, at its size.
  let asc = st.ascent, desc = st.descent;
  if (!asc && !desc) { asc = Math.round(st.size * 0.905); desc = Math.round(st.size * 0.212); }
  return { asc, desc, lead: st.leading || 0 };
}

// A laid-out text member: lines of runs, each run a piece of text in one style.
export class TextLayout {
  constructor(m, measure) {
    this.member = m;
    this.lines = [];
    this.paragraphs = [];   // [firstLine, lastLine] by paragraph
    const text = m.text;
    const width = Math.max(1, m.rectW);
    let y = 0;
    let pos = 0;
    const paras = text.split('\r');
    for (let pi = 0; pi < paras.length; pi++) {
      const ptext = paras[pi];
      if (pi === paras.length - 1 && ptext === '' && pi > 0) break;
      const pstart = pos;
      const pa = paraAt(m, pstart);
      y += pa.spaceBefore || 0;
      const firstLine = this.lines.length;
      // split into words keeping spaces with the word before them
      const pieces = [];
      const re = /[^ ]+ *| +/g;
      let mm;
      while ((mm = re.exec(ptext))) pieces.push({ text: mm[0], at: pstart + mm.index });
      let line = { pieces: [], width: 0, start: pstart };
      const flush = (last) => {
        this.lines.push(this.finishLine(line, pa, width, y, last));
        y = this.lines[this.lines.length - 1].bottom;
        line = { pieces: [], width: 0, start: line.end };
      };
      if (!pieces.length) {
        line.pieces.push({ text: '', at: pstart, style: styleAt(m, pstart), w: 0 });
        line.end = pstart;
        flush(true);
      }
      for (const p of pieces) {
        // a piece may cross style runs: cut it where the style changes
        const parts = splitByStyle(m, p);
        const w = parts.reduce((a, q) => a + measure.width(q.text, q.style), 0);
        const trimmed = parts.reduce((a, q, i) => a + measure.width(i === parts.length - 1 ? q.text.replace(/ +$/, '') : q.text, q.style), 0);
        // (a line as wide as the box is full, in Director)
        if (line.pieces.length && line.width + trimmed >= width) {
          line.end = p.at;
          flush(false);
        }
        if (!line.pieces.length && trimmed > width) {
          // a word longer than the line: break it by characters
          for (const q of parts) {
            for (let k = 0; k < q.text.length; k++) {
              const ch = q.text[k];
              const cw = measure.width(ch, q.style);
              if (line.pieces.length && line.width + cw > width && ch !== ' ') {
                line.end = q.at + k;
                flush(false);
              }
              line.pieces.push({ text: ch, at: q.at + k, style: q.style, w: cw });
              line.width += cw;
            }
          }
          continue;
        }
        for (const q of parts) {
          const qw = measure.width(q.text, q.style);
          line.pieces.push({ text: q.text, at: q.at, style: q.style, w: qw });
          line.width += qw;
        }
      }
      if (pieces.length) {
        line.end = pstart + ptext.length;
        flush(true);
      }
      y += pa.spaceAfter || 0;
      this.paragraphs.push([firstLine, this.lines.length - 1]);
      pos = pstart + ptext.length + 1;
    }
    if (!this.lines.length) {
      const st = styleAt(m, 0);
      const mt = metrics(st);
      this.lines.push({ pieces: [], top: 0, bottom: mt.asc + mt.desc, baseline: mt.asc, x: 0, width: 0, start: 0, end: 0 });
      y = mt.asc + mt.desc;
    }
    this.height = Math.max(1, Math.ceil(y));
    this.width = width;
  }
  finishLine(line, pa, width, y, last) {
    let asc = 0, desc = 0, lead = 0;
    for (const p of line.pieces) {
      const mt = metrics(p.style);
      asc = Math.max(asc, mt.asc);
      desc = Math.max(desc, mt.desc);
      lead = Math.max(lead, mt.lead);
    }
    if (!line.pieces.length) { asc = 11; desc = 3; }
    let h = asc + desc + lead;
    let baseline = asc;
    if (pa.lineHeight > 0) {
      // a fixed line height: the text sits on the line as Director puts it, its descent
      // at the bottom of the line
      baseline = pa.lineHeight - desc;
      h = pa.lineHeight;
    }
    // trailing spaces do not count for alignment
    let visible = line.width;
    for (let i = line.pieces.length - 1; i >= 0; i--) {
      const p = line.pieces[i];
      const t = p.text.replace(/ +$/, '');
      if (t.length === p.text.length) break;
      visible -= p.w - (p.w * t.length / Math.max(1, p.text.length));
      if (t.length) break;
    }
    let x = 0;
    if (pa.align === 'center') x = (width - visible) / 2;
    else if (pa.align === 'right') x = width - visible;
    return { pieces: line.pieces, top: y, bottom: y + h, baseline: y + baseline, x, width: visible,
      start: line.start, end: line.end, justify: pa.align === 'justify' && !last };
  }
  draw(ctx, measure) {
    for (const line of this.lines) {
      let x = line.x;
      let gap = 0;
      if (line.justify) {
        const spaces = line.pieces.reduce((a, p) => a + (p.text.match(/ /g) || []).length, 0);
        if (spaces) gap = (this.width - line.width) / spaces;
      }
      for (const p of line.pieces) {
        if (!p.text) continue;
        const st = p.style;
        ctx.font = cssFont(st);
        const c = st.color || [0, 0, 0];
        ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
        if (st.spacing) {
          let cx = x;
          for (const ch of p.text) {
            ctx.fillText(ch, Math.round(cx), line.baseline);
            cx += measure.width(ch, st);
          }
        } else {
          ctx.fillText(p.text, Math.round(x), line.baseline);
        }
        if (st.underline) {
          ctx.fillRect(Math.round(x), line.baseline + 1, Math.round(p.w), 1);
        }
        x += p.w + (gap ? gap * (p.text.match(/ /g) || []).length : 0);
      }
    }
  }
  lineAt(y) {
    for (let i = 0; i < this.lines.length; i++) {
      if (y < this.lines[i].bottom) return i;
    }
    return -1;
  }
  pointToParagraph(pt) {
    const y = pt instanceof LPoint ? num(pt.v) : 0;
    const li = this.lineAt(y);
    if (li < 0) return -1;
    for (let p = 0; p < this.paragraphs.length; p++) {
      const [a, b] = this.paragraphs[p];
      if (li >= a && li <= b) return p + 1;
    }
    return -1;
  }
  pointToLine(pt) {
    const li = this.lineAt(pt instanceof LPoint ? num(pt.v) : 0);
    return li < 0 ? -1 : li + 1;
  }
  pointToChar(pt) {
    const y = pt instanceof LPoint ? num(pt.v) : 0, x = pt instanceof LPoint ? num(pt.h) : 0;
    const li = this.lineAt(y);
    if (li < 0) return -1;
    const line = this.lines[li];
    let cx = line.x;
    for (const p of line.pieces) {
      if (x < cx + p.w) return p.at + 1 + Math.floor((x - cx) / Math.max(1, p.w / Math.max(1, p.text.length)));
      cx += p.w;
    }
    return line.end;
  }
  charPosToLoc(i) {
    for (const line of this.lines) {
      if (i - 1 <= line.end) return new LPoint(Math.round(line.x), Math.round(line.baseline));
    }
    return new LPoint(0, 0);
  }
}

function splitByStyle(m, piece) {
  const out = [];
  let start = 0;
  let cur = styleAt(m, piece.at);
  for (let k = 1; k < piece.text.length; k++) {
    const st = styleAt(m, piece.at + k);
    if (st !== cur) {
      out.push({ text: piece.text.slice(start, k), at: piece.at + start, style: cur });
      start = k;
      cur = st;
    }
  }
  out.push({ text: piece.text.slice(start), at: piece.at + start, style: cur });
  return out;
}

// HTML as Director's text members import it: enough of it for the menus the game builds.
export function parseHtml(html, baseStyle, basePara) {
  const styles = [];
  const runs = [];
  const paras = [];
  const paraRuns = [];
  let text = '';
  const stack = [{ ...baseStyle, bold: false, italic: false, underline: false }];
  let para = { ...basePara };
  const styleIndex = (st) => {
    const key = JSON.stringify(st);
    let i = styles.findIndex(s => JSON.stringify(s) === key);
    if (i < 0) { styles.push({ ...st }); i = styles.length - 1; }
    return i;
  };
  const addText = (t) => {
    if (!t) return;
    const si = styleIndex(stack[stack.length - 1]);
    if (!runs.length || runs[runs.length - 1][1] !== si) runs.push([text.length, si]);
    text += t;
  };
  const newPara = () => {
    paras.push({ ...para });
    paraRuns.push([text.length, paras.length - 1]);
  };
  newPara();
  const re = /<\s*(\/?)\s*([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let m;
  const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/[\r\n]+/g, ' ');
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) { addText(decode(m[4])); continue; }
    const close = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = {};
    m[3].replace(/([a-zA-Z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, (_, k, v) => { attrs[k.toLowerCase()] = v.replace(/^["']|["']$/g, ''); });
    const top = stack[stack.length - 1];
    if (tag === 'br') { text += '\r'; newPara(); continue; }
    if (tag === 'p') {
      if (text.length && !text.endsWith('\r')) { text += '\r'; }
      if (!close) { para = { ...basePara, align: (attrs.align || basePara.align || 'left').toLowerCase() }; }
      newPara();
      continue;
    }
    if (['b', 'strong', 'i', 'em', 'u', 'font'].includes(tag)) {
      if (close) { if (stack.length > 1) stack.pop(); continue; }
      const st = { ...top };
      if (tag === 'b' || tag === 'strong') st.bold = true;
      if (tag === 'i' || tag === 'em') st.italic = true;
      if (tag === 'u') st.underline = true;
      if (tag === 'font') {
        if (attrs.face) { st.family = attrs.face.split(',')[0].trim(); st.font = st.family; }
        if (attrs.size) st.size = [0, 9, 10, 12, 14, 18, 24, 36][toInt(attrs.size)] || st.size;
        if (attrs.color) {
          const c = attrs.color.replace('#', '');
          st.color = [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
        }
      }
      stack.push(st);
    }
  }
  if (!styles.length) styles.push({ ...baseStyle });
  if (!runs.length) runs.push([0, 0]);
  return { text, styles, runs, paras, paraRuns };
}
