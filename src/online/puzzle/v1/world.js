// Rando v1, kept as it was when Rando v2 took over (src/online/puzzle.js), so that a v1
// code makes the mission it always made: not to be changed.

// The map a generated mission is built on: its layout (areas on a coarse grid, joined by
// strips of ground that need something done to them), its terrain and its items, as the
// game's map text has them.

import { CHAR, DIRS } from './model.js';

export const key = (x, y) => x + ',' + y;
export const man = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

export class Rng {
  constructor(next) { this.next = next; }
  f() { return this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  pick(list) { return list[Math.floor(this.next() * list.length)]; }
  chance(p) { return this.next() < p; }
  shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  // a choice weighted by [item, weight] pairs
  weighted(pairs) {
    const total = pairs.reduce((a, [, w]) => a + w, 0);
    let r = this.next() * total;
    for (const [v, w] of pairs) { if ((r -= w) < 0) return v; }
    return pairs[pairs.length - 1][0];
  }
}

// What each look is made of.  Walls are what nothing crosses; trees what a treebot can
// take up; rocks the obstacles that stay.
export const LOOKS = {
  A: {
    name: 'grass', slot: [1, 12], trees: ['T'], rocks: ['M'], walls: ['@', '@', '@', 'M'],
    monsters: ['crab', 'lion', 'gator', 'shark', 'water_crab'], swamp: true,
  },
  B: {
    name: 'prehistoric', slot: [5, 12], trees: ['T', '?'], rocks: ['M', '^'], walls: ['@', '@', '^', 'M'],
    monsters: ['trex', 'scorpion', 'lion', 'gator', 'crab', 'shark'], swamp: true,
  },
  C: {
    name: 'jungle', slot: [6, 12], trees: ['!', "'", '?'], rocks: ['%', '&', '$', '*'], walls: ['@', '@', '%', '&', '*'],
    monsters: ['lion', 'gator', 'crab', 'water_crab', 'shark', 'scorpion'], swamp: true,
  },
  D: {
    name: 'city', slot: [7, 12], trees: ['!', "'"], rocks: ['M', '>'], walls: ['@', '@', '@', '-'],
    monsters: ['crab', 'lion', 'shark', 'water_crab', 'gator'], swamp: false, city: true,
  },
};

// Characters impassable to every unit and monster.
export const SOLID = new Set(['@', 'M', '^', '%', '&', '$', '*', '>', '-', '~']);

// Item keys: lower-case letters (not w, x, r, t, m, which the terrain or its upper case
// uses) and digits.
const KEYS = 'abcdefghijklnopqsuvyz0123456789'.split('');

export class World {
  constructor(W, H, look) {
    this.W = W;
    this.H = H;
    this.look = look;
    this.grid = Array.from({ length: H }, () => new Array(W).fill('@'));
    this.items = [];
    this.inventory = {};
    this.areaOf = Array.from({ length: H }, () => new Array(W).fill(-1));
    this.areas = [];
    this.reserved = new Set();     // tiles kept as they are (items, stands, the routes' mouths)
    this.names = 0;
  }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  at(x, y) { return this.inside(x, y) ? this.grid[y][x] : '@'; }
  set(x, y, ch) { if (this.inside(x, y)) this.grid[y][x] = ch; }
  itemAt(x, y) { return this.items.find((it) => it.at[0] === x && it.at[1] === y); }
  name(prefix) { return prefix + (++this.names); }

  // The map text, as the game reads it (readmap, parseParams).
  text(title, center) {
    const g = this.grid.map((r) => r.slice());
    const defs = new Map();
    const lines = [];
    for (const it of this.items) {
      let def;
      switch (it.t) {
        case 'unit': def = (it.water ? 'waterunit,' : 'unit,') + it.cls + ',' + it.kind; break;
        case 'pile': def = (it.water ? 'waterpile,' : 'pile,') + Object.entries(it.bricks).map(([k, n]) => k + ',' + n).join(','); break;
        case 'plan': def = (it.water ? 'waterplan,' : 'plan,') + it.what + ',' + (it.n || 1); break;
        case 'goal': def = (it.which === 'bonus' ? 'bonusgoal,' : 'goal,') + it.want + (it.terrain === 'water' ? ',water' : ''); break;
        case 'whirl': def = 'whirlpool,' + it.id; break;
      }
      it.def = def;
    }
    // goals first, on 1, 2, ... as the game's own maps have them
    const order = this.items.filter((it) => it.t === 'goal').concat(this.items.filter((it) => it.t !== 'goal'));
    let gi = 1;
    const used = new Set();
    for (const it of order) {
      if (!defs.has(it.def)) {
        let k;
        if (it.t === 'goal') k = String(gi++);
        else k = KEYS.find((c) => !used.has(c) && !/\d/.test(c)) || KEYS.find((c) => !used.has(c));
        if (!k) throw new Error('too many kinds of item');
        used.add(k);
        defs.set(it.def, k);
        lines.push(k + '=' + it.def);
      }
      g[it.at[1]][it.at[0]] = defs.get(it.def);
    }
    for (const it of order) if (it.t === 'goal') used.add(defs.get(it.def));
    const rows = g.map((r) => r.join(''));
    const text = ['[map]', 'name=' + title, 'center=' + center.join(','), ...rows.map((r) => ' map=' + r), '',
      '[mapitems]', ...lines, '', '[inventory]', ...Object.entries(this.inventory).filter(([, n]) => n > 0).map(([k, n]) => k + '=' + n), ''];
    return { text: text.join('\r'), rows };
  }
}

// ---------- layout ----------

// A walk of n cells on a cols x rows grid: each next cell beside the last, unless the
// link to it is a whirlpool's, which may go anywhere.
export function walk(rng, n, jumps) {
  const shapes = [];
  for (let c = 1; c <= 4; c++) for (let r = 1; r <= 3; r++) {
    if (c * r < n || c * r > n + 3 || c * 9 > 44 || r * 8 > 30) continue;
    shapes.push([c, r]);
  }
  for (let tries = 0; tries < 50; tries++) {
    const [cols, rows] = rng.pick(shapes);
    const cells = [];
    const seen = new Set();
    let cur = [rng.int(0, cols - 1), rng.int(0, rows - 1)];
    cells.push(cur);
    seen.add(cur.join());
    const kinds = [];
    while (cells.length < n) {
      const jump = jumps[cells.length - 1];
      let opts = DIRS.map(([dx, dy]) => [cur[0] + dx, cur[1] + dy]).filter(([c, r]) => c >= 0 && r >= 0 && c < cols && r < rows && !seen.has(c + ',' + r));
      if (jump) {
        const far = [];
        for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) if (!seen.has(c + ',' + r) && Math.abs(c - cur[0]) + Math.abs(r - cur[1]) > 1) far.push([c, r]);
        if (far.length) opts = far;
      }
      if (!opts.length) break;
      cur = rng.pick(opts);
      cells.push(cur);
      seen.add(cur.join());
      kinds.push(jump && Math.abs(cur[0] - cells[cells.length - 2][0]) + Math.abs(cur[1] - cells[cells.length - 2][1]) > 1 ? 'jump' : 'step');
    }
    if (cells.length === n) return { cols, rows, cells, kinds };
  }
  return null;
}

// Whether a character is open ground a land unit drives on.
export function isGround(ch) { return ['normal', 'street'].includes(CHAR[ch]) || ch === ':'; }
