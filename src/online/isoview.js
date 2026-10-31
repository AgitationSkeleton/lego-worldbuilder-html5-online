// A level (src/online/levelformat.js) drawn as the game draws its map: each tile's ground the
// game's own terrain member, where the map display's postoloc puts it (a tile 50 pixels on in
// its row, each row 50 down and half a tile left), in its order (postolocz); and on the tiles,
// each thing with the sprites the game gives it as a mission starts (src/online/isosprites.js,
// read from the game by tools/verify/isosprites.py), a pile of bricks as the game's
// setupPileSprites works it out.  The sprites are drawn by the game's renderer, inks and all.
//
// For the level editor (src/online/editor.js): the picture, at the game's own size, and which
// tile is under a place on it, as the game finds the tile clicked (the tile sprites' own shapes,
// the nearer drawn over the farther).

import { TERRAIN } from './levelformat.js';
import { SPRITES, GROUND } from './isosprites.js';

const TILE = 50, SKEW = 25;
const ORDINARY = ['red', 'green', 'blue', 'yellow', 'white'];
const COUNTS = [[1, 1], [2, 2], [6, 3], [13, 4]];
const PILE_AT = [[22, 7], [17, 18], [12, 28], [6, 39]];

// A pile's sprites (the game's setupPileSprites and placeSprites): the colours most of first, four
// at most; an ordinary colour's picture by how many, energy's by its charge (full, as a mission
// starts); on water, 8 pixels lower.
export function pileSprites(bricks, energyCount, terrain) {
  const low = String(terrain || '').includes('water') ? 8 : 0;
  const cont = [];
  for (const [k, n] of Object.entries(bricks)) if (n > 0) cont.push([-n, k]);
  // (Lingo's sort of [count, symbol] lists: by the count, then by the symbol's name)
  cont.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const out = [];
  for (let i = 0; i < Math.min(4, cont.length); i++) {
    const [neg, kind] = cont[i];
    let m;
    if (ORDINARY.includes(kind)) {
      let num = 1;
      for (const [at, v] of COUNTS) if (-neg >= at) num = v;
      m = 'resource.' + kind + '.' + num;
    } else if (kind === 'energy') m = energyCount === 0 ? 'resource.energy_dead' : 'resource.energy';
    else m = 'resource.' + kind;
    out.push({ m, dx: PILE_AT[i][0], dy: PILE_AT[i][1] + low, dz: i + 1, ink: 8, blend: 100 });
  }
  return out;
}

// The sprites of an item of a level (levelformat's), on a tile of this ground.
export function itemSprites(it, terrain) {
  let key;
  if (it.t === 'unit') key = it.cls + ':' + it.kind;
  else if (it.t === 'pile') return pileSprites(it.bricks, it.bricks.energy ? 1 : 0, terrain);
  else if (it.t === 'plan') key = 'plan:generic';
  else if (it.t === 'goal') key = 'goal:goal';
  else if (it.t === 'bonus') key = 'goal:bonus';
  else if (it.t === 'whirl') key = 'whirlpool:generic';
  // (the bonus goal is hidden until the goal is reached: here, as the goal is drawn)
  const list = SPRITES[key] && SPRITES[key].length ? SPRITES[key]
    : key === 'goal:bonus' && SPRITES['goal:goal'] ? SPRITES['goal:goal'].map((s) => (s.m === 'goal.goal' ? Object.assign({}, s, { m: 'goal.bonus' }) : s)) : null;
  if (!list) return null;
  return list.map((s) => (s.m.includes('{terrain}') ? Object.assign({}, s, { m: s.m.replace('{terrain}', terrain) }) : s));
}

// The ground's member for a terrain character: the yellow goal ground as it is once its goal
// is open (as the editor wants it seen), the rest as the map display has them.
export function groundMember(ch) {
  const t = TERRAIN[ch];
  return 'terrain.' + (t || 'normal');
}

export class IsoView {
  constructor(rt) {
    this.rt = rt;
    this.masks = new Map();
  }
  member(name) {
    const m = this.rt.builtins.member(name);
    return m && m.width > 0 && m.height > 0 ? m : null;
  }
  // A tile's place (its ground sprite's loc) on the picture, before the picture's margin.
  loc(x, y, H) {
    return [x * TILE + SKEW * (H - 1 - y), y * TILE];
  }
  // The level's sprites, in the game's order: [{member, left, top, ..., tile: [x, y] | null}].
  sprites(grid, items) {
    const H = grid.length, W = grid[0].length;
    const list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const [lx, ly] = this.loc(x, y, H);
      const z = 5 * (x + 1 + W * (y + 1));
      const ch = grid[y][x];
      // (a hole is no block at all, the sky seen through it: clicked as a tile all the same)
      const hole = TERRAIN[ch] === 'hole';
      const gm = (!hole && this.member(groundMember(ch))) || this.member('terrain.normal');
      if (gm) list.push({ unseen: hole, member: gm, ink: GROUND.ink, blend: GROUND.blend, left: lx - gm.regX, top: ly - gm.regY, width: gm.width, height: gm.height, locZ: z, order: list.length, tile: [x, y], lx, ly });
      const it = items.get(x + ',' + y);
      if (!it) continue;
      const ss = itemSprites(it, TERRAIN[ch] === 'goal' ? 'normal' : TERRAIN[ch]) || [];
      for (const s of ss) {
        const m = this.member(s.m);
        if (!m) continue;
        list.push({ member: m, ink: s.ink, blend: s.blend, left: lx + s.dx - m.regX, top: ly + s.dy - m.regY, width: m.width, height: m.height, locZ: z + s.dz, order: list.length, tile: null });
      }
    }
    list.sort((a, b) => a.locZ - b.locZ || a.order - b.order);
    return list;
  }
  // The picture: {canvas, x0, y0} (x0, y0: where the picture's corner is in tile places), and the
  // tiles' map for finding one (hit).
  render(grid, items) {
    const list = this.sprites(grid, items);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of list) { x0 = Math.min(x0, s.left); y0 = Math.min(y0, s.top); x1 = Math.max(x1, s.left + s.width); y1 = Math.max(y1, s.top + s.height); }
    x0 = Math.floor(x0) - 8; y0 = Math.floor(y0) - 8; x1 = Math.ceil(x1) + 8; y1 = Math.ceil(y1) + 8;
    const c = this.canvas || (this.canvas = document.createElement('canvas'));
    c.width = x1 - x0;
    c.height = y1 - y0;
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, -x0, -y0);
    g.imageSmoothingEnabled = false;
    const r = this.rt.renderer;
    for (const s of list) {
      if (s.unseen) continue;
      try { r.drawSprite(g, Object.assign({ foreColor: 255, backColor: 0 }, s)); } catch (e) { /* (a picture not to be had) */ }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    const W = grid[0].length;
    // (each tile's ground sprite, by its tile: for finding the tile at a place)
    this.ground = new Array(W * grid.length);
    for (const sp of list) if (sp.tile) this.ground[sp.tile[1] * W + sp.tile[0]] = sp;
    this.W = W;
    this.H = grid.length;
    this.x0 = x0;
    this.y0 = y0;
    this.list = list;
    return { canvas: c, x0, y0 };
  }
  // (a ground member's shape: where its picture is, its white keyed out as the game's ink does)
  mask(m) {
    let k = this.masks.get(m);
    if (k) return k;
    k = document.createElement('canvas');
    k.width = m.width; k.height = m.height;
    try { this.rt.renderer.drawSprite(k.getContext('2d'), { member: m, ink: GROUND.ink, blend: 100, foreColor: 255, backColor: 0, left: 0, top: 0, width: m.width, height: m.height }); } catch (e) { /* none */ }
    this.masks.set(m, k);
    return k;
  }
  // (a ground member's shape, as alpha: is the place within its picture)
  solid(m, x, y) {
    this.alphas = this.alphas || new Map();
    let a = this.alphas.get(m);
    if (!a) {
      const k = this.mask(m);
      try { a = k.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, k.width, k.height).data; } catch (e) { a = new Uint8ClampedArray(k.width * k.height * 4).fill(255); }
      this.alphas.set(m, a);
    }
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) return false;
    return a[(y * m.width + x) * 4 + 3] >= 128;
  }
  // The tile at a place on the picture (its pixels), or null: the nearest ground drawn there
  // (drawn later: lower rows, then further right), as a click finds the game's tile sprites.
  tileAt(px, py) {
    if (!this.ground) return null;
    const X = px + this.x0, Y = py + this.y0;
    const [ex, ey] = this.estimate(X, Y);
    for (let y = Math.min(this.H - 1, ey + 3); y >= Math.max(0, ey - 3); y--) {
      for (let x = Math.min(this.W - 1, ex + 4); x >= Math.max(0, ex - 4); x--) {
        const sp = this.ground[y * this.W + x];
        if (sp && this.solid(sp.member, X - sp.left, Y - sp.top)) return [x, y];
      }
    }
    return null;
  }
  // (the tile a place on the picture is about, by the projection alone: off the map too)
  estimate(X, Y) {
    const m = this.ground && this.ground[0] ? this.ground[0].member : null;
    const cx = m ? m.width / 2 - m.regX : TILE / 2, cy = m ? m.height / 2 - m.regY : TILE / 2;
    const y = Math.round((Y - cy) / TILE);
    const x = Math.round((X - cx - SKEW * (this.H - 1 - y)) / TILE);
    return [x, y];
  }
  nearest(px, py) {
    return this.estimate(px + this.x0, py + this.y0);
  }
  // The middle of a tile's ground as a click finds it, on the picture (its pixels).
  middle(x, y) {
    const sp = this.ground && this.ground[y * this.W + x];
    if (!sp) return [0, 0];
    let sx = 0, sy = 0, n = 0;
    for (let yy = 0; yy < sp.height; yy += 2) for (let xx = 0; xx < sp.width; xx += 2) {
      const t = this.tileAt(sp.left - this.x0 + xx, sp.top - this.y0 + yy);
      if (t && t[0] === x && t[1] === y) { sx += xx; sy += yy; n++; }
    }
    return n ? [sp.left - this.x0 + sx / n, sp.top - this.y0 + sy / n] : [sp.left - this.x0 + sp.width / 2, sp.top - this.y0 + sp.height / 2];
  }
  // A tile's top, as it is seen with tiles all round it (the plain ground's picture, less what the
  // nearer tiles draw over it): {canvas, dx, dy} from the tile's place.
  face() {
    if (this.faceMask) return this.faceMask;
    const m = this.member('terrain.normal');
    if (!m) return null;
    const c = document.createElement('canvas');
    c.width = m.width; c.height = m.height;
    const g = c.getContext('2d');
    g.drawImage(this.mask(m), 0, 0);
    g.globalCompositeOperation = 'destination-out';
    // (the tiles drawn after it: on its right in its row, and the row below)
    for (const [dx, dy] of [[1, 0], [2, 0], [-2, 1], [-1, 1], [0, 1], [1, 1], [-2, 2], [-1, 2], [0, 2], [1, 2]]) {
      g.drawImage(this.mask(m), dx * TILE - dy * SKEW, dy * TILE);
    }
    return (this.faceMask = { canvas: c, dx: -m.regX, dy: -m.regY });
  }
  // A tile's ground sprite on the picture, for marking it: {member, left, top, ...} or null.
  groundOf(x, y) {
    return this.ground && x >= 0 && y >= 0 && x < this.W && y < this.H ? this.ground[y * this.W + x] : null;
  }
}
