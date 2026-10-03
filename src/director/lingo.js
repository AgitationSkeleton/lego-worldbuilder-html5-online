// Lingo's values and operators, for the translated scripts.
//
// VOID is undefined.  Integers are JavaScript numbers (always whole); floats are LFloat
// boxes, because Lingo keeps the two apart (5 / 2 is 2, 5.0 / 2 is 2.5000).  Strings are
// strings, compared without regard to case.  Symbols are interned, so the same symbol is
// the same object whatever its case.  Lists, property lists, points and rects are classes
// here; everything else the runtime provides (sprites, members, sound channels, images...)
// answers to get / set / call through lgGet, lgSet and lgCall.

export class LFloat {
  constructor(v) { this.v = v; }
}
export const F = (v) => new LFloat(v);
export const PI = new LFloat(Math.PI);

export class LSymbol {
  constructor(name) { this.name = name; this.key = name.toLowerCase(); }
  toString() { return this.name; }
}
const symbols = new Map();
export function sym(name) {
  const key = name.toLowerCase();
  let s = symbols.get(key);
  if (!s) { s = new LSymbol(name); symbols.set(key, s); }
  return s;
}

export class LList {
  constructor(a) { this.a = a || []; this.sorted = false; }
}
export class LPropList {
  constructor(k, v) { this.k = k || []; this.v = v || []; this.sorted = false; }
  find(key) {
    const k = this.k;
    if (key instanceof LSymbol) {
      for (let i = 0; i < k.length; i++) if (k[i] === key) return i;
      return -1;
    }
    for (let i = 0; i < k.length; i++) if (eqv(k[i], key)) return i;
    return -1;
  }
}
export class LPoint {
  constructor(h, v) { this.h = h; this.v = v; }
}
export class LRect {
  constructor(l, t, r, b) { this.l = l; this.t = t; this.r = r; this.b = b; }
}
export class LColor {
  constructor(r, g, b, index) { this.r = r; this.g = g; this.b = b; this.index = index; }
}

// A script instance: its script, its properties (by lower-case name), and its ancestor
// among them.
let instanceCount = 0;
export class LInstance {
  constructor(script) {
    this.script = script;
    this.$ = Object.create(null);
    for (const p of script.props) this.$[p] = undefined;
    this.id = ++instanceCount;
  }
  // The handler, here or up the ancestor chain, and the instance that has it.  The
  // handler runs on that instance (its property variables are that instance's), but its
  // "me" is the object the message was sent to, as in Director: a child's message handled
  // by its ancestor gets the child as "me", and ancestor.handler() gets the ancestor.
  // (The game relies on it: a unit's menu is shown only for the object highlighted, which
  // is the child, from a handler in vehicle.generic.)
  findHandler(name) {
    let o = this;
    for (let depth = 0; o instanceof LInstance && depth < 100; depth++) {
      const h = o.script.handlers[name];
      if (h) return { fn: h, inst: o };
      o = o.$.ancestor;
    }
    return null;
  }
  getProp(name) {
    let o = this;
    for (let depth = 0; o instanceof LInstance && depth < 100; depth++) {
      if (name in o.$) return o.$[name];
      o = o.$.ancestor;
    }
    if (name === 'spritenum' && this.spriteNum) return this.spriteNum;
    return undefined;
  }
  setProp(name, value) {
    let o = this;
    for (let depth = 0; o instanceof LInstance && depth < 100; depth++) {
      if (name in o.$) { o.$[name] = value; return; }
      o = o.$.ancestor;
    }
    // Lingo would refuse; keep it on the object rather than lose it.
    this.$[name] = value;
  }
}

// Errors the original would have shown as a script error dialog.
export class LingoError extends Error {}
export function stuck() { throw new LingoError("repeat while: the loop never ends"); }
export let onWarning = (msg) => console.warn('[lingo] ' + msg);
export function setWarningHandler(fn) { onWarning = fn; }

// ---- conversions ----

export let floatPrecision = 4;
export function setFloatPrecision(n) { floatPrecision = n; }
export let itemDelimiter = ',';
export function setItemDelimiter(c) { itemDelimiter = c; }

export function isNum(x) { return typeof x === 'number' || x instanceof LFloat; }
export function num(x) {
  if (typeof x === 'number') return x;
  if (x instanceof LFloat) return x.v;
  if (x === undefined) return 0;
  if (typeof x === 'string') { const n = strToNum(x); return n === undefined ? 0 : numv(n); }
  return 0;
}
function numv(x) { return x instanceof LFloat ? x.v : x; }
// Lingo's integer of a float rounds half away from zero.
export function roundInt(v) { return v < 0 ? -Math.round(-v) : Math.round(v); }
export function toInt(x) {
  if (typeof x === 'number') return x;
  if (x instanceof LFloat) return roundInt(x.v);
  if (typeof x === 'string') { const n = strToNum(x); return n === undefined ? 0 : (n instanceof LFloat ? roundInt(n.v) : n); }
  return 0;
}
// A string as a number the way Lingo reads one, or undefined when it is not one.
export function strToNum(s) {
  const t = s.trim();
  if (/^[-+]?\d+$/.test(t)) return parseInt(t, 10) | 0;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return new LFloat(parseFloat(t));
  return undefined;
}

export function floatStr(v) {
  if (!isFinite(v)) return v > 0 ? 'INF' : v < 0 ? '-INF' : 'NAN';
  if (floatPrecision <= 0) return String(Math.round(v));
  return v.toFixed(Math.min(floatPrecision, 15));
}

// What concatenation and string() make of a value.
export function str(x) {
  if (typeof x === 'string') return x;
  if (typeof x === 'number') return String(x);
  if (x === undefined) return '';
  if (x instanceof LFloat) return floatStr(x.v);
  if (x instanceof LSymbol) return x.name;
  return repr(x, false);
}

// How "put" and string() show a value inside a list.
export function repr(x, inList = true) {
  if (x === undefined) return inList ? '<Void>' : '';
  if (typeof x === 'number') return String(x);
  if (x instanceof LFloat) return floatStr(x.v);
  if (typeof x === 'string') return inList ? '"' + x + '"' : x;
  if (x instanceof LSymbol) return '#' + x.name;
  if (x instanceof LList) return '[' + x.a.map(e => repr(e)).join(', ') + ']';
  if (x instanceof LPropList) {
    if (!x.k.length) return '[:]';
    return '[' + x.k.map((k, i) => repr(k) + ': ' + repr(x.v[i])).join(', ') + ']';
  }
  if (x instanceof LPoint) return 'point(' + repr(x.h) + ', ' + repr(x.v) + ')';
  if (x instanceof LRect) return 'rect(' + [x.l, x.t, x.r, x.b].map(e => repr(e)).join(', ') + ')';
  if (x instanceof LColor) return x.index !== undefined ? 'paletteIndex(' + x.index + ')' : 'rgb(' + x.r + ', ' + x.g + ', ' + x.b + ')';
  if (x instanceof LInstance) return '<offspring "' + x.script.name + '" 2 ' + x.id + '>';
  if (x && x.lgRepr) return x.lgRepr();
  return String(x);
}

// ---- truth ----

export function t(x) {
  if (typeof x === 'number') return x !== 0;
  if (x === undefined) return false;
  if (x instanceof LFloat) return x.v !== 0;
  if (typeof x === 'string') { const n = strToNum(x); return n !== undefined && numv(n) !== 0; }
  return true;
}
export function not(x) { return t(x) ? 0 : 1; }
export function and(a, b) { return t(a) && t(b) ? 1 : 0; }
export function or(a, b) { return t(a) || t(b) ? 1 : 0; }

// ---- arithmetic ----

function arith(a, b, opI, opF, name) {
  if (typeof a === 'number' && typeof b === 'number') return opI(a, b);
  if (a instanceof LList || b instanceof LList || a instanceof LPoint || b instanceof LPoint ||
      a instanceof LRect || b instanceof LRect || a instanceof LPropList || b instanceof LPropList) {
    return mapOp(a, b, (x, y) => arith(x, y, opI, opF, name));
  }
  if (a instanceof LColor || b instanceof LColor) return colorOp(a, b, opI);
  a = numeric(a); b = numeric(b);
  if (typeof a === 'number' && typeof b === 'number') return opI(a, b);
  return new LFloat(opF(numv(a), numv(b)));
}
function numeric(x) {
  if (typeof x === 'number' || x instanceof LFloat) return x;
  if (x === undefined) return 0;
  if (typeof x === 'string') { const n = strToNum(x); return n === undefined ? 0 : n; }
  if (x instanceof LSymbol) return 0;
  return 0;
}
function mapOp(a, b, op) {
  const items = (x) => x instanceof LList ? x.a : x instanceof LPoint ? [x.h, x.v] :
    x instanceof LRect ? [x.l, x.t, x.r, x.b] : x instanceof LPropList ? x.v : null;
  const ia = items(a), ib = items(b);
  let out;
  if (ia && ib) {
    const n = Math.min(ia.length, ib.length);
    out = [];
    for (let i = 0; i < n; i++) out.push(op(ia[i], ib[i]));
  } else if (ia) {
    out = ia.map(x => op(x, b));
  } else {
    out = ib.map(y => op(a, y));
  }
  const shape = ia ? a : b;
  if (shape instanceof LPoint) return new LPoint(out[0], out[1]);
  if (shape instanceof LRect) return new LRect(out[0], out[1], out[2], out[3]);
  if (shape instanceof LPropList) return new LPropList(shape.k.slice(0, out.length), out);
  return new LList(out);
}
function colorOp(a, b, op) {
  const ca = a instanceof LColor ? a : null, cb = b instanceof LColor ? b : null;
  const ch = (c, x, f) => c ? c[f] : toInt(x);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  return new LColor(clamp(op(ch(ca, a, 'r'), ch(cb, b, 'r'))), clamp(op(ch(ca, a, 'g'), ch(cb, b, 'g'))),
    clamp(op(ch(ca, a, 'b'), ch(cb, b, 'b'))));
}
const addI = (a, b) => (a + b) | 0, addF = (a, b) => a + b;
const subI = (a, b) => (a - b) | 0, subF = (a, b) => a - b;
const mulI = (a, b) => Math.imul(a, b), mulF = (a, b) => a * b;
const divI = (a, b) => {
  if (b === 0) { onWarning('division by zero'); return 0; }
  return (a / b) | 0;
};
const divF = (a, b) => a / b;
export function add(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return (a + b) | 0;
  return arith(a, b, addI, addF, '+');
}
export function sub(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return (a - b) | 0;
  return arith(a, b, subI, subF, '-');
}
export function mul(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.imul(a, b);
  return arith(a, b, mulI, mulF, '*');
}
export function div(a, b) { return arith(a, b, divI, divF, '/'); }
export function mod(a, b) {
  if (a instanceof LList || b instanceof LList || a instanceof LPoint || b instanceof LPoint) {
    return mapOp(a, b, mod);
  }
  // Lingo's mod works on integers; a float is cut to its whole part first.
  const x = Math.trunc(num(a)) | 0, y = Math.trunc(num(b)) | 0;
  if (y === 0) { onWarning('mod by zero'); return 0; }
  return (x % y) | 0;
}
export function neg(a) {
  if (typeof a === 'number') return (-a) | 0;
  if (a instanceof LFloat) return new LFloat(-a.v);
  return arith(0, a, subI, subF, '-');
}

// ---- comparison ----

const LESS = 1, EQUAL = 2, GREATER = 4, ERR = 8;
function cmp(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? LESS : a === b ? EQUAL : GREATER;
  // VOID equals VOID, and (as Director has it) equals and is less than the integer 0.
  if (a === undefined && b === undefined) return EQUAL;
  if (a === undefined) return (b === 0) ? (LESS | EQUAL) : LESS;
  if (b === undefined) return (a === 0) ? (GREATER | EQUAL) : GREATER;
  const na = isNum(a), nb = isNum(b);
  if (na && nb) {
    const x = numv(a), y = numv(b);
    return x < y ? LESS : x === y ? EQUAL : GREATER;
  }
  if (typeof a === 'string' && nb) {
    const n = strToNum(a);
    if (n !== undefined) return cmp(n, b);
    return GREATER;
  }
  if (na && typeof b === 'string') {
    const n = strToNum(b);
    if (n !== undefined) return cmp(a, n);
    return LESS;
  }
  if ((typeof a === 'string' || a instanceof LSymbol) && (typeof b === 'string' || b instanceof LSymbol)) {
    if (a instanceof LSymbol && b instanceof LSymbol) return a === b ? EQUAL : (a.key < b.key ? LESS : GREATER);
    const x = str(a).toLowerCase(), y = str(b).toLowerCase();
    return x < y ? LESS : x === y ? EQUAL : GREATER;
  }
  if (a instanceof LSymbol || b instanceof LSymbol) return a === b ? EQUAL : ERR;
  // Lists compare by their values, in order: a sorted list of property lists is kept in
  // the order of their first values.
  const va = listValues(a), vb = listValues(b);
  if (va && vb) {
    const n = Math.min(va.length, vb.length);
    for (let i = 0; i < n; i++) {
      const c = cmp(va[i], vb[i]);
      if (c & (LESS | GREATER | ERR)) return c & (LESS | GREATER) ? c : ERR;
    }
    return va.length < vb.length ? LESS : va.length > vb.length ? GREATER : EQUAL;
  }
  return ERR;
}
function listValues(x) {
  if (x instanceof LList) return x.a;
  if (x instanceof LPropList) return x.v;
  if (x instanceof LPoint) return [x.h, x.v];
  if (x instanceof LRect) return [x.l, x.t, x.r, x.b];
  return null;
}
// Equality, for =, case and list searches.
export function eqv(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return false;
  if ((typeof a === 'number' || a instanceof LFloat) && (typeof b === 'number' || b instanceof LFloat)) {
    return numv(a) === numv(b);
  }
  if (a instanceof LSymbol || b instanceof LSymbol) {
    if (a instanceof LSymbol && typeof b === 'string') return a.key === b.toLowerCase();
    if (b instanceof LSymbol && typeof a === 'string') return b.key === a.toLowerCase();
    return false;
  }
  if (a instanceof LList && b instanceof LList) {
    if (a.a.length !== b.a.length) return false;
    for (let i = 0; i < a.a.length; i++) if (!eqv(a.a[i], b.a[i])) return false;
    return true;
  }
  if (a instanceof LPropList && b instanceof LPropList) {
    if (a.k.length !== b.k.length) return false;
    for (let i = 0; i < a.k.length; i++) if (!eqv(a.k[i], b.k[i]) || !eqv(a.v[i], b.v[i])) return false;
    return true;
  }
  if (a instanceof LPoint && b instanceof LPoint) return eqv(a.h, b.h) && eqv(a.v, b.v);
  if (a instanceof LRect && b instanceof LRect) return eqv(a.l, b.l) && eqv(a.t, b.t) && eqv(a.r, b.r) && eqv(a.b, b.b);
  // A point equals a list of the same values: the map keeps tile positions as [x, y] and
  // clicks give point(x, y).
  if ((a instanceof LList || a instanceof LPoint || a instanceof LRect) && (b instanceof LList || b instanceof LPoint || b instanceof LRect)) {
    const va = listValues(a), vb = listValues(b);
    if (va.length !== vb.length) return false;
    for (let i = 0; i < va.length; i++) if (!eqv(va[i], vb[i])) return false;
    return true;
  }
  // Two palette colours are equal by their index (getPixel on an indexed image answers
  // with one, which the world maps' mini units compare with paletteIndex(n)); two RGB
  // colours by their channels.
  if (a instanceof LColor && b instanceof LColor) {
    if (a.index !== undefined && b.index !== undefined) return a.index === b.index;
    return a.r === b.r && a.g === b.g && a.b === b.b;
  }
  if (a && a.lgEquals) return a.lgEquals(b);
  if (b && b.lgEquals) return b.lgEquals(a);
  if (typeof a === 'object' || typeof b === 'object') {
    if (a === undefined || b === undefined) return (cmp(a, b) & EQUAL) !== 0;
    return false;
  }
  return (cmp(a, b) & EQUAL) !== 0;
}
export function eq(a, b) { return eqv(a, b) ? 1 : 0; }
export function eqb(a, b) { return eqv(a, b); }
export function ne(a, b) { return eqv(a, b) ? 0 : 1; }
export function lt(a, b) { return (cmp(a, b) & LESS) ? 1 : 0; }
export function gt(a, b) { return (cmp(a, b) & GREATER) ? 1 : 0; }
export function le(a, b) { const c = cmp(a, b); return (c & (LESS | EQUAL)) ? 1 : 0; }
export function ge(a, b) { const c = cmp(a, b); return (c & (GREATER | EQUAL)) ? 1 : 0; }

// ---- strings ----

export function cat(a, b) { return str(a) + str(b); }
export function cats(a, b) { return str(a) + ' ' + str(b); }
export function contains(a, b) { return str(a).toLowerCase().includes(str(b).toLowerCase()) ? 1 : 0; }
export function starts(a, b) { return str(a).toLowerCase().startsWith(str(b).toLowerCase()) ? 1 : 0; }

const isSpace = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\v' || c === '\f';

// The bounds [start, end) of chunks first..last of a string, as Director finds them;
// first = -30000 is the last chunk.  Gives { start, end, count } with start = -1 when the
// chunk is not there.
function chunkBounds(s, type, first, last) {
  if (!last || last < first) last = first;
  let count = 0, cs = -1, ce = -1, es = -1, ee = -1;
  if (type === 'char') {
    if (first === -30000) return { start: s.length - 1, end: s.length, count: s.length };
    if (first >= 1 && first <= s.length) { es = first - 1; ee = Math.min(last, s.length); }
    return { start: es, end: es < 0 ? -1 : ee, count: s.length };
  }
  if (type === 'word') {
    let i = 0;
    while (i < s.length && isSpace(s[i])) i++;
    while (i < s.length) {
      count++;
      cs = i;
      if (count === first) es = cs;
      while (i < s.length && !isSpace(s[i])) i++;
      ce = i;
      if (count === last && first !== -30000) { ee = ce; break; }
      while (i < s.length && isSpace(s[i])) i++;
    }
  } else {
    const delim = type === 'item' ? itemDelimiter : '\r';
    let i = 0;
    for (;;) {
      count++;
      cs = i;
      if (count === first) es = cs;
      while (i < s.length && s[i] !== delim) i++;
      ce = i;
      if (count === last && first !== -30000) { ee = ce; break; }
      if (i === s.length) break;
      i++;
    }
  }
  if (first === -30000) return { start: cs, end: ce, count };
  if (es < 0) return { start: -1, end: -1, count };
  if (ee < 0) ee = s.length;
  return { start: es, end: ee, count };
}

export function chunk(s, type, first, last) {
  s = str(s);
  const b = chunkBounds(s, type, toInt(first), toInt(last));
  return b.start < 0 ? '' : s.slice(b.start, b.end);
}
export function chunkCount(s, type) {
  s = str(s);
  if (type === 'char') return s.length;
  if (type === 'word') {
    let n = 0, i = 0;
    while (i < s.length) {
      while (i < s.length && isSpace(s[i])) i++;
      if (i < s.length) n++;
      while (i < s.length && !isSpace(s[i])) i++;
    }
    return n;
  }
  return chunkBounds(s, type, -30000, 0).count;
}
export function lastChunk(s, type) { return chunk(s, type, -30000, 0); }

export function putChunk(s, type, first, last, value, mode) {
  s = str(s);
  value = str(value);
  first = toInt(first);
  last = toInt(last);
  let b = chunkBounds(s, type, first, last);
  if (b.start < 0) {
    // Putting into a chunk past the end: items and lines are padded out to it.
    if ((type === 'item' || type === 'line') && first > 0) {
      const delim = type === 'item' ? itemDelimiter : '\r';
      const have = chunkCount(s, type);
      s = s + delim.repeat(Math.max(0, first - have));
      b = chunkBounds(s, type, first, last);
    } else {
      return mode === 'before' ? value + s : s + value;
    }
  }
  if (mode === 'into') return s.slice(0, b.start) + value + s.slice(b.end);
  if (mode === 'after') return s.slice(0, b.end) + value + s.slice(b.end);
  return s.slice(0, b.start) + value + s.slice(b.start);
}

export function deleteChunk(s, type, first, last) {
  s = str(s);
  const b = chunkBounds(s, type, toInt(first), toInt(last));
  let start = b.start, end = b.end;
  if (start < 0) return s;
  if (type === 'word') {
    while (end < s.length && isSpace(s[end])) end++;
  } else if (type === 'item' || type === 'line') {
    const split = type === 'item' ? itemDelimiter : '\r';
    const isFirst = start === 0 || s[start - 1] !== split;
    const isLast = end === s.length || s[end] !== split;
    if (isFirst && isLast) { /* the whole string */ } else if (isFirst) end++; else start--;
  }
  return s.slice(0, start) + s.slice(end);
}

// "x.char" and friends: a stand-in that knows its count and its members.
class ChunkList {
  constructor(s, type) { this.s = s; this.type = type; }
  lgGet(name) {
    if (name === 'count') return chunkCount(this.s, this.type);
    return undefined;
  }
  lgIndex(i) { return chunk(this.s, this.type, i, 0); }
}

// ---- lists ----

export function list(a) { return new LList(a); }
export function plist(kv) {
  const p = new LPropList();
  for (let i = 0; i < kv.length; i += 2) { p.k.push(kv[i]); p.v.push(kv[i + 1]); }
  return p;
}
export function count(x) {
  if (x instanceof LList) return x.a.length;
  if (x instanceof LPropList) return x.k.length;
  if (x instanceof LPoint) return 2;
  if (x instanceof LRect) return 4;
  if (typeof x === 'string') return x.length;
  if (x && x.lgGet) return toInt(x.lgGet('count'));
  return 0;
}

function sortKey(a, b) {
  const c = cmp(a, b);
  return (c & LESS) ? -1 : (c & GREATER) ? 1 : 0;
}
function sortedInsert(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortKey(arr[mid], v) <= 0) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Methods of lists and property lists, by lower-case name.
const listMethods = {
  count: (l) => l.a.length,
  add: (l, v) => {
    if (l.sorted) l.a.splice(sortedInsert(l.a, v), 0, v); else l.a.push(v);
    return undefined;
  },
  append: (l, v) => { l.a.push(v); return undefined; },
  addat: (l, i, v) => {
    i = toInt(i);
    if (i > l.a.length + 1000000) throw new LingoError('list index ' + i + ' is far past the end of the list');
    while (l.a.length < i - 1) l.a.push(0);
    l.a.splice(i - 1, 0, v);
  },
  getat: (l, i) => l.a[toInt(i) - 1],
  setat: (l, i, v) => { listSet(l, i, v); },
  deleteat: (l, i) => { i = toInt(i); if (i >= 1 && i <= l.a.length) l.a.splice(i - 1, 1); },
  deleteone: (l, v) => {
    const i = l.a.findIndex(e => eqv(e, v));
    if (i >= 0) l.a.splice(i, 1);
  },
  deleteall: (l) => { l.a.length = 0; },
  getone: (l, v) => l.a.findIndex(e => eqv(e, v)) + 1,
  getpos: (l, v) => l.a.findIndex(e => eqv(e, v)) + 1,
  findpos: (l, v) => {
    const i = toInt(v);
    return i >= 1 && i <= l.a.length ? i : 0;
  },
  getlast: (l) => l.a[l.a.length - 1],
  getfirst: (l) => l.a[0],
  duplicate: (l) => duplicate(l),
  sort: (l) => { l.a.sort(sortKey); l.sorted = true; },
  max: (l) => l.a.reduce((m, e) => (m === undefined || gt(e, m)) ? e : m, undefined),
  min: (l) => l.a.reduce((m, e) => (m === undefined || lt(e, m)) ? e : m, undefined),
  ilk: () => sym('list'),
  getprop: (l, i) => l.a[toInt(i) - 1],
  getaprop: (l, i) => l.a[toInt(i) - 1],
};
const plistMethods = {
  count: (p) => p.k.length,
  addprop: (p, k, v) => {
    if (p.sorted) {
      const i = sortedInsert(p.k, k);
      p.k.splice(i, 0, k); p.v.splice(i, 0, v);
    } else { p.k.push(k); p.v.push(v); }
  },
  add: (p, v) => { onWarning('add on a property list'); },
  setaprop: (p, k, v) => plistSet(p, k, v),
  setprop: (p, k, v) => plistSet(p, k, v),
  getaprop: (p, k) => { const i = p.find(k); return i < 0 ? undefined : p.v[i]; },
  getprop: (p, k) => {
    const i = p.find(k);
    if (i < 0) { onWarning('getProp: no property ' + repr(k)); return undefined; }
    return p.v[i];
  },
  getpropat: (p, i) => p.k[toInt(i) - 1],
  getat: (p, i) => p.v[toInt(i) - 1],
  setat: (p, i, v) => { p.v[toInt(i) - 1] = v; },
  deleteprop: (p, k) => {
    const i = p.find(k);
    if (i >= 0) { p.k.splice(i, 1); p.v.splice(i, 1); }
  },
  deleteat: (p, i) => { i = toInt(i) - 1; if (i >= 0 && i < p.k.length) { p.k.splice(i, 1); p.v.splice(i, 1); } },
  deleteone: (p, v) => {
    const i = p.v.findIndex(e => eqv(e, v));
    if (i >= 0) { p.k.splice(i, 1); p.v.splice(i, 1); }
  },
  deleteall: (p) => { p.k.length = 0; p.v.length = 0; },
  findpos: (p, k) => p.find(k) + 1,
  findposnear: (p, k) => { const i = p.find(k); return i + 1; },
  getone: (p, v) => { const i = p.v.findIndex(e => eqv(e, v)); return i < 0 ? 0 : p.k[i]; },
  getpos: (p, v) => p.v.findIndex(e => eqv(e, v)) + 1,
  getlast: (p) => p.v[p.v.length - 1],
  getfirst: (p) => p.v[0],
  duplicate: (p) => duplicate(p),
  sort: (p) => {
    const idx = p.k.map((k, i) => i).sort((a, b) => sortKey(p.k[a], p.k[b]));
    p.k = idx.map(i => p.k[i]); p.v = idx.map(i => p.v[i]); p.sorted = true;
  },
  max: (p) => p.v.reduce((m, e) => (m === undefined || gt(e, m)) ? e : m, undefined),
  min: (p) => p.v.reduce((m, e) => (m === undefined || lt(e, m)) ? e : m, undefined),
  ilk: () => sym('propList'),
};
const pointMethods = {
  inside: (p, r) => {
    const h = num(p.h), v = num(p.v);
    return h >= num(r.l) && h < num(r.r) && v >= num(r.t) && v < num(r.b) ? 1 : 0;
  },
  duplicate: (p) => new LPoint(p.h, p.v),
  getat: (p, i) => toInt(i) === 1 ? p.h : p.v,
  setat: (p, i, v) => { if (toInt(i) === 1) p.h = v; else p.v = v; },
  count: () => 2,
  ilk: () => sym('point'),
};
const rectMethods = {
  inside: (r, p) => pointMethods.inside(p, r),
  intersect: (a, b) => {
    const r = new LRect(Math.max(num(a.l), num(b.l)), Math.max(num(a.t), num(b.t)),
      Math.min(num(a.r), num(b.r)), Math.min(num(a.b), num(b.b)));
    if (r.r <= r.l || r.b <= r.t) return new LRect(0, 0, 0, 0);
    return r;
  },
  union: (a, b) => new LRect(Math.min(num(a.l), num(b.l)), Math.min(num(a.t), num(b.t)),
    Math.max(num(a.r), num(b.r)), Math.max(num(a.b), num(b.b))),
  offset: (r, h, v) => new LRect(add(r.l, h), add(r.t, v), add(r.r, h), add(r.b, v)),
  inflate: (r, h, v) => new LRect(sub(r.l, h), sub(r.t, v), add(r.r, h), add(r.b, v)),
  duplicate: (r) => new LRect(r.l, r.t, r.r, r.b),
  getat: (r, i) => [r.l, r.t, r.r, r.b][toInt(i) - 1],
  setat: (r, i, v) => { const k = ['l', 't', 'r', 'b'][toInt(i) - 1]; if (k) r[k] = v; },
  count: () => 4,
  map: (r, a, b) => r,
  ilk: () => sym('rect'),
};

function listSet(l, i, v) {
  i = toInt(i);
  if (i < 1) { onWarning('list index ' + i); return; }
  if (i > l.a.length + 1000000) throw new LingoError('list index ' + i + ' is far past the end of the list');
  while (l.a.length < i - 1) l.a.push(0);
  l.a[i - 1] = v;
}
function plistSet(p, k, v) {
  const i = p.find(k);
  if (i >= 0) p.v[i] = v;
  else plistMethods.addprop(p, k, v);
}

export function duplicate(x) {
  if (x instanceof LList) { const l = new LList(x.a.map(duplicate)); l.sorted = x.sorted; return l; }
  if (x instanceof LPropList) {
    const p = new LPropList(x.k.slice(), x.v.map(duplicate)); p.sorted = x.sorted; return p;
  }
  if (x instanceof LPoint) return new LPoint(x.h, x.v);
  if (x instanceof LRect) return new LRect(x.l, x.t, x.r, x.b);
  if (x && x.lgDuplicate) return x.lgDuplicate();
  return x;
}

// ---- property and index access ----

// x.voidp, x.integerp ...: Lingo lets a one-argument function be written as a property
// of its argument, on any value.
const VALUE_FUNCTIONS = {
  voidp: (x) => x === undefined ? 1 : 0,
  integerp: (x) => typeof x === 'number' ? 1 : 0,
  floatp: (x) => x instanceof LFloat ? 1 : 0,
  stringp: (x) => typeof x === 'string' ? 1 : 0,
  symbolp: (x) => x instanceof LSymbol ? 1 : 0,
  listp: (x) => (x instanceof LList || x instanceof LPropList || x instanceof LPoint || x instanceof LRect) ? 1 : 0,
  objectp: (x) => (x !== undefined && typeof x === 'object' && !(x instanceof LSymbol)) ? 1 : 0,
};

// obj.prop
export function gp(o, name) {
  const vf = VALUE_FUNCTIONS[name];
  if (vf && !(o instanceof LPropList && o.find(sym(name)) >= 0) && !(o instanceof LInstance && name in o.$)) return vf(o);
  if (o instanceof LPropList) {
    const i = o.find(sym(name));
    if (i >= 0) return o.v[i];
    if (name === 'count') return o.k.length;
    if (name === 'ilk') return sym('propList');
    return undefined;
  }
  if (o instanceof LInstance) return o.getProp(name);
  if (o instanceof LList) {
    if (name === 'count') return o.a.length;
    if (name === 'ilk') return sym('list');
    onWarning('property ' + name + ' of a list');
    return undefined;
  }
  if (typeof o === 'string') {
    if (name === 'length') return o.length;
    if (name === 'char' || name === 'word' || name === 'item' || name === 'line') return new ChunkList(o, name);
    if (name === 'chartonum') return o.length ? o.charCodeAt(0) : 0;
    if (name === 'string') return o;
    if (name === 'value') return value(o);
    if (name === 'integer') return toInt(o);
    if (name === 'float') { const n = strToNum(o); return n === undefined ? o : new LFloat(numv(n)); }
    if (name === 'symbol') return sym(o);
    if (name === 'ilk') return sym('string');
    return undefined;
  }
  if (o instanceof LPoint) {
    if (name === 'loch' || name === 'h') return o.h;
    if (name === 'locv' || name === 'v') return o.v;
    if (name === 'ilk') return sym('point');
    return undefined;
  }
  if (o instanceof LRect) {
    switch (name) {
      case 'left': return o.l;
      case 'top': return o.t;
      case 'right': return o.r;
      case 'bottom': return o.b;
      case 'width': return sub(o.r, o.l);
      case 'height': return sub(o.b, o.t);
      case 'ilk': return sym('rect');
    }
    return undefined;
  }
  if (o instanceof LColor) {
    switch (name) {
      case 'red': return o.r;
      case 'green': return o.g;
      case 'blue': return o.b;
      case 'paletteindex': return o.index;
      case 'colortype': return sym(o.index !== undefined ? 'paletteIndex' : 'rgb');
      case 'hexstring': return '#' + [o.r, o.g, o.b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
    }
    return undefined;
  }
  if (o && o.lgGet) return o.lgGet(name);
  if (o instanceof LSymbol && name === 'string') return o.name;
  if (o === undefined) { onWarning('property ' + name + ' of VOID'); return undefined; }
  if (isNum(o)) {
    if (name === 'ilk') return sym(typeof o === 'number' ? 'integer' : 'float');
    if (name === 'integer') return toInt(o);
    if (name === 'float') return new LFloat(num(o));
  }
  return undefined;
}

// obj.prop = value
export function sp(o, name, v) {
  if (o instanceof LPropList) { plistSet(o, sym(name), v); return; }
  if (o instanceof LInstance) { o.setProp(name, v); return; }
  if (o instanceof LPoint) {
    if (name === 'loch' || name === 'h') o.h = v; else if (name === 'locv' || name === 'v') o.v = v;
    return;
  }
  if (o instanceof LRect) {
    switch (name) {
      case 'left': o.l = v; return;
      case 'top': o.t = v; return;
      case 'right': o.r = v; return;
      case 'bottom': o.b = v; return;
      case 'width': o.r = add(o.l, v); return;
      case 'height': o.b = add(o.t, v); return;
    }
    return;
  }
  if (o && o.lgSet) { o.lgSet(name, v); return; }
  onWarning('cannot set ' + name + ' of ' + repr(o));
}

// obj[i]
export function gi(o, i) {
  if (o instanceof LList) {
    if (typeof i === 'number') return o.a[i - 1];
    return o.a[toInt(i) - 1];
  }
  if (o instanceof LPropList) {
    // a number is a position; anything else (a symbol, a string, a point...) is a key
    if (typeof i === 'number' || i instanceof LFloat) return o.v[toInt(i) - 1];
    const k = o.find(i);
    return k < 0 ? undefined : o.v[k];
  }
  if (o instanceof LPoint) return toInt(i) === 1 ? o.h : toInt(i) === 2 ? o.v : undefined;
  if (o instanceof LRect) return [o.l, o.t, o.r, o.b][toInt(i) - 1];
  if (o instanceof LInstance) {
    if (i instanceof LSymbol || typeof i === 'string') return o.getProp(str(i).toLowerCase());
    return undefined;
  }
  if (o instanceof ChunkList) return o.lgIndex(i);
  if (typeof o === 'string') return chunk(o, 'char', i, 0);
  if (o && o.lgIndex) return o.lgIndex(i);
  if (o === undefined) { onWarning('index ' + repr(i) + ' of VOID'); return undefined; }
  return undefined;
}

// obj[i] = value
export function si(o, i, v) {
  if (o instanceof LList) { listSet(o, i, v); return; }
  if (o instanceof LPropList) {
    if (typeof i === 'number' || i instanceof LFloat) { o.v[toInt(i) - 1] = v; return; }
    plistSet(o, i, v);
    return;
  }
  if (o instanceof LPoint) { if (toInt(i) === 1) o.h = v; else o.v = v; return; }
  if (o instanceof LRect) { rectMethods.setat(o, i, v); return; }
  if (o instanceof LInstance) { o.setProp(str(i).toLowerCase(), v); return; }
  if (o && o.lgSetIndex) { o.lgSetIndex(i, v); return; }
  onWarning('cannot set index ' + repr(i) + ' of ' + repr(o));
}

const CHUNK_NAMES = new Set(['char', 'word', 'item', 'line']);

// obj.prop[i] (and obj.prop[i..j]): a chunk of a string, or an index into a property.
export function gpi(o, name, i, j) {
  if (CHUNK_NAMES.has(name)) {
    let s = o;
    if (o && typeof o === 'object' && o.lgGet && !(o instanceof LPropList) && !(o instanceof LInstance)) s = o.lgGet('text');
    if (typeof s === 'string' || s === undefined || isNum(s) || s instanceof LSymbol) return chunk(str(s), name, i, j === undefined ? 0 : j);
  }
  const p = gp(o, name);
  if (j !== undefined) return chunk(str(p), 'char', i, j);
  return gi(p, i);
}
export function spi(o, name, i, v) { si(gp(o, name), i, v); }

// obj.method(args)
export function mc(o, name, ...args) {
  if (o instanceof LInstance) {
    const h = o.findHandler(name);
    if (h) return h.fn.call(h.inst, o, ...args);
    if (name === 'count') return 0;
    if (name === 'ilk') return sym('instance');
    if (name === 'handler') return o.findHandler(str(args[0]).toLowerCase()) ? 1 : 0;
    if (name === 'setaprop' || name === 'setprop') { o.setProp(str(args[0]).toLowerCase(), args[1]); return; }
    if (name === 'getaprop' || name === 'getprop') return o.getProp(str(args[0]).toLowerCase());
    throw new LingoError('Handler not found in object: ' + name + ' (' + o.script.name + ')');
  }
  if (o instanceof LList) {
    const m = listMethods[name];
    if (m) return m(o, ...args);
    throw new LingoError('list has no method ' + name);
  }
  if (o instanceof LPropList) {
    const m = plistMethods[name];
    if (m) return m(o, ...args);
    // a property list holding a script instance or a callable: Lingo would complain.
    throw new LingoError('property list has no method ' + name);
  }
  if (o instanceof LPoint) {
    const m = pointMethods[name];
    if (m) return m(o, ...args);
  }
  if (o instanceof LRect) {
    const m = rectMethods[name];
    if (m) return m(o, ...args);
  }
  if (o && o.lgCall) return o.lgCall(name, args);
  if (typeof o === 'string') {
    if (name === 'length') return o.length;
    if (name === 'chartonum') return o.length ? o.charCodeAt(0) : 0;
    if (name === 'count') return o.length;
  }
  if (o === undefined) throw new LingoError('Object expected: ' + name + ' called on VOID');
  throw new LingoError('cannot call ' + name + ' on ' + repr(o));
}

// Calling a list method through its function form: add(list, x), count(list) ...
export function listFunction(name, args) {
  const o = args[0];
  if (o instanceof LList && listMethods[name]) return listMethods[name](o, ...args.slice(1));
  if (o instanceof LPropList && plistMethods[name]) return plistMethods[name](o, ...args.slice(1));
  if (o instanceof LPoint && pointMethods[name]) return pointMethods[name](o, ...args.slice(1));
  if (o instanceof LRect && rectMethods[name]) return rectMethods[name](o, ...args.slice(1));
  return NOT_FOUND;
}
export const NOT_FOUND = Symbol('not found');

export function ilk(x, which) {
  let k;
  if (x === undefined) k = 'void';
  else if (typeof x === 'number') k = 'integer';
  else if (x instanceof LFloat) k = 'float';
  else if (typeof x === 'string') k = 'string';
  else if (x instanceof LSymbol) k = 'symbol';
  else if (x instanceof LList) k = 'list';
  else if (x instanceof LPropList) k = 'propList';
  else if (x instanceof LPoint) k = 'point';
  else if (x instanceof LRect) k = 'rect';
  else if (x instanceof LColor) k = 'color';
  else if (x instanceof LInstance) k = 'instance';
  else if (x && x.lgIlk) k = x.lgIlk();
  else k = 'object';
  if (which !== undefined) {
    const w = str(which).toLowerCase();
    if (w === k.toLowerCase()) return 1;
    if (w === 'list') return (k === 'list' || k === 'propList' || k === 'point' || k === 'rect') ? 1 : 0;
    if (w === 'linearlist') return k === 'list' ? 1 : 0;
    if (w === 'number') return (k === 'integer' || k === 'float') ? 1 : 0;
    if (w === 'object') return (typeof x === 'object' && x !== null) ? 1 : 0;
    return 0;
  }
  return sym(k);
}

// value(): Lingo literals in a string, as the config and map files are written.
export function value(s) {
  if (typeof s !== 'string') return s;
  const p = new LiteralParser(s);
  try {
    const v = p.expr();
    p.ws();
    if (p.i < p.s.length) {
      // Director evaluates the whole string as an expression; anything beyond a
      // literal is out of scope here.
      return v;
    }
    return v;
  } catch (e) {
    return undefined;
  }
}

class LiteralParser {
  constructor(s) { this.s = s; this.i = 0; }
  ws() { while (this.i < this.s.length && isSpace(this.s[this.i])) this.i++; }
  expr() {
    let v = this.term();
    for (;;) {
      this.ws();
      const c = this.s[this.i];
      if (c === '+' || c === '-') {
        this.i++;
        const r = this.term();
        v = c === '+' ? add(v, r) : sub(v, r);
      } else return v;
    }
  }
  term() {
    let v = this.atom();
    for (;;) {
      this.ws();
      const c = this.s[this.i];
      if (c === '*' || c === '/') {
        this.i++;
        const r = this.atom();
        v = c === '*' ? mul(v, r) : div(v, r);
      } else return v;
    }
  }
  atom() {
    this.ws();
    const s = this.s;
    const c = s[this.i];
    if (c === undefined) throw new Error('end');
    if (c === '[') {
      this.i++;
      this.ws();
      if (s[this.i] === ':') { this.i++; this.ws(); this.expect(']'); return new LPropList(); }
      if (s[this.i] === ']') { this.i++; return new LList(); }
      const first = this.expr();
      this.ws();
      if (s[this.i] === ':') {
        this.i++;
        const p = new LPropList();
        p.k.push(first); p.v.push(this.expr());
        for (;;) {
          this.ws();
          if (s[this.i] === ',') {
            this.i++;
            const k = this.expr();
            this.ws(); this.expect(':');
            p.k.push(k); p.v.push(this.expr());
          } else { this.expect(']'); return p; }
        }
      }
      const l = new LList([first]);
      for (;;) {
        this.ws();
        if (s[this.i] === ',') { this.i++; l.a.push(this.expr()); } else { this.expect(']'); return l; }
      }
    }
    if (c === '"') {
      const j = s.indexOf('"', this.i + 1);
      if (j < 0) throw new Error('string');
      const v = s.slice(this.i + 1, j);
      this.i = j + 1;
      return v;
    }
    if (c === '#') {
      const m = /^#([A-Za-z_][A-Za-z0-9_]*)/.exec(s.slice(this.i));
      if (!m) throw new Error('symbol');
      this.i += m[0].length;
      return sym(m[1]);
    }
    if (c === '-') {
      this.i++;
      return neg(this.atom());
    }
    if (c === '(') {
      this.i++;
      const v = this.expr();
      this.ws(); this.expect(')');
      return v;
    }
    const m = /^(\d+\.\d*|\.\d+|\d+)/.exec(s.slice(this.i));
    if (m) {
      this.i += m[0].length;
      return m[0].includes('.') ? new LFloat(parseFloat(m[0])) : parseInt(m[0], 10);
    }
    const w = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(this.i));
    if (w) {
      this.i += w[0].length;
      const k = w[0].toLowerCase();
      if (k === 'void') return undefined;
      if (k === 'true') return 1;
      if (k === 'false') return 0;
      if (k === 'empty') return '';
      if (k === 'point' || k === 'rect' || k === 'rgb') {
        this.ws(); this.expect('(');
        const args = [];
        this.ws();
        if (s[this.i] !== ')') {
          for (;;) {
            args.push(this.expr());
            this.ws();
            if (s[this.i] === ',') { this.i++; continue; }
            break;
          }
        }
        this.expect(')');
        if (k === 'point') return new LPoint(args[0], args[1]);
        if (k === 'rect') return new LRect(args[0], args[1], args[2], args[3]);
        return new LColor(toInt(args[0]), toInt(args[1]), toInt(args[2]));
      }
      throw new Error('name');
    }
    throw new Error('unexpected ' + c);
  }
  expect(c) {
    if (this.s[this.i] !== c) throw new Error('expected ' + c);
    this.i++;
  }
}
