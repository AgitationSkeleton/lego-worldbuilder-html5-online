// A model of World Builder 2's rules, for generated missions (src/online/puzzle.js): the
// map as a mission's solution changes it, step by step, as the game's own handlers would
// (the map display manager, vehicle.generic, object.generic, resource.generic, the plan
// icon's doBuild, the producing buildings, monster.generic and the freezebot).  A step the
// game would not do throws.
//
// What it keeps: each tile's ground, its occupant (a unit, a building or a monster) and
// its resource (a pile of bricks or a plan); the plans in hand; each unit's energy and
// cargo; the goals; and a clock, in the game's 15 frames a second, for the freezes and
// the swamp.  Routes are the shortest over a unit's own ground, round the other units, as
// the game's pathfinder goes; its routes are at times a little longer, so energy is kept
// with a margin.  Where a step needs a unit beside something, the solution names the tile
// the unit stands on, and the player (or tools/verify/bot.js) drives it there first, so
// that where every unit is stays known.

export const FRAME = 1000 / 15;

// The terrainmap member, and what an item puts under itself.
export const CHAR = {
  '.': 'normal', T: 'tree', w: 'water', M: 'mountain', _: 'normal_undiggable', x: 'water_undiggable',
  r: 'water_reefs', '@': 'hole', '~': 'billboard', '#': 'swamp', '^': 'volcano', ':': 'normal',
  '`': 'street', '>': 'roadblock', '(': 'street', '[': 'street', '{': 'street', '\\': 'street', '/': 'street',
  ')': 'street', ']': 'street', '}': 'street', '+': 'street', '=': 'street', '-': 'street_undiggable',
  '!': 'tree2', "'": 'tree3', '?': 'tree4', '%': 'jungle1', '&': 'jungle2', '$': 'jungle3', '*': 'jungle4',
  // (not map characters: a whirlpool's tile, as the model keeps it)
  O: 'water_whirlpool',
};
export const TREES = new Set(['tree', 'tree2', 'tree3', 'tree4']);
const TREE_CHAR = { tree: 'T', tree2: '!', tree3: "'", tree4: '?' };
// the order the game looks round a tile in (getNeighbors, findEmptyAdjacent)
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const RESERVE = 12;          // energy no unit is planned to go below
const SLACK = 1.12;          // the game's routes, at times longer than the shortest
const FREEZE_SAFE = 18000;   // of a freeze's 25 seconds, what a plan may count on
const key = (x, y) => x + ',' + y;
const man = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);

export class StepError extends Error {}
const fail = (why) => { throw new StepError(why); };

// A pile's contents: {bricks: {kind: n} in the game's order, energy: [values]}.
function newPile(bricks, energy) {
  const b = {};
  for (const [k, n] of Object.entries(bricks)) if (n > 0) b[k] = n;
  const e = energy ? energy.slice() : new Array(b.energy || 0).fill(100);
  e.sort((p, q) => p - q);
  return { type: 'pile', bricks: b, energy: e };
}
const pileTotal = (p) => Object.values(p.bricks).reduce((a, n) => a + n, 0);

export class Model {
  // grid: rows of map characters (an item's tile holds the ground it stands on); items:
  // {t: 'unit'|'pile'|'plan'|'goal'|'whirl', at, ...} as the generator places them.
  constructor(cfg, grid, items = [], inventory = {}) {
    this.cfg = cfg;
    this.grid = grid.map((r) => (typeof r === 'string' ? r.split('') : r.slice()));
    this.H = this.grid.length;
    this.W = this.grid[0].length;
    this.occ = Array.from({ length: this.H }, () => new Array(this.W).fill(null));
    this.res = new Map();       // "x,y" -> pile or plan
    this.goals = [];            // {which, at, want, collect, terrain, done}
    this.goalTiles = new Set(); // ':' tiles and collect goals' own tiles
    this.whirl = new Map();     // "x,y" -> pair id
    this.units = {};            // name -> unit
    this.inventory = Object.assign({}, inventory);
    this.clock = 0;
    this.trail = new Set();     // every tile a unit has been on
    this.n = 0;
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) if (this.grid[y][x] === ':') this.goalTiles.add(key(x, y));
    for (const it of items) this.addItem(it);
    this.afterTerrain();
  }

  // ---------- the map ----------

  ter(x, y) {
    if (y < 0 || y >= this.H || x < 0 || x >= this.W) return null;
    return CHAR[this.grid[y][x]] || 'normal';
  }
  inside(x, y) { return y >= 0 && y < this.H && x >= 0 && x < this.W; }
  unitAt(x, y) { const n = this.inside(x, y) && this.occ[y][x]; return n ? this.units[n] : null; }
  setChar(x, y, ch) { this.grid[y][x] = ch; }

  addItem(it) {
    const [x, y] = it.at;
    switch (it.t) {
      case 'unit': {
        if (it.water) this.setChar(x, y, 'w');
        else if (this.grid[y][x] !== ':') this.setChar(x, y, '.');
        this.addUnit(it.name, it.cls, it.kind, x, y);
        return;
      }
      case 'pile':
        this.setChar(x, y, it.water ? 'w' : '.');
        this.res.set(key(x, y), newPile(it.bricks));
        return;
      case 'plan':
        this.setChar(x, y, it.water ? 'w' : '.');
        this.res.set(key(x, y), { type: 'plan', what: it.what, n: it.n || 1 });
        return;
      case 'goal': {
        this.setChar(x, y, it.terrain === 'water' ? 'w' : '.');
        const m = /^collect\s+(\d+)\s+(\w+)$/.exec(it.want);
        const g = { which: it.which, at: [x, y], want: it.want, done: false, collect: m ? { n: Number(m[1]), kind: m[2] } : null };
        if (g.collect) this.goalTiles.add(key(x, y));
        this.goals.push(g);
        return;
      }
      case 'whirl':
        this.setChar(x, y, 'O');
        this.whirl.set(key(x, y), it.id);
        return;
    }
  }

  addUnit(name, cls, kind, x, y, energy) {
    const c = this.cfg[kind];
    if (!c) fail('no such unit ' + kind);
    if (this.occ[y][x]) fail('tile taken for ' + kind);
    let e = energy;
    if (!e) e = cls === 'monster' && kind !== 'boulder' ? [100] : new Array(c.recipe.energy || 0).fill(100);
    const u = { name, cls, kind, x, y, energy: e.slice().sort((a, b) => a - b), cargo: { bricks: {}, energy: [] }, dist: 0 };
    if (cls === 'monster') { u.frozenAt = -1e9; u.pen = new Set([key(x, y)]); }
    if (kind === 'factory') u.color = 0;
    this.units[name] = u;
    this.occ[y][x] = name;
    this.trail.add(key(x, y));
    // (an object made on a plan's tile takes the plan)
    const r = this.res.get(key(x, y));
    if (r && r.type === 'plan' && cls !== 'monster') this.takePlan(x, y);
    return u;
  }
  removeUnit(u) {
    this.occ[u.y][u.x] = null;
    delete this.units[u.name];
    u.dead = true;
  }
  energyOf(u) {
    if (!u.energy.length) return null;
    return Math.round(u.energy.reduce((a, b) => a + b, 0) / u.energy.length);
  }
  useEnergy(u, n) {
    if (!n || !u.energy.length) return;
    const i = u.energy.length - 1;
    u.energy[i] = Math.max(0, u.energy[i] - n);
  }
  checkEnergy(u) {
    if (!u.energy.length) return;
    const move = this.cfg[u.kind].energy.move || 0;
    if (this.energyOf(u) - (SLACK - 1) * u.dist * move < RESERVE) fail(u.name + ' (' + u.kind + ') runs out of energy');
  }

  takePlan(x, y) {
    const r = this.res.get(key(x, y));
    this.inventory[r.what] = (this.inventory[r.what] || 0) + r.n;
    this.res.delete(key(x, y));
  }

  // ---------- monsters ----------

  // Where a monster can wander to from where it is (its ground, less swamp, round
  // everything standing): a set of tiles, or null if that is more than a small pen.
  penOf(m) {
    const c = this.cfg[m.kind];
    const ground = new Set(c.terrain.filter((t) => t !== 'swamp'));
    const seen = new Set([key(m.x, m.y)]);
    const stack = [[m.x, m.y]];
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny);
        // (it chases over swamp: a pen with swamp beside it is no pen)
        if (this.ter(nx, ny) === 'swamp') return null;
        if (seen.has(k) || !ground.has(this.ter(nx, ny))) continue;
        const o = this.unitAt(nx, ny);
        if (o && o !== m) continue;
        seen.add(k);
        stack.push([nx, ny]);
        if (seen.size > 8) return null;
      }
    }
    return seen;
  }
  monsters() { return Object.values(this.units).filter((u) => u.cls === 'monster' && u.kind !== 'boulder'); }
  // Is a monster held by a freeze, as far as a plan may count on it?
  held(m) { return this.clock - m.frozenAt <= FREEZE_SAFE; }
  places(m) {
    if (m.loose) return null;
    return [...m.pen].map((k) => k.split(',').map(Number));
  }
  // The freezebots: each freezes any monster within its range (2) wherever in its pen it
  // is; while it stays there, it freezes it again as each freeze ends.
  freezeAround() {
    for (const f of Object.values(this.units)) {
      if (f.kind !== 'freezebot' || this.energyOf(f) <= 1) continue;
      const r = this.cfg.freezebot.freezeRange || 2;
      for (const m of this.monsters()) {
        if (!this.cfg[m.kind].freezable || m.loose) continue;
        if (!this.places(m).every(([x, y]) => man(x, y, f.x, f.y) <= r)) continue;
        if (this.clock - (m.lastFreeze ?? -1e9) >= 25000) { m.lastFreeze = this.clock; this.useEnergy(f, this.cfg.freezebot.energy.freeze || 2); }
        m.frozenAt = this.clock;
      }
    }
    // a monster no longer held wanders again, in whatever pen it is in now
    for (const m of this.monsters()) {
      if (!this.held(m) && m.pen.size === 1 && !m.loose) {
        const p = this.penOf(m);
        if (p) m.pen = p; else m.loose = true;
      }
    }
  }
  // Tiles a unit must keep off: those beside where a monster that is not held can be.
  danger() {
    const d = new Set();
    for (const m of this.monsters()) {
      if (this.held(m)) continue;
      if (m.loose) return null;
      for (const [x, y] of this.places(m)) for (const [dx, dy] of DIRS) d.add(key(x + dx, y + dy));
    }
    return d;
  }
  // Tiles within 2 of a monster, which a defender or a speedboat goes after on its own.
  engageZone(except) {
    const z = new Set();
    for (const m of this.monsters()) {
      if (m === except || m.loose) continue;
      for (const [x, y] of this.places(m)) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= 2) z.add(key(x + dx, y + dy));
    }
    return z;
  }
  checkSafe() {
    const d = this.danger();
    if (!d) fail('a monster is loose');
    for (const u of Object.values(this.units)) {
      if (u.cls === 'monster') continue;
      if (d.has(key(u.x, u.y))) fail(u.name + ' (' + u.kind + ') is beside a monster');
      const att = this.cfg[u.kind].attack;
      if (att && u.kind !== 'guard_tower') {
        for (const m of this.monsters()) {
          if (att[m.kind] && this.places(m).some(([x, y]) => man(x, y, u.x, u.y) <= 2)) fail(u.name + ' would go after the ' + m.kind);
        }
      }
    }
  }
  // After the ground changes, or something is pushed: the pens as they now are.
  afterTerrain() {
    for (const m of this.monsters()) {
      if (m.loose || this.held(m)) continue;
      const p = this.penOf(m);
      if (p) m.pen = p; else m.loose = true;
    }
  }

  // ---------- routes ----------

  tileMs(u) {
    const sp = this.cfg[u.kind].speed || 1;
    return (Math.ceil(1000 / sp / FRAME) + 1) * FRAME;
  }
  canStand(kind, x, y) {
    return this.cfg[kind].terrain.includes(this.ter(x, y));
  }
  // Can unit u step on (x, y)?  opts: {target, whirl, swamp, engage}
  passable(u, x, y, opts, danger, engage) {
    const t = this.ter(x, y);
    if (!t || !this.cfg[u.kind].terrain.includes(t)) return false;
    const o = this.occ[y][x];
    if (o && o !== u.name) return false;
    const k = key(x, y);
    const target = opts.target && opts.target[0] === x && opts.target[1] === y;
    if (opts.relax) return true;
    if (t === 'water_whirlpool' && !(target && opts.whirl)) return false;
    if (t === 'swamp' && !this.swampOk(u)) return false;
    if (danger && danger.has(k) && u.kind !== 'freezebot') return false;
    if (engage && engage.has(k)) return false;
    if (!target) {
      // (a unit the goal wants is stopped on it)
      for (const g of this.goals) {
        if (g.done || g.collect || g.at[0] !== x || g.at[1] !== y) continue;
        if (g.which === 'bonus' && !this.goals.every((h) => h.which === 'bonus' || h.done)) continue;
        if (g.want === 'anything' || g.want === u.kind) return false;
      }
    }
    return true;
  }
  // Only shielded units cross swamp: it takes 50 energy (times the shield) every 0.7 s.
  swampOk(u) { return (this.cfg[u.kind].shield ?? 1) <= 0.1; }
  // The shortest route for a unit to a tile: the tiles it goes over, or null.
  path(u, tx, ty, opts = {}) {
    if (u.x === tx && u.y === ty) return [];
    const danger = u.cls === 'monster' || opts.relax ? new Set() : this.danger();
    if (!danger) fail('a monster is loose');
    const engage = this.cfg[u.kind].attack && u.kind !== 'guard_tower' && !opts.relax ? this.engageZone(opts.engage) : null;
    const o = Object.assign({}, opts, { target: [tx, ty] });
    const prev = new Map([[key(u.x, u.y), null]]);
    let frontier = [[u.x, u.y]];
    while (frontier.length) {
      const next = [];
      for (const [x, y] of frontier) {
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy, k = key(nx, ny);
          if (prev.has(k) || !this.passable(u, nx, ny, o, danger, engage)) continue;
          prev.set(k, [x, y]);
          if (nx === tx && ny === ty) {
            const p = [[nx, ny]];
            let c = [x, y];
            while (c && !(c[0] === u.x && c[1] === u.y)) { p.unshift(c); c = prev.get(key(c[0], c[1])); }
            return p;
          }
          next.push([nx, ny]);
        }
      }
      frontier = next;
    }
    return null;
  }
  // Drives a unit over a route, a tile at a time, as followPath does.
  drive(u, path) {
    const move = this.cfg[u.kind].energy.move || 0;
    let swamp = 0;
    for (const [x, y] of path) {
      if (this.cfg[u.kind].recipe.energy && this.energyOf(u) === 0) fail(u.name + ' has no energy');
      this.occ[u.y][u.x] = null;
      u.x = x; u.y = y;
      this.occ[y][x] = u.name;
      this.trail.add(key(x, y));
      this.useEnergy(u, move);
      u.dist++;
      this.clock += this.tileMs(u);
      const r = this.res.get(key(x, y));
      if (r && r.type === 'plan' && u.cls !== 'monster') this.takePlan(x, y);
      // the swamp: a hit every 0.7 s on it
      if (this.ter(x, y) === 'swamp') {
        swamp += this.tileMs(u);
        while (swamp > 700) { swamp -= 700; this.useEnergy(u, 50 * (this.cfg[u.kind].shield ?? 1)); }
      } else swamp = 0;
      this.freezeAround();
      const d = this.danger();
      if (!d) fail('a monster is loose');
      if (u.cls !== 'monster' && d.has(key(x, y))) fail(u.name + ' goes beside a monster');
      this.checkEnergy(u);
    }
    if (swamp) this.useEnergy(u, 50 * (this.cfg[u.kind].shield ?? 1));
    this.checkGoals();
  }
  goTo(u, to, opts = {}) {
    let p = this.path(u, to[0], to[1], opts);
    if (!p) fail(u.name + ' (' + u.kind + ') cannot get to ' + to);
    // (on the finished map: the game's pathfinder knows nothing of swamp's harm, of
    // whirlpools on the way, of goals or monsters; it must not find a shorter way by them)
    if (this.strict && p.length > 1) {
      let r = this.path(u, to[0], to[1], Object.assign({}, opts, { relax: true }));
      // (while the mission is made, swamp in the way of a shorter route is dried out)
      if (r && r.length < p.length && this.drySwamp && !this.swampOk(u)) {
        const wet = r.filter(([x, y]) => this.ter(x, y) === 'swamp');
        if (wet.length && this.drySwamp(wet)) {
          p = this.path(u, to[0], to[1], opts);
          r = this.path(u, to[0], to[1], Object.assign({}, opts, { relax: true }));
        }
      }
      if (r && p && r.length < p.length) fail(u.name + ' (' + u.kind + ') may go another way to ' + to);
    }
    this.drive(u, p);
  }
  dist(u, to, opts) {
    const p = this.path(u, to[0], to[1], opts);
    return p ? p.length : -1;
  }

  // ---------- goals ----------

  checkGoals() {
    const mainDone = () => this.goals.every((g) => g.which === 'bonus' || g.done);
    for (const pass of ['goal', 'bonus']) {
      if (pass === 'bonus' && !mainDone()) break;
      for (const g of this.goals) {
        if (g.which !== pass || g.done) continue;
        if (g.collect) {
          const region = this.collectRegion(g);
          let n = 0;
          for (const k of region) {
            const [x, y] = k.split(',').map(Number);
            const o = this.unitAt(x, y);
            if (o && (g.collect.kind === 'monster' || o.kind === g.collect.kind)) n++;
          }
          if (n >= g.collect.n) g.done = true;
        } else {
          const o = this.unitAt(g.at[0], g.at[1]);
          if (o && (g.want === 'anything' || o.kind === g.want)) g.done = true;
        }
      }
    }
  }
  collectRegion(g) {
    const seen = new Set([key(g.at[0], g.at[1])]);
    const stack = [g.at];
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [dx, dy] of DIRS) {
        const k = key(x + dx, y + dy);
        if (!seen.has(k) && this.goalTiles.has(k)) { seen.add(k); stack.push([x + dx, y + dy]); }
      }
    }
    return seen;
  }
  done(which) { return this.goals.filter((g) => g.which === which).every((g) => g.done); }

  // ---------- bricks ----------

  // takeBricks: a brick at a time, of the kind there are fewest of.
  takeBricks(pile, n) {
    const got = { bricks: {}, energy: [] };
    for (let i = 0; i < n; i++) {
      let least = 1e6, kind = null;
      for (const [k, v] of Object.entries(pile.bricks)) if (v < least) { least = v; kind = k; }
      if (!kind) break;
      pile.bricks[kind]--;
      if (pile.bricks[kind] <= 0) delete pile.bricks[kind];
      got.bricks[kind] = (got.bricks[kind] || 0) + 1;
      if (kind === 'energy') got.energy.push(pile.energy.pop());
    }
    return got;
  }
  giveBricks(pile, stuff) {
    for (const [k, n] of Object.entries(stuff.bricks)) pile.bricks[k] = (pile.bricks[k] || 0) + n;
    for (const e of stuff.energy) pile.energy.push(e);
  }
  createResource(x, y, bricks, energy) {
    const k = key(x, y);
    const r = this.res.get(k);
    if (r && r.type === 'plan') this.takePlan(x, y);
    const now = this.res.get(k);
    if (!now) {
      const p = newPile(bricks, energy);
      if (pileTotal(p) > 0) this.res.set(k, p);
    } else this.giveBricks(now, { bricks, energy: energy || new Array(bricks.energy || 0).fill(100) });
  }
  around(x, y) {
    const out = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      if (!i && !j) continue;
      if (this.inside(x + i, y + j)) out.push([x + i, y + j]);
    }
    out.push([x, y]);
    return out;
  }
  // checkResourcesAround
  bricksAround(x, y) {
    const have = {};
    for (const [px, py] of this.around(x, y)) {
      const r = this.res.get(key(px, py));
      if (!r || r.type !== 'pile') continue;
      for (const [k, n] of Object.entries(r.bricks)) have[k] = (have[k] || 0) + n;
    }
    return have;
  }
  enoughAround(x, y, recipe) {
    const have = this.bricksAround(x, y);
    return Object.entries(recipe).every(([k, n]) => (have[k] || 0) >= n);
  }
  // useResourcesAround: the best energy bricks first, then the piles in turn.
  useAround(x, y, recipe) {
    const piles = this.around(x, y).map(([px, py]) => [px, py, this.res.get(key(px, py))]).filter(([, , r]) => r && r.type === 'pile');
    const energy = [];
    for (let i = 0; i < (recipe.energy || 0); i++) {
      let best = null, bv = -1;
      for (const p of piles) {
        const r = p[2];
        if (r.dead || !r.energy.length) continue;
        if (r.energy[r.energy.length - 1] > bv) { bv = r.energy[r.energy.length - 1]; best = p; }
      }
      if (!best) fail('no energy brick');
      const r = best[2];
      r.bricks.energy--;
      energy.push(r.energy.pop());
      if (r.bricks.energy <= 0) delete r.bricks.energy;
      if (!pileTotal(r)) { r.dead = true; this.res.delete(key(best[0], best[1])); }
    }
    const rec = Object.assign({}, recipe);
    delete rec.energy;
    for (const [px, py, r] of piles) {
      if (r.dead) continue;
      for (const k of Object.keys(rec)) {
        const take = Math.min(rec[k], r.bricks[k] || 0);
        rec[k] -= take;
        if (take) { r.bricks[k] -= take; if (r.bricks[k] <= 0) delete r.bricks[k]; }
      }
      if (!pileTotal(r)) { r.dead = true; this.res.delete(key(px, py)); }
    }
    return energy;
  }

  // ---------- the steps ----------

  // Plays one step; throws if the game would not do it.
  play(s) {
    this.n++;
    const u = s.unit !== undefined ? this.units[s.unit] : null;
    if (s.unit !== undefined && !u) fail('no unit ' + s.unit + ' for ' + s.op);
    const c = u && this.cfg[u.kind];
    switch (s.op) {
      case 'go':
        this.goTo(u, s.to);
        break;
      case 'whirl': {
        // into a whirlpool, out of its partner
        const [x, y] = s.at;
        if (!this.whirl.has(key(x, y))) fail('no whirlpool');
        const out = [...this.whirl.entries()].find(([k, id]) => id === this.whirl.get(key(x, y)) && k !== key(x, y));
        if (!out) fail('a whirlpool with no partner');
        const [ox, oy] = out[0].split(',').map(Number);
        if (this.occ[oy][ox] || this.occ[y][x]) fail('whirlpool taken');
        this.goTo(u, s.at, { whirl: true });
        this.drive(u, [[ox, oy]]);
        if (s.out && (s.out[0] !== ox || s.out[1] !== oy)) fail('whirlpool comes out elsewhere');
        break;
      }
      case 'pick': case 'drop': case 'dig': case 'fill': case 'uproot': case 'plant': {
        const [x, y] = s.at;
        this.goTo(u, s.stand);
        const d = man(u.x, u.y, x, y);
        const r = this.res.get(key(x, y));
        const t = this.ter(x, y);
        const o = this.occ[y][x];
        const cg = u.cargo.bricks;
        const dirt = cg.dirt || cg.swamp || cg.street;
        const tree = Object.keys(cg).find((k) => TREES.has(k));
        if (s.op === 'pick') {
          if (d > 1 || Object.keys(cg).length || !r || r.type !== 'pile' || !c.carries) fail('cannot pick up at ' + s.at);
          u.cargo = this.takeBricks(r, c.carries);
          if (!pileTotal(r)) this.res.delete(key(x, y));
        } else if (s.op === 'drop') {
          if (d > 1 || !Object.keys(cg).length || !['water', 'normal', 'street'].includes(t)) fail('cannot drop at ' + s.at);
          if (r && r.type === 'plan') fail('cannot drop on a plan');
          if (!r) this.res.set(key(x, y), newPile(cg, u.cargo.energy));
          else this.giveBricks(r, u.cargo);
          u.cargo = { bricks: {}, energy: [] };
        } else if (s.op === 'dig') {
          if (!c.dig || d !== 1 || o || dirt || !['normal', 'street', 'swamp'].includes(t)) fail('cannot dig at ' + s.at);
          if (this.goalTiles.has(key(x, y)) || r) fail('will not dig there');
          u.cargo.bricks[t === 'normal' ? 'dirt' : t] = 1;
          if (t === 'street') u.streetChar = this.grid[y][x];
          this.setChar(x, y, 'w');
          this.useEnergy(u, c.energy.dig);
        } else if (s.op === 'fill') {
          if (d !== 1 || o || !dirt || t !== 'water') fail('cannot fill at ' + s.at);
          this.setChar(x, y, cg.dirt ? '.' : cg.street ? (u.streetChar || '`') : '#');
          u.cargo = { bricks: {}, energy: [] };
          this.useEnergy(u, c.energy.fill);
        } else if (s.op === 'uproot') {
          if (!c.transplant || d !== 1 || o || tree || !TREES.has(t)) fail('cannot uproot at ' + s.at);
          u.cargo.bricks[t] = 1;
          this.setChar(x, y, '.');
          this.useEnergy(u, c.energy.uproot);
        } else {
          const goalHere = this.goals.some((g) => g.at[0] === x && g.at[1] === y);
          if (d !== 1 || o || r || goalHere || !tree || t !== 'normal' || this.grid[y][x] !== '.') fail('cannot plant at ' + s.at);
          this.setChar(x, y, TREE_CHAR[tree]);
          u.cargo = { bricks: {}, energy: [] };
          this.useEnergy(u, c.energy.plant);
        }
        this.clock += 600;
        this.afterTerrain();
        this.checkEnergy(u);
        break;
      }
      case 'push': {
        // pushTowardsPos: the dozer beside the thing, pushing it on a tile
        this.goTo(u, s.stand);
        const [x, y] = s.at;
        if (!c.push || man(u.x, u.y, x, y) !== 1) fail('cannot push from there');
        if (!c.terrain.includes(this.ter(x, y))) fail('the dozer cannot go on that ground');
        const bx = 2 * x - u.x, by = 2 * y - u.y;
        const o = this.unitAt(x, y);
        const r = this.res.get(key(x, y));
        if (o) {
          const pushable = o.kind === 'boulder' || (o.cls === 'monster' && this.held(o) && o.pen.size === 1);
          if (!pushable) fail('cannot push ' + o.kind);
          if (!this.inside(bx, by) || this.occ[by][bx]) fail('no room to push into');
          const ground = o.kind === 'boulder' ? this.cfg.boulder.terrain : this.cfg[o.kind].terrain.filter((t) => t !== 'swamp');
          if (!ground.includes(this.ter(bx, by))) fail('cannot push onto that ground');
          if (o.kind === 'boulder' && this.res.has(key(bx, by))) fail('a boulder will not go onto a pile');
          if (o.kind === 'boulder' && this.whirl.has(key(bx, by))) fail('no');
          this.occ[y][x] = null;
          o.x = bx; o.y = by;
          this.occ[by][bx] = o.name;
          if (o.pen) o.pen = new Set([key(bx, by)]);
        } else if (r) {
          if (!this.inside(bx, by) || this.res.has(key(bx, by)) || !['water', 'normal', 'street'].includes(this.ter(bx, by))) fail('cannot push the pile there');
          if (r.type === 'plan') fail('will not push a plan');
          this.res.delete(key(x, y));
          this.res.set(key(bx, by), r);
        } else fail('nothing to push');
        this.useEnergy(u, c.energy.push || 0);
        this.drive(u, [[x, y]]);
        this.clock += 300;
        this.afterTerrain();
        break;
      }
      case 'build': {
        const [x, y] = s.at;
        const b = this.cfg[s.what];
        if (!b) fail('no such thing ' + s.what);
        if (!(this.inventory[s.what] > 0)) fail('no plan for ' + s.what);
        if (this.occ[y][x]) fail('the site is taken');
        if (!b.terrain.includes(this.ter(x, y))) fail(s.what + ' cannot go on ' + this.ter(x, y));
        if (!this.enoughAround(x, y, b.recipe)) fail('not enough bricks for ' + s.what);
        this.inventory[s.what]--;
        const energy = this.useAround(x, y, b.recipe);
        this.addUnit(s.as, b.cls === 'building' ? 'building' : 'vehicle', s.what, x, y, energy);
        // (a nursery plants trees on the open ground round it, in time)
        if (s.what === 'nursery') {
          for (const [dx, dy] of DIRS) {
            const nx = x + dx, ny = y + dy;
            if (this.inside(nx, ny) && this.grid[ny][nx] === '.' && !this.occ[ny][nx] && !this.res.has(key(nx, ny))) this.setChar(nx, ny, 'T');
          }
        }
        this.clock += 1000;
        this.afterTerrain();
        this.checkGoals();
        break;
      }
      case 'take': {
        // disassemble: the unit back into its bricks, on its tile
        const stuff = { bricks: Object.assign({}, c.recipe), energy: u.energy.slice() };
        for (const [k, n] of Object.entries(u.cargo.bricks)) {
          if (k === 'dirt' || k === 'swamp' || k === 'street' || TREES.has(k)) continue;
          stuff.bricks[k] = (stuff.bricks[k] || 0) + n;
        }
        stuff.energy.push(...u.cargo.energy);
        this.removeUnit(u);
        this.createResource(u.x, u.y, stuff.bricks, stuff.energy);
        this.clock += 500;
        this.afterTerrain();
        break;
      }
      case 'color': {
        if (u.kind !== 'factory') fail('only a factory changes colour');
        u.color = (u.color + (s.times || 1)) % 5;
        break;
      }
      case 'wait': {
        // a building making things: the factory turns what is beside it into bricks of its
        // colour; the windmill and garage make energy bricks and wheels beside them
        if (u.kind === 'factory') {
          let made = 0;
          for (const [dx, dy] of DIRS) {
            const nx = u.x + dx, ny = u.y + dy;
            const o = this.unitAt(nx, ny);
            const tree = TREES.has(this.ter(nx, ny));
            if (!(o && o.kind === 'boulder') && !tree) continue;
            if (o) this.removeUnit(o);
            else this.setChar(nx, ny, '.');
            this.createResource(nx, ny, { [['red', 'yellow', 'green', 'blue', 'white'][u.color]]: c.makeHowManyBricks || 25 }, []);
            this.useEnergy(u, c.energy.make);
            made++;
            this.clock += 2200;
          }
          if (!made) fail('the factory has nothing to make bricks of');
          if (this.energyOf(u) <= 0) fail('the factory ran out');
        } else if (u.kind === 'windmill' || u.kind === 'garage') {
          const kind = u.kind === 'windmill' ? 'energy' : 'wheel';
          const free = [];
          for (const [dx, dy] of DIRS) {
            const nx = u.x + dx, ny = u.y + dy;
            if (!this.inside(nx, ny)) continue;
            const r = this.res.get(key(nx, ny));
            if (r && r.type === 'pile' && r.bricks[kind]) fail('there is one already');
            if (!this.occ[ny][nx] && !r && this.ter(nx, ny) === 'normal') free.push([nx, ny]);
          }
          if (free.length !== 1 || (s.at && (free[0][0] !== s.at[0] || free[0][1] !== s.at[1]))) fail('it would make it somewhere else');
          this.createResource(free[0][0], free[0][1], { [kind]: c.makeHowManyBricks || 1 }, null);
          this.useEnergy(u, c.energy.make);
          this.clock += 2200;
        } else fail('nothing to wait for');
        this.afterTerrain();
        break;
      }
      case 'recharge': {
        // beside a building (or a repairbot) that recharges it, until it is full
        this.goTo(u, s.stand);
        const b = this.units[s.from];
        if (!b || man(b.x, b.y, u.x, u.y) !== 1 || !(this.cfg[b.kind].recharges || []).includes(u.kind)) fail('cannot recharge there');
        u.energy = u.energy.map(() => 100);
        u.dist = 0;
        this.clock += 3000;
        break;
      }
      case 'attack': {
        // a defender beside a frozen monster, until it falls apart into its bricks
        const m = this.units[s.target];
        if (!m || m.cls !== 'monster') fail('nothing to attack');
        if (!this.held(m) || m.pen.size !== 1) fail('the monster is not held');
        this.goTo(u, s.stand, { engage: m });
        if (man(u.x, u.y, m.x, m.y) !== 1) fail('not beside it');
        if (!(c.attack || {})[m.kind]) fail(u.kind + ' does not attack ' + m.kind);
        // (held all the while: a freezebot stays in reach)
        this.clock += 1000;
        this.freezeAround();
        if (!this.held(m)) fail('the monster thaws');
        const fz = Object.values(this.units).find((f) => f.kind === 'freezebot' && man(f.x, f.y, m.x, m.y) <= 2);
        if (!fz) fail('no freezebot holds it');
        this.removeUnit(m);
        this.createResource(m.x, m.y, Object.assign({}, this.cfg[m.kind].recipe), [100]);
        this.clock += 30000;
        break;
      }
      default:
        fail('no such step ' + s.op);
    }
    this.freezeAround();
    this.checkSafe();
    this.checkGoals();
  }
}
