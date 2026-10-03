// The generator: a mission's layout, the puzzles on its way, its goal and bonus goal, and
// the solution to all of them, each step played on a live model of the rules as it is
// written (src/online/puzzle/model.js).
//
// A mission is a chain of areas.  Each link between two areas is one of the game's
// obstacles, with what gets past it:
//   rock      rocky ground only a dirtbuggy, dumptruck or repairbot drives on
//   fill      water a steamshovel fills with ground it digs elsewhere
//   trees     trees a treebot takes up and plants elsewhere
//   boulders  a few boulders in a narrow place, pushed out of the way by a bulldozer
//             (a small pushing puzzle, solved here by search)
//   factory   one tree or boulder in a gap, which a factory built beside it turns into
//             bricks for what is built next
//   ferry     a river: a tugboat or freighter carries bricks over to the far bank
//   whirl     two ponds far apart joined by a pair of whirlpools, which a boat goes through
//   swim      water a duck or a frog swims over to fetch a plan
//   swamp     a wide swamp only a defender's shield gets it through
//   guard     a narrow way past a monster in its den: a freezebot kept within its reach
//             holds it frozen while the others go by
// What a unit is built from is found in different ways: bricks already by its site, bricks
// to be fetched, a windmill or garage that makes the energy bricks or wheels that are
// short, a unit taken apart for its bricks, a monster taken apart by a defender.  Plans
// are in hand or lie on the map to be fetched.  The goal is a unit brought to a place, a
// building built on it, a monster frozen and pushed into a pen, or a boulder pushed onto
// it; the bonus goal is another of those.

import { Model, StepError, DIRS, CHAR, TREES } from './model.js';
import { World, LOOKS, SOLID, walk, key, man } from './world.js';

const CARRIERS = ['forklift', 'forklift', 'buggy', 'dirtbuggy', 'dumptruck'];
const ROCK_CROSSERS = ['dirtbuggy', 'dumptruck', 'repairbot'];
const BOATS = ['tugboat', 'freighter'];
const SWIMMERS = ['duck', 'frog'];
const GOAL_BUILDINGS = ['house', 'gas_station', 'robot_lab', 'guard_tower', 'factory', 'windmill', 'garage', 'nursery'];
const COLORS = ['red', 'yellow', 'green', 'blue', 'white'];

// How thick each link's strip is, at least and at most.
const THICK = {
  rock: [2, 3], fill: [1, 2], trees: [1, 2], boulders: [3, 4], factory: [1, 2], ferry: [2, 4],
  swim: [2, 4], swamp: [4, 5], guard: [3, 3], whirl: [1, 2], wall: [1, 2],
};

export class Fail extends Error {}
const no = (why) => { throw new Fail(why); };

export class Gen {
  constructor(cfg, c, rng) {
    this.cfg = cfg;
    this.c = c;
    this.d = c.difficulty;
    this.rng = rng;
    this.look = LOOKS[c.look];
    this.steps = [];
    this.bonusSteps = [];
    this.into = this.steps;
    this.tags = new Set();     // what the mission has, for the variety report
    this.spent = new Set();    // units the solution is done with
  }

  // ---------- playing steps on the live model ----------

  play(s) {
    try {
      this.model.play(s);
    } catch (e) {
      if (e instanceof StepError) no(e.message);
      throw e;
    }
    this.into.push(s);
    for (const p of [s.to, s.stand, s.at]) if (p) this.keep(p);
    if (s.op === 'build') for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) this.touched.add(key(s.at[0] + dx, s.at[1] + dy));
    if (['pick', 'drop', 'push', 'dig', 'fill', 'uproot', 'plant'].includes(s.op)) this.touched.add(key(...s.at));
    if (s.op === 'wait') for (const p of s.made || [s.at]) if (p) this.touched.add(key(...p));
    const u = s.unit !== undefined && this.model.units[s.unit];
    if (u) this.keep([u.x, u.y]);
  }
  unit(name) { return this.model.units[name]; }
  keep(p) { this.keeps.add(key(p[0], p[1])); }

  // The tile a unit stands on to act on another: beside it, the nearest it can get to.
  standFor(name, at, opts = {}) {
    const u = this.unit(name);
    if (!u) no('no unit ' + name);
    if (man([u.x, u.y], at) === 1 && !opts.not?.has(key(u.x, u.y))) return [u.x, u.y];
    let best = null, bd = 1e9;
    for (const [dx, dy] of DIRS) {
      const p = [at[0] + dx, at[1] + dy];
      if (opts.not && opts.not.has(key(p[0], p[1]))) continue;
      if (this.world.areaOf[p[1]]?.[p[0]] === undefined) continue;
      const d = this.model.dist(u, p, opts);
      if (d >= 0 && d < bd) { bd = d; best = p; }
    }
    if (!best) no(name + ' cannot get beside ' + at);
    return best;
  }
  go(name, to) { this.play({ op: 'go', unit: name, to }); }
  act(op, name, at, opts) { this.play({ op, unit: name, at, stand: this.standFor(name, at, opts) }); }
  // Hauls a pile to a tile, a load at a time.
  haul(name, from, to) {
    for (let trip = 0; trip < 12; trip++) {
      if (!this.model.res.get(key(from[0], from[1]))) return;
      this.act('pick', name, from);
      this.act('drop', name, to);
    }
    no('too many trips');
  }

  // ---------- the map ----------

  areaTiles(a) { return [...this.areas[a].tiles].map((k) => k.split(',').map(Number)); }
  // A free tile of open ground: not reserved, nothing on it, nothing reserved beside it.
  isFree(x, y, spacing = 1) {
    const w = this.world;
    if (w.at(x, y) !== '.' || this.reserved.has(key(x, y))) return false;
    if (this.model.occ[y][x] || this.model.res.has(key(x, y)) || this.model.goals.some((g) => g.at[0] === x && g.at[1] === y)) return false;
    if (this.touched.has(key(x, y)) || this.model.trail.has(key(x, y)) || this.world.itemAt(x, y)) return false;
    for (let dy = -spacing; dy <= spacing; dy++) for (let dx = -spacing; dx <= spacing; dx++) {
      if ((dx || dy) && this.reserved.has(key(x + dx, y + dy))) return false;
    }
    return true;
  }
  reserve(p) { this.reserved.add(key(p[0], p[1])); this.keep(p); }
  // A free tile of an area: anywhere, or within `within` of a point, or at least `min`
  // from it; `edge` for one by the area's edge, `test` for any other condition.
  spot(a, o = {}) {
    const cands = this.areaTiles(a).filter(([x, y]) => {
      if (!this.isFree(x, y, o.spacing ?? 1)) return false;
      if (o.near && man([x, y], o.near) > (o.within ?? 4)) return false;
      if (o.near && o.min && man([x, y], o.near) < o.min) return false;
      if (o.edge && !DIRS.some(([dx, dy]) => this.areas[a].tiles.has(key(x + dx, y + dy)) === false)) return false;
      if (o.inner && DIRS.some(([dx, dy]) => !this.areas[a].tiles.has(key(x + dx, y + dy)))) return false;
      if (o.test && !o.test(x, y)) return false;
      return true;
    });
    if (!cands.length) no('no room in area ' + a);
    const p = this.rng.pick(cands);
    if (!o.noReserve) this.reserve(p);
    return p;
  }
  // Puts an item on the map, in the world and the live model alike.
  add(it) {
    if (it.t === 'unit' && !it.name) it.name = this.world.name(it.cls === 'monster' ? 'm' : it.cls === 'building' ? 'b' : 'u');
    const k = key(it.at[0], it.at[1]);
    if (this.world.itemAt(it.at[0], it.at[1])) no('two things on one tile');
    if ((it.t === 'pile' || it.t === 'plan') && this.touched.has(k)) no('a tile used before');
    if (it.t === 'unit' && this.model.trail.has(k)) no('a tile gone over before');
    this.world.items.push(it);
    this.model.addItem(it);
    if (it.t === 'unit' && it.cls === 'monster') this.model.afterTerrain();
    this.reserve(it.at);
    return it;
  }
  setGround(x, y, ch) {
    if (this.model && this.model.trail.has(key(x, y)) && !['.', ':'].includes(ch)) no('ground gone over before');
    this.world.set(x, y, ch);
    if (this.model) this.model.setChar(x, y, ch);
  }

  // ---------- units ----------

  // Living units of a kind, nearest to a tile first.
  unitsOf(kind, near) {
    const out = Object.values(this.model.units).filter((u) => u.kind === kind && !this.spent.has(u.name) && !this.posted.has(u.name));
    if (near) out.sort((a, b) => man([a.x, a.y], near) - man([b.x, b.y], near));
    return out;
  }
  // A unit of one of these kinds that can get to a tile, if there is one.
  have(kinds, to) {
    for (const k of kinds) for (const u of this.unitsOf(k, to)) {
      if (this.model.dist(u, to) >= 0 || (u.x === to[0] && u.y === to[1])) return u.name;
      // (or beside it)
      for (const [dx, dy] of DIRS) if (this.model.dist(u, [to[0] + dx, to[1] + dy]) >= 0) return u.name;
    }
    return null;
  }
  carrierFor(at, loads) {
    for (const u of Object.values(this.model.units)) {
      if (this.spent.has(u.name) || this.posted.has(u.name) || !this.cfg[u.kind].carries || u.cls !== 'vehicle') continue;
      if (this.cfg[u.kind].carries < (loads || 1)) continue;
      const near = DIRS.some(([dx, dy]) => this.model.dist(u, [at[0] + dx, at[1] + dy]) >= 0 || man([u.x, u.y], [at[0] + dx, at[1] + dy]) === 0);
      if (near) return u.name;
    }
    return null;
  }

  // A plan for a thing: in hand, or lying in an area for a unit to fetch.
  plan(what, a, mayFetch = true) {
    if (this.model.inventory[what] > 0) return;
    const fetchers = Object.values(this.model.units).filter((u) => u.cls === 'vehicle' && !this.spent.has(u.name) && !this.posted.has(u.name));
    if (mayFetch && fetchers.length && this.rng.chance(0.25 + 0.15 * this.d)) {
      for (let t = 0; t < 4; t++) {
        let at;
        try { at = this.spot(a, { noReserve: true }); } catch (e) { break; }
        const u = fetchers.find((f) => this.model.dist(f, at) > 0 && this.model.dist(f, at) < 20);
        if (!u) continue;
        this.reserve(at);
        this.add({ t: 'plan', at, what, n: 1 });
        this.go(u.name, at);
        this.tags.add('fetch plan');
        return;
      }
    }
    this.world.inventory[what] = (this.world.inventory[what] || 0) + 1;
    this.model.inventory[what] = (this.model.inventory[what] || 0) + 1;
  }

  // Builds a unit or building at a site, its bricks found one way or another.
  make(what, a, site, opts = {}) {
    const recipe = this.cfg[what].recipe;
    this.plan(what, a, opts.fetchPlan !== false);
    this.supply(a, site, recipe, opts);
    const as = opts.as || this.world.name(this.cfg[what].cls === 'building' ? 'b' : 'u');
    this.play({ op: 'build', what, at: site, as });
    this.tags.add('build ' + what);
    return as;
  }

  // A unit of one of these kinds where it is needed: one already there, or one made.
  need(kinds, a, near, opts = {}) {
    const have = opts.fresh ? null : this.have(kinds, near);
    if (have) return have;
    const what = this.rng.pick(kinds);
    const water = this.cfg[what].terrain.includes('water') && !this.cfg[what].terrain.includes('normal');
    let site = opts.site;
    if (!site && this.hint && this.hint.area === a) {
      try { site = this.spot(a, { near: this.hint.at, within: 2, spacing: 0, test: (x, y) => this.roomAround(x, y) >= 3 && this.model.dist(this.firstUnit(), [x, y]) !== -2 }); } catch (e) { site = null; }
      if (site) this.tags.add('use the factory bricks');
    }
    if (!site) site = this.spot(a, { near, within: opts.within ?? 6, test: (x, y) => this.roomAround(x, y) >= 4 && !water });
    return this.make(what, a, site, opts);
  }
  firstUnit() { return Object.values(this.model.units)[0]; }
  roomAround(x, y) {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && this.isFree(x + dx, y + dy, 0)) n++;
    return n;
  }

  // ---------- bricks ----------

  // Gets a recipe's bricks within a tile of a site: some by it already, the rest from a
  // pile elsewhere, a windmill or garage, or a unit taken apart.
  supply(a, site, recipe, opts = {}) {
    const need = {};
    const there = this.model.bricksAround(site[0], site[1]);
    for (const [k, n] of Object.entries(recipe)) if (n - (there[k] || 0) > 0) need[k] = n - (there[k] || 0);
    if (!Object.keys(need).length) return;
    // what is short, and where it comes from
    let missing = {};
    const ways = [];
    if (!opts.full && (opts.partial || this.rng.chance(0.35 + 0.15 * this.d))) {
      const kinds = Object.keys(need);
      const carrier = this.carrierFor(site);
      if (need.energy && carrier && this.rng.chance(0.5)) ways.push('loose');
      if (need.wheel && need.wheel <= 4 && this.rng.chance(0.4)) ways.push('garage');
      if (need.energy && this.rng.chance(0.3 + 0.1 * this.d)) ways.push('windmill');
      if (this.recyclable(site, need)) ways.push('recycle');
      if (carrier) ways.push('loose');
      if (ways.length) {
        const way = this.rng.pick(ways);
        if (way === 'loose') {
          const take = this.rng.shuffle(kinds).slice(0, this.rng.int(1, Math.min(2, kinds.length)));
          for (const k of take) missing[k] = k === 'energy' ? need[k] : Math.max(1, Math.round(need[k] * (0.3 + 0.5 * this.rng.f())));
        } else if (way === 'garage') missing = { wheel: need.wheel };
        else if (way === 'windmill') missing = { energy: need.energy };
        else if (way === 'recycle') missing = this.recyclable(site, need).gives;
        opts.way = way;
      }
    }
    // the bricks by the site: in one to three piles, within a tile of it
    const by = {};
    for (const [k, n] of Object.entries(need)) if (n - (missing[k] || 0) > 0) by[k] = n - (missing[k] || 0);
    if (Object.keys(by).length) this.kit(site, by);
    if (opts.way === 'loose') this.fromLoose(a, site, missing);
    else if (opts.way === 'garage') this.fromProducer(a, site, 'garage');
    else if (opts.way === 'windmill') this.fromProducer(a, site, 'windmill');
    else if (opts.way === 'recycle') this.fromRecycle(site, missing);
  }

  // Piles round a site holding these bricks.
  kit(site, bricks) {
    const tiles = [];
    const [sx, sy] = site;
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const x = sx + dx, y = sy + dy;
      if (this.world.areaOf[y]?.[x] === undefined || this.world.areaOf[y][x] < 0) continue;
      if (this.model.grid[y][x] !== '.') continue;
      if (this.model.occ[y][x] || this.model.res.has(key(x, y)) || this.touched.has(key(x, y)) || this.world.itemAt(x, y)) continue;
      if (this.reserved.has(key(x, y)) && !(dx === 0 && dy === 0)) continue;
      tiles.push([x, y]);
    }
    if (!tiles.length) no('no room for bricks');
    const kinds = Object.keys(bricks);
    const n = Math.min(tiles.length, this.rng.int(1, Math.min(3, kinds.length + 1)));
    const piles = Array.from({ length: n }, () => ({}));
    let i = this.rng.int(0, n - 1);
    for (const k of this.rng.shuffle(kinds)) {
      let left = bricks[k];
      // (a kind in one pile, or split in two)
      if (left > 8 && n > 1 && this.rng.chance(0.3)) {
        const half = Math.floor(left / 2);
        piles[i][k] = half; left -= half; i = (i + 1) % n;
      }
      piles[i][k] = (piles[i][k] || 0) + left;
      i = (i + 1) % n;
    }
    const spots = this.rng.shuffle(tiles);
    piles.forEach((p, j) => {
      if (!Object.keys(p).length) return;
      const at = spots[j];
      this.add({ t: 'pile', at, bricks: p });
    });
  }

  // The missing bricks in a pile elsewhere in the area, fetched by a carrier.
  fromLoose(a, site, bricks) {
    const total = Object.values(bricks).reduce((x, y) => x + y, 0);
    const carrier = this.carrierFor(site);
    if (!carrier) no('nothing to carry');
    const u = this.unit(carrier);
    const cap = this.cfg[u.kind].carries;
    const trips = Math.ceil(total / cap);
    const far = trips > 3 ? 5 : 9;
    const at = this.spot(a, { near: site, within: far, min: 3, test: (x, y) => this.model.dist(u, [x, y]) > 0 || DIRS.some(([dx, dy]) => this.model.dist(u, [x + dx, y + dy]) >= 0) });
    this.add({ t: 'pile', at, bricks });
    this.haul(carrier, at, site);
    this.tags.add('haul');
  }

  // A windmill or garage, built from a kit of its own, where its one free side is by the
  // site: it makes the energy bricks or wheels the site is short of.
  fromProducer(a, site, what) {
    const [sx, sy] = site;
    // its own site: two tiles from the site, its one free side between them
    for (const [dx, dy] of this.rng.shuffle(DIRS)) {
      const n = [sx + dx, sy + dy];          // where it makes them
      const b = [sx + 2 * dx, sy + 2 * dy];  // the building
      if (!this.isFree(n[0], n[1], 0) || !this.isFree(b[0], b[1], 0)) continue;
      if (this.world.areaOf[b[1]][b[0]] !== a || this.world.areaOf[n[1]][n[0]] !== a) continue;
      // its other sides closed: rocks where there is open ground
      const sides = DIRS.map(([ex, ey]) => [b[0] + ex, b[1] + ey]).filter(([x, y]) => x !== n[0] || y !== n[1]);
      if (sides.some(([x, y]) => this.reserved.has(key(x, y)) || this.model.occ[y]?.[x] || this.model.res.has(key(x, y)))) continue;
      const rock = this.rng.pick(this.look.rocks.concat(this.look.trees));
      const changed = [];
      for (const [x, y] of sides) if (CHAR[this.model.grid[y][x]] === 'normal') { changed.push([x, y, this.model.grid[y][x]]); this.setGround(x, y, rock); }
      // the bricks for it: round its site, but not on its free side
      this.reserve(n);
      this.reserve(b);
      try {
        const kitAt = this.buildingKitTiles(b, n);
        if (!kitAt.length) no('no room');
        const recipe = this.cfg[what].recipe;
        this.plan(what, a, false);
        const bricks = Object.assign({}, recipe);
        this.add({ t: 'pile', at: kitAt[0], bricks });
        const name = this.world.name('b');
        this.play({ op: 'build', what, at: b, as: name });
        this.play({ op: 'wait', unit: name, at: n });
        this.tags.add('build ' + what);
        this.tags.add(what + ' makes');
        return;
      } catch (e) {
        for (const [x, y, ch] of changed) this.setGround(x, y, ch);
        throw e;
      }
    }
    no('no room for a ' + what);
  }
  // Tiles within a tile of a building's site for its bricks, off its sides (a pile beside
  // a windmill with an energy brick in it would stop it).
  buildingKitTiles(b, n) {
    const out = [];
    for (const [dx, dy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const x = b[0] + dx, y = b[1] + dy;
      if (man([x, y], n) <= 1 && !(x === n[0] && y === n[1])) {
        // (diagonal to the building, beside the free side: still in the site's reach)
      }
      if (this.isFree(x, y, 0) && !(x === n[0] && y === n[1])) out.push([x, y]);
    }
    return out;
  }

  // A unit the solution is done with, that holds what is short: driven by the site and
  // taken apart.
  recyclable(site, need) {
    for (const u of Object.values(this.model.units)) {
      if (u.cls !== 'vehicle' || this.spent.has(u.name) || this.posted.has(u.name)) continue;
      if (this.usedLater(u.name)) continue;
      const rec = this.cfg[u.kind].recipe;
      const gives = {};
      let useful = 0;
      for (const [k, n] of Object.entries(need)) if (rec[k]) { gives[k] = Math.min(n, rec[k]); useful += gives[k]; }
      if (useful < 3) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) {
        const p = [site[0] + dx, site[1] + dy];
        if ((dx || dy) && !this.model.res.has(key(...p)) && this.model.dist(u, p) >= 0) near = true;
      }
      if (near) return { name: u.name, gives };
    }
    return null;
  }
  usedLater(name) { return this.busy && this.busy.has(name); }
  fromRecycle(site, gives) {
    const r = this.recyclable(site, gives);
    if (!r) no('nothing to take apart');
    const u = this.unit(r.name);
    // to a tile within a tile of the site
    let to = null, bd = 1e9;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const p = [site[0] + dx, site[1] + dy];
      if ((!dx && !dy) || this.model.res.has(key(p[0], p[1]))) continue;
      const d = this.model.dist(u, p);
      if (d >= 0 && d < bd) { bd = d; to = p; }
    }
    if (!to) no('cannot bring it by');
    this.go(r.name, to);
    this.play({ op: 'take', unit: r.name });
    this.spent.add(r.name);
    this.tags.add('take apart');
  }
}

// ---------- the layout ----------

// What opens each kind of link.
export const OPENERS = {
  rock: ROCK_CROSSERS, fill: ['steamshovel'], trees: ['treebot'], boulders: ['dozer'], factory: ['factory'],
  ferry: BOATS, whirl: BOATS, swim: SWIMMERS, swamp: ['defender'], guard: ['freezebot'],
};

Gen.prototype.chooseLinks = function (n) {
  const d = this.d;
  const pool = [
    ['rock', 3], ['fill', 3], ['trees', 3], ['boulders', 2 + d], ['factory', 1 + d], ['ferry', 2 + d],
    ['whirl', d], ['swim', 2], ['swamp', 1], ['guard', d + 1],
  ];
  const out = [];
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < 20; t++) {
      const k = this.rng.weighted(pool);
      if (out.includes(k) && t < 15) continue;
      // (a water link, or a guard, not first in the easiest missions)
      if (d === 1 && i === 0 && ['whirl', 'swamp'].includes(k)) continue;
      if (!this.look.swamp && k === 'swamp') continue;
      out.push(k);
      break;
    }
  }
  return out;
};

Gen.prototype.layout = function () {
  const rng = this.rng, d = this.d;
  const n = d === 1 ? rng.int(2, 3) : d === 2 ? rng.int(3, 4) : rng.int(4, 5);
  const kinds = this.chooseLinks(n - 1);
  const w = walk(rng, n, kinds.map((k) => k === 'whirl'));
  if (!w) no('no walk');
  const { cols, rows, cells } = w;
  const colW = Array.from({ length: cols }, () => rng.int(7, 9 + (d > 1 ? 1 : 0)));
  const rowH = Array.from({ length: rows }, () => rng.int(6, 8));
  const tc = new Array(Math.max(0, cols - 1)).fill(0).map(() => rng.int(...THICK.wall));
  const tr = new Array(Math.max(0, rows - 1)).fill(0).map(() => rng.int(...THICK.wall));
  const links = [];
  for (let i = 0; i < n - 1; i++) {
    const [ac, ar] = cells[i], [bc, br] = cells[i + 1];
    const kind = kinds[i];
    const adj = Math.abs(ac - bc) + Math.abs(ar - br) === 1;
    const l = { i, kind: adj || kind === 'whirl' ? kind : 'whirl', a: i, b: i + 1, adj };
    if (adj && l.kind !== 'whirl') {
      const [lo, hi] = THICK[l.kind];
      if (ar === br) { const j = Math.min(ac, bc); tc[j] = Math.max(tc[j], rng.int(lo, hi)); }
      else { const j = Math.min(ar, br); tr[j] = Math.max(tr[j], rng.int(lo, hi)); }
    }
    links.push(l);
  }
  // guards need exactly three
  for (const l of links) if (l.kind === 'guard') {
    const [ac, ar] = cells[l.a], [bc, br] = cells[l.b];
    if (ar === br) tc[Math.min(ac, bc)] = 3; else tr[Math.min(ar, br)] = 3;
  }
  const W = 2 + colW.reduce((a, b) => a + b, 0) + tc.reduce((a, b) => a + b, 0);
  const H = 2 + rowH.reduce((a, b) => a + b, 0) + tr.reduce((a, b) => a + b, 0);
  if (W > 48 || H > 32) no('too big');
  const colX = [], rowY = [];
  let x = 1;
  for (let c = 0; c < cols; c++) { colX.push(x); x += colW[c] + (tc[c] || 0); }
  let y = 1;
  for (let r = 0; r < rows; r++) { rowY.push(y); y += rowH[r] + (tr[r] || 0); }
  this.world = new World(W, H, this.look);
  this.areas = cells.map(([c, r], i) => ({ i, c, r, x0: colX[c], y0: rowY[r], x1: colX[c] + colW[c] - 1, y1: rowY[r] + rowH[r] - 1, tiles: new Set() }));
  for (const a of this.areas) {
    for (let yy = a.y0; yy <= a.y1; yy++) for (let xx = a.x0; xx <= a.x1; xx++) {
      this.world.set(xx, yy, '.');
      this.world.areaOf[yy][xx] = a.i;
      a.tiles.add(key(xx, yy));
    }
  }
  // the strips between areas side by side that are not linked: walls
  this.links = links;
  for (const l of links) if (l.adj && l.kind !== 'whirl') this.strip(l);
  // walls round about, of the look's own
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    if (this.world.areaOf[yy][xx] < 0 && this.world.at(xx, yy) === '@' && rng.chance(0.12) && xx > 0 && yy > 0 && xx < W - 1 && yy < H - 1) {
      const near = DIRS.some(([dx, dy]) => this.world.areaOf[yy + dy]?.[xx + dx] >= 0);
      if (near) this.world.set(xx, yy, rng.pick(this.look.walls));
    }
  }
};

// A link's strip: the tiles between its two areas, where they face each other.  lat runs
// along the areas' facing edges, depth from area a (0) to area b (t - 1).
Gen.prototype.strip = function (l) {
  const A = this.areas[l.a], B = this.areas[l.b];
  if (A.r === B.r) {
    const left = A.c < B.c;
    const sx0 = (left ? A.x1 : B.x1) + 1, sx1 = (left ? B.x0 : A.x0) - 1;
    l.t = sx1 - sx0 + 1;
    l.lat0 = Math.max(A.y0, B.y0); l.lat1 = Math.min(A.y1, B.y1);
    l.tile = (lat, depth) => [left ? sx0 + depth : sx1 - depth, lat];
  } else {
    const up = A.r < B.r;
    const sy0 = (up ? A.y1 : B.y1) + 1, sy1 = (up ? B.y0 : A.y0) - 1;
    l.t = sy1 - sy0 + 1;
    l.lat0 = Math.max(A.x0, B.x0); l.lat1 = Math.min(A.x1, B.x1);
    l.tile = (lat, depth) => [lat, up ? sy0 + depth : sy1 - depth];
  }
  l.fwd = (() => { const p = l.tile(0, 0), q = l.tile(0, 1); return [q[0] - p[0], q[1] - p[1]]; })();
};

// Paints a link's lanes with ground: fn(lat, depth) -> character.
Gen.prototype.paint = function (l, lats, fn) {
  for (const lat of lats) for (let dep = 0; dep < l.t; dep++) {
    const [x, y] = l.tile(lat, dep);
    const ch = fn(lat, dep);
    this.world.set(x, y, ch);
    this.world.areaOf[y][x] = -2;     // a strip
  }
  for (const lat of lats) {
    this.mouths.add(key(...l.tile(lat, -1)));
    this.mouths.add(key(...l.tile(lat, l.t)));
    this.keep(l.tile(lat, -1));
    this.keep(l.tile(lat, l.t));
  }
};
Gen.prototype.lanes = function (l, w, margin = 1) {
  const lo = l.lat0 + margin, hi = l.lat1 - margin - (w - 1);
  if (hi < lo) no('no room for the link');
  const p = this.rng.int(lo, hi);
  return Array.from({ length: w }, (_, i) => p + i);
};

// ---------- the links ----------

const PREP = {};
const RUN = {};

// Rocky ground: only a dirtbuggy, dumptruck or repairbot drives over it.
PREP.rock = function (l) {
  l.lats = this.lanes(l, this.rng.int(1, 2));
  this.paint(l, l.lats, () => '_');
};
RUN.rock = function (l) {
  const mouth = l.tile(l.lats[0], -1);
  const u = this.need(ROCK_CROSSERS, l.a, mouth);
  this.cross(u, l);
  this.tags.add('rocky ground');
  return [u];
};

// Water: a steamshovel digs ground out somewhere and fills it in, from either side.
PREP.fill = function (l) {
  l.lats = this.lanes(l, this.rng.int(1, 2));
  l.deep = Math.min(l.t, this.rng.int(1, 2));
  l.fromB = this.d > 1 && this.rng.chance(0.3);
  this.paint(l, l.lats, (lat, dep) => (l.fromB ? dep >= l.t - l.deep : dep < l.deep) ? 'w' : '.');
};
RUN.fill = function (l) {
  const side = l.fromB ? l.b : l.a;
  const depths = [];
  for (let k = 0; k < l.deep; k++) depths.push(l.fromB ? l.t - 1 - k : k);
  const mouth = l.tile(l.lats[0], l.fromB ? l.t : -1);
  let u;
  if (l.fromB) {
    const at = this.spot(side, { near: mouth, within: 4 });
    u = this.add({ t: 'unit', cls: 'vehicle', kind: 'steamshovel', at }).name;
    this.tags.add('help from the far side');
  } else u = this.need(['steamshovel'], l.a, mouth);
  for (const lat of l.lats) for (const dep of depths) {
    const pit = this.spot(side, { near: mouth, within: 7, edge: true, test: (x, y) => !this.mouths.has(key(x, y)) });
    this.act('dig', u, pit);
    this.act('fill', u, l.tile(lat, dep));
  }
  this.tags.add('dig and fill');
  this.park(u, side);
  return [u];
};

// Trees: a treebot takes them up and plants them somewhere else.
PREP.trees = function (l) {
  l.lats = this.lanes(l, this.rng.int(1, 2));
  l.deep = Math.min(l.t, this.rng.int(1, 2));
  l.fromB = this.d > 1 && this.rng.chance(0.25);
  const tree = this.rng.pick(this.look.trees);
  this.paint(l, l.lats, (lat, dep) => (l.fromB ? dep >= l.t - l.deep : dep < l.deep) ? tree : '.');
};
RUN.trees = function (l) {
  const side = l.fromB ? l.b : l.a;
  const depths = [];
  for (let k = 0; k < l.deep; k++) depths.push(l.fromB ? l.t - 1 - k : k);
  const mouth = l.tile(l.lats[0], l.fromB ? l.t : -1);
  let u;
  if (l.fromB) {
    const at = this.spot(side, { near: mouth, within: 4 });
    u = this.add({ t: 'unit', cls: 'vehicle', kind: 'treebot', at }).name;
    this.tags.add('help from the far side');
  } else u = this.need(['treebot'], l.a, mouth);
  for (const lat of l.lats) for (const dep of depths) {
    this.act('uproot', u, l.tile(lat, dep));
    const spot = this.spot(side, { near: mouth, within: 7, edge: true, test: (x, y) => !this.mouths.has(key(x, y)) });
    this.act('plant', u, spot);
  }
  this.tags.add('uproot and plant');
  this.park(u, side);
  return [u];
};

// Boulders in a narrow place: a bulldozer pushes them out of the way (a pushing puzzle
// solved here by search).
PREP.boulders = function (l) {
  const w = this.rng.int(2, Math.max(2, Math.min(3, l.lat1 - l.lat0 - 1)));
  for (let tries = 0; tries < 40; tries++) {
    const lats = this.lanes(l, w);
    const room = [];
    for (const lat of lats) for (let dep = 0; dep < l.t; dep++) room.push([lat, dep]);
    const rocks = new Set(), stones = new Set();
    const nr = this.rng.int(0, 2), nb = this.rng.int(2, Math.min(4, 1 + this.d + (w > 2 ? 1 : 0)));
    const free = this.rng.shuffle(room);
    for (let i = 0; i < nr && free.length; i++) { const [a, b] = free.pop(); rocks.add(a + ',' + b); }
    for (let i = 0; i < nb && free.length; i++) { const [a, b] = free.pop(); stones.add(a + ',' + b); }
    const sol = sokoban(lats, l.t, rocks, stones);
    if (!sol || sol.length < Math.min(1 + this.d, 3)) continue;
    l.lats = lats;
    l.rocks = rocks;
    l.stones = stones;
    l.pushes = sol;
    const rock = this.rng.pick(this.look.rocks);
    this.paint(l, lats, (lat, dep) => rocks.has(lat + ',' + dep) ? rock : '.');
    return;
  }
  no('no pushing puzzle');
};
RUN.boulders = function (l) {
  for (const k of l.stones) {
    const [lat, dep] = k.split(',').map(Number);
    this.add({ t: 'unit', cls: 'monster', kind: 'boulder', at: l.tile(lat, dep) });
  }
  const mouth = l.tile(l.lats[0], -1);
  const u = this.need(['dozer'], l.a, mouth);
  for (const [[pl, pd], [bl, bd]] of l.pushes) {
    this.play({ op: 'push', unit: u, at: l.tile(bl, bd), stand: l.tile(pl, pd) });
  }
  this.tags.add('push boulders');
  this.park(u, l.b, true);
  return [u];
};

// One tree or boulder in a gap, and a nook beside it where a factory goes: the factory
// turns it into bricks.
PREP.factory = function (l) {
  const lats = this.lanes(l, 1, 2);
  const s = this.rng.chance(0.5) ? 1 : -1;
  l.lats = lats;
  l.nook = lats[0] + s;
  l.blocker = this.rng.chance(0.5) ? 'boulder' : this.rng.pick(this.look.trees);
  this.paint(l, lats, (lat, dep) => (dep === 0 && l.blocker !== 'boulder') ? l.blocker : '.');
  const [nx, ny] = l.tile(l.nook, 0);
  this.world.set(nx, ny, '.');
  this.world.areaOf[ny][nx] = -2;
};
RUN.factory = function (l) {
  const gap = l.tile(l.lats[0], 0);
  if (l.blocker === 'boulder') this.add({ t: 'unit', cls: 'monster', kind: 'boulder', at: gap });
  else this.reserve(gap);
  const site = l.tile(l.nook, 0);
  this.reserve(site);
  for (const p of [l.tile(l.nook, -1), l.tile(l.nook, 1), l.tile(l.lats[0], 1), l.tile(l.lats[0], -1)]) this.reserve(p);
  // the factory's bricks, on the near side by the nook
  this.plan('factory', l.a, true);
  const near = [l.tile(l.nook, -1), l.tile(2 * l.nook - l.lats[0], -1)].filter(([x, y]) => this.world.areaOf[y]?.[x] === l.a && !this.model.res.has(key(x, y)));
  if (!near.length) no('no room by the nook');
  const rec = Object.assign({}, this.cfg.factory.recipe);
  const missing = this.rng.chance(0.5) && this.carrierFor(near[0]) ? { white: this.rng.int(8, 25) } : null;
  if (missing) rec.white -= missing.white;
  this.add({ t: 'pile', at: near[0], bricks: rec });
  if (missing) this.fromLoose(l.a, near[0], missing);
  const f = this.world.name('b');
  this.play({ op: 'build', what: 'factory', at: site, as: f });
  // its bricks, of a colour what comes next needs
  const color = this.rng.pick(['yellow', 'yellow', 'blue', 'red', 'green']);
  const times = COLORS.indexOf(color);
  if (times) this.play({ op: 'color', unit: f, times });
  this.play({ op: 'wait', unit: f, made: [gap] });
  this.tags.add('factory makes bricks');
  this.hint = { area: l.b, at: gap };
  return [];
};

// A river: a boat carries bricks over to the far bank, where the next unit is built.
PREP.ferry = function (l) {
  const w = Math.max(2, Math.min(l.lat1 - l.lat0 - 1, this.rng.int(3, 5)));
  l.lats = this.lanes(l, w);
  const deep = l.t >= 3 && this.rng.chance(0.5);
  this.paint(l, l.lats, (lat, dep) => (deep && dep > 0 && dep < l.t - 1 && lat !== l.lats[0]) ? 'x' : 'w');
};
RUN.ferry = function (l) {
  // the boat, built on the near bank
  const inner = l.lats.slice(1, -1);
  const lat = this.rng.pick(inner.length ? inner : l.lats);
  const yard = l.tile(lat, 0);
  const bank = [l.tile(lat - 1, -1), l.tile(lat, -1), l.tile(lat + 1, -1)].filter(([x, y]) => this.world.areaOf[y]?.[x] === l.a);
  const boat = this.boat(l.a, yard, bank);
  this.busy.add(boat);
  // what is built on the far bank, from bricks there and those the boat brings
  const lat2 = this.rng.pick(l.lats);
  this.deliver(l.a, boat, l.b, l.tile(lat2, l.t - 1), l.tile(lat2, l.t), bank);
  this.tags.add('ferry');
  return [];
};

// Two ponds, in areas far apart, joined by a pair of whirlpools.
PREP.whirl = function (l) {
  l.ponds = [this.pond(l.a), this.pond(l.b)];
};
RUN.whirl = function (l) {
  const [pa, pb] = l.ponds;
  const id = String(++this.whirlIds);
  this.add({ t: 'whirl', at: pa.whirl, id });
  this.add({ t: 'whirl', at: pb.whirl, id });
  const boat = this.boat(l.a, pa.yard, pa.bank);
  this.busy.add(boat);
  this.deliver(l.a, boat, l.b, pb.dock, pb.land, pa.bank, { via: [pa.whirl, pb.whirl] });
  this.tags.add('whirlpool');
  return [];
};

// Water a duck or frog swims over, to fetch the plan on the far side.
PREP.swim = function (l) {
  const w = Math.max(1, Math.min(l.lat1 - l.lat0 - 1, this.rng.int(2, 4)));
  l.lats = this.lanes(l, w);
  this.paint(l, l.lats, () => 'w');
};
RUN.swim = function (l) {
  const mouth = l.tile(l.lats[0], -1);
  const u = this.need(SWIMMERS, l.a, mouth, { within: 4 });
  this.cross(u, l);
  this.landing(l.b, u);
  this.tags.add('swim');
  return [u];
};

// A wide swamp: it wears down anything but a shielded defender.
PREP.swamp = function (l) {
  l.lats = this.lanes(l, this.rng.int(1, 3));
  this.paint(l, l.lats, () => '#');
};
RUN.swamp = function (l) {
  const mouth = l.tile(l.lats[0], -1);
  const u = this.need(['defender'], l.a, mouth);
  this.cross(u, l);
  this.landing(l.b, u);
  this.tags.add('swamp');
  return [u];
};

// A narrow way past a monster's den: a freezebot within reach holds it frozen.
PREP.guard = function (l) {
  const lats = this.lanes(l, 1, 2);
  l.lats = lats;
  l.side = lats[0] + (this.rng.chance(0.5) ? 1 : -1);
  const water = ['shark', 'water_crab'];
  const land = ['crab', 'gator'];
  l.ground = this.rng.chance(0.5) ? '.' : '_';
  const choices = l.ground === '.' ? water : land.concat(water);
  const pref = choices.filter((m) => this.look.monsters.includes(m));
  l.monster = this.rng.pick(pref.length ? pref : choices);
  const wet = water.includes(l.monster);
  this.paint(l, lats, () => l.ground);
  const [px, py] = l.tile(l.side, 1);
  this.world.set(px, py, wet ? this.rng.pick(['w', 'x']) : '.');
  this.world.areaOf[py][px] = -2;
  l.den = [px, py];
  l.wet = wet;
};
RUN.guard = function (l) {
  this.add({ t: 'unit', cls: 'monster', kind: l.monster, at: l.den, water: l.wet });
  const post = l.tile(l.side, -1);
  if (this.world.areaOf[post[1]]?.[post[0]] !== l.a) no('no post');
  this.reserve(post);
  const fz = this.need(['freezebot'], l.a, post);
  this.go(fz, post);
  this.posted.add(fz);
  this.tags.add('freeze a monster');
  this.tags.add('monster ' + l.monster);
  const mouth = l.tile(l.lats[0], -1);
  let u;
  if (l.ground === '_') u = this.need(ROCK_CROSSERS, l.a, mouth);
  else u = this.have(['forklift', 'dumptruck', 'buggy', 'dirtbuggy', 'dozer', 'steamshovel', 'treebot'], mouth) || this.need(CARRIERS, l.a, mouth);
  this.cross(u, l);
  return [u];
};

// ---------- moving about ----------

// Takes a unit over a link into the area beyond it.
Gen.prototype.cross = function (u, l) {
  const mouthB = l.tile(l.lats[0], l.t);
  const to = this.spot(l.b, { near: mouthB, within: 3, spacing: 0, noReserve: true, test: (x, y) => !this.mouths.has(key(x, y)) && this.model.dist(this.unit(u), [x, y]) > 0 });
  this.go(u, to);
};

// Moves a unit out of the way, if it stands in a gap or a mouth.
Gen.prototype.park = function (u, a) {
  const unit = this.unit(u);
  if (!unit) return;
  const k = key(unit.x, unit.y);
  const inGap = this.world.areaOf[unit.y][unit.x] < 0;
  const byMouth = DIRS.some(([dx, dy]) => this.mouths.has(key(unit.x + dx, unit.y + dy))) || this.mouths.has(k);
  if (!inGap && !byMouth) return;
  let to;
  try {
    to = this.spot(a, { edge: true, test: (x, y) => !this.mouths.has(key(x, y)) && !DIRS.some(([dx, dy]) => this.mouths.has(key(x + dx, y + dy))) && this.model.dist(unit, [x, y]) > 0 });
  } catch (e) { return; }
  this.go(u, to);
};

// A boat at a water tile, from bricks on the bank beside it.
Gen.prototype.boat = function (a, yard, bank) {
  const have = this.have(BOATS, yard);
  if (have) return have;
  const what = this.rng.pick(BOATS);
  this.siteWater = true;
  try {
    return this.make(what, a, yard, { fetchPlan: false });
  } finally {
    this.siteWater = false;
  }
};

// What is built beyond water from bricks a boat brings: the bricks for it partly on the
// far bank already, the rest carried over from this side.
Gen.prototype.deliver = function (a, boat, b, dock, land, bank, opts = {}) {
  const kinds = this.nextKinds();
  const what = this.rng.pick(kinds);
  const recipe = this.cfg[what].recipe;
  const cap = this.cfg[this.unit(boat).kind].carries;
  // what the boat brings: a load or two of what the far side is short of
  const short = {};
  let total = 0;
  for (const k of this.rng.shuffle(Object.keys(recipe))) {
    if (total >= cap * 2) break;
    const n = Math.min(recipe[k], cap * 2 - total, k === 'energy' ? 1 : this.rng.int(2, recipe[k]));
    if (n > 0) { short[k] = n; total += n; }
  }
  // the site: where the boat leaves them, on the far bank
  const site = land;
  if (!this.isFree(site[0], site[1], 0) && !this.reserved.has(key(...site))) no('the far bank is taken');
  this.reserve(site);
  const there = {};
  for (const [k, n] of Object.entries(recipe)) if (n - (short[k] || 0) > 0) there[k] = n - (short[k] || 0);
  if (Object.keys(there).length) this.kit(site, there);
  // the cargo, on this side: on the bank, or brought to it by a carrier
  const boatU = this.unit(boat);
  const pickable = (x, y) => DIRS.some(([dx, dy]) => this.model.dist(boatU, [x + dx, y + dy]) >= 0 && CHAR[this.model.grid[y + dy]?.[x + dx]]?.startsWith('water'));
  let cargoAt;
  const carrier = this.carrierFor(bank && bank[0] ? bank[0] : land);
  if (carrier && this.rng.chance(0.5)) {
    const drop = this.spot(a, { spacing: 0, test: (x, y) => pickable(x, y) });
    const from = this.spot(a, { near: drop, within: 7, min: 3 });
    this.add({ t: 'pile', at: from, bricks: short });
    this.haul(carrier, from, drop);
    this.tags.add('haul to the boat');
    cargoAt = drop;
  } else {
    cargoAt = this.spot(a, { spacing: 0, test: (x, y) => pickable(x, y) });
    this.add({ t: 'pile', at: cargoAt, bricks: short });
  }
  // the plan for it: in hand, or floating where the boat goes
  if (!(this.model.inventory[what] > 0)) {
    if (this.rng.chance(0.4)) {
      const water = this.waterNear(boatU, 6);
      if (water) {
        this.add({ t: 'plan', at: water, what, n: 1, water: true });
        this.go(boat, water);
        this.tags.add('fetch plan');
      } else this.plan(what, b, false);
    } else this.plan(what, b, false);
  }
  // the trips over
  for (let trip = 0; trip < 6 && this.model.res.get(key(...cargoAt)); trip++) {
    this.act('pick', boat, cargoAt);
    if (opts.via) this.play({ op: 'whirl', unit: boat, at: opts.via[0], out: opts.via[1] });
    this.act('drop', boat, site);
    if (opts.via && this.model.res.get(key(...cargoAt))) this.play({ op: 'whirl', unit: boat, at: opts.via[1], out: opts.via[0] });
  }
  if (this.model.res.get(key(...cargoAt))) no('the boat never finished');
  const as = this.world.name('u');
  this.play({ op: 'build', what, at: site, as });
  this.tags.add('build ' + what);
  // the new unit off the bank, out of the boat's way
  this.park(as, b);
  return as;
};
// A water tile a unit can get to, within some distance.
Gen.prototype.waterNear = function (u, within) {
  const out = [];
  for (let y = 0; y < this.world.H; y++) for (let x = 0; x < this.world.W; x++) {
    if (this.model.grid[y][x] !== 'w' || this.model.res.has(key(x, y)) || this.model.occ[y][x] || this.reserved.has(key(x, y))) continue;
    const d = this.model.dist(u, [x, y]);
    if (d > 0 && d <= within) out.push([x, y]);
  }
  if (!out.length) return null;
  const p = this.rng.pick(out);
  this.reserve(p);
  return p;
};

// What the next link (or the goal) needs, to be built beyond water.
Gen.prototype.nextKinds = function () {
  const nx = this.links[this.li + 1];
  let kinds = nx ? OPENERS[nx.kind].filter((k) => this.cfg[k].cls === 'vehicle' && this.cfg[k].terrain.includes('normal')) : [];
  if (nx && nx.kind === 'guard') kinds = ['freezebot'];
  if (!kinds.length) kinds = ['forklift', 'dumptruck', 'buggy', 'dirtbuggy', 'dozer'];
  return kinds;
};

// After a swim or a wade: the unit fetches a plan on the far side, and the next unit is
// built there from bricks by its site.
Gen.prototype.landing = function (b, u) {
  const kinds = this.nextKinds();
  const what = this.rng.pick(kinds);
  const unit = this.unit(u);
  const planAt = this.spot(b, { test: (x, y) => this.model.dist(unit, [x, y]) > 0 });
  this.add({ t: 'plan', at: planAt, what, n: 1 });
  this.go(u, planAt);
  this.tags.add('fetch plan');
  const site = this.spot(b, { near: planAt, within: 5, min: 2, test: (x, y) => this.roomAround(x, y) >= 5 });
  this.kit(site, this.cfg[what].recipe);
  const as = this.world.name('u');
  this.play({ op: 'build', what, at: site, as });
  this.tags.add('build ' + what);
  this.park(u, b);
  return as;
};

// A pond in an area, by its edge, with a whirlpool in a dead end off it.
Gen.prototype.pond = function (a) {
  const A = this.areas[a];
  for (let tries = 0; tries < 40; tries++) {
    const side = this.rng.int(0, 3);
    const w = this.rng.int(2, 3), h = 2;
    let x0, y0, wx, wy;
    if (side === 0) { x0 = this.rng.int(A.x0 + 1, A.x1 - w); y0 = A.y0; wx = x0 + this.rng.int(0, w - 1); wy = y0 - 1; }
    else if (side === 1) { x0 = this.rng.int(A.x0 + 1, A.x1 - w); y0 = A.y1 - h + 1; wx = x0 + this.rng.int(0, w - 1); wy = A.y1 + 1; }
    else if (side === 2) { x0 = A.x0; y0 = this.rng.int(A.y0 + 1, A.y1 - w); wx = x0 - 1; wy = y0 + this.rng.int(0, w - 1); }
    else { x0 = A.x1 - h + 1; y0 = this.rng.int(A.y0 + 1, A.y1 - w); wx = A.x1 + 1; wy = y0 + this.rng.int(0, w - 1); }
    const pw = side < 2 ? w : h, ph = side < 2 ? h : w;
    const tiles = [];
    for (let y = y0; y < y0 + ph; y++) for (let x = x0; x < x0 + pw; x++) tiles.push([x, y]);
    if (tiles.some(([x, y]) => !A.tiles.has(key(x, y)) || this.mouths.has(key(x, y)) || this.world.at(x, y) !== '.')) continue;
    if (!this.world.inside(wx, wy) || wx < 1 || wy < 1 || wx > this.world.W - 2 || wy > this.world.H - 2) continue;
    if (this.world.areaOf[wy][wx] !== -1 || this.world.at(wx, wy) !== '@' && !SOLID.has(this.world.at(wx, wy))) continue;
    // the whirlpool's other sides: nothing a boat goes on
    if (DIRS.some(([dx, dy]) => { const x = wx + dx, y = wy + dy; return !tiles.some(([p, q]) => p === x && q === y) && (this.world.areaOf[y]?.[x] ?? -1) !== -1; })) continue;
    // the rest of the area still in one piece
    for (const [x, y] of tiles) { this.world.set(x, y, 'w'); A.tiles.delete(key(x, y)); }
    if (!this.areaJoined(a)) {
      for (const [x, y] of tiles) { this.world.set(x, y, '.'); A.tiles.add(key(x, y)); }
      continue;
    }
    this.world.set(wx, wy, '.');
    this.world.areaOf[wy][wx] = -2;
    for (const [x, y] of tiles) this.world.areaOf[y][x] = -2;
    // where a boat is built (a water tile beside the land), and its bank
    const shoreOf = ([x, y]) => DIRS.map(([dx, dy]) => [x + dx, y + dy]).filter(([p, q]) => A.tiles.has(key(p, q)));
    const yard = this.rng.pick(tiles.filter((t) => shoreOf(t).length && !(DIRS.some(([dx, dy]) => t[0] + dx === wx && t[1] + dy === wy))));
    if (!yard) continue;
    const bank = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (A.tiles.has(key(yard[0] + dx, yard[1] + dy))) bank.push([yard[0] + dx, yard[1] + dy]);
    const dock = this.rng.pick(tiles.filter((t) => shoreOf(t).length));
    const land = this.rng.pick(shoreOf(dock));
    for (const p of [yard, dock, land]) this.keep(p);
    for (const t of tiles) this.keep(t);
    return { tiles, whirl: [wx, wy], yard, bank, dock, land };
  }
  no('no room for a pond');
};
Gen.prototype.areaJoined = function (a) {
  const tiles = [...this.areas[a].tiles];
  if (!tiles.length) return false;
  const seen = new Set([tiles[0]]);
  const stack = [tiles[0].split(',').map(Number)];
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of DIRS) {
      const k = key(x + dx, y + dy);
      if (!seen.has(k) && this.areas[a].tiles.has(k)) { seen.add(k); stack.push([x + dx, y + dy]); }
    }
  }
  return seen.size === tiles.length;
};

// ---------- a pushing puzzle ----------

// The fewest pushes that clear a way across a room of lanes x depth, with rocks fixed
// and boulders to push (each "lat,dep"), the bulldozer starting on the near side.
// Answers [[stand, boulder], ...] in (lat, dep) or null.
export function sokoban(lats, t, rocks, stones) {
  const lo = lats[0] - 1, hi = lats[lats.length - 1] + 1;
  const inRoom = (l, d) => l >= lats[0] && l <= lats[lats.length - 1] && d >= 0 && d < t;
  const walkable = (l, d) => (inRoom(l, d) && !rocks.has(l + ',' + d)) || ((d === -1 || d === t) && l >= lo && l <= hi);
  const D = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const open = (bs) => {
    // a way from the near side to the far one, round the boulders
    const seen = new Set();
    const stack = [];
    for (let l = lo; l <= hi; l++) { stack.push([l, -1]); seen.add(l + ',-1'); }
    while (stack.length) {
      const [l, d] = stack.pop();
      if (d === t) return true;
      for (const [dl, dd] of D) {
        const nl = l + dl, nd = d + dd, k = nl + ',' + nd;
        if (seen.has(k) || !walkable(nl, nd) || bs.has(k)) continue;
        seen.add(k);
        stack.push([nl, nd]);
      }
    }
    return false;
  };
  const reach = (bs, from) => {
    const seen = new Set([from]);
    const stack = [from.split(',').map(Number)];
    while (stack.length) {
      const [l, d] = stack.pop();
      for (const [dl, dd] of D) {
        const nl = l + dl, nd = d + dd, k = nl + ',' + nd;
        if (seen.has(k) || !walkable(nl, nd) || bs.has(k)) continue;
        seen.add(k);
        stack.push([nl, nd]);
      }
    }
    return seen;
  };
  if (open(stones)) return null;
  const start = { bs: new Set(stones), at: lats[0] + ',-1', path: [] };
  const canon = (bs, r) => [...bs].sort().join(';') + '|' + [...r].sort()[0];
  const seen = new Set([canon(start.bs, reach(start.bs, start.at))]);
  let frontier = [start];
  for (let depth = 0; depth < 8 && frontier.length; depth++) {
    const next = [];
    for (const s of frontier) {
      const r = reach(s.bs, s.at);
      for (const b of s.bs) {
        const [bl, bd] = b.split(',').map(Number);
        for (const [dl, dd] of D) {
          const stand = (bl - dl) + ',' + (bd - dd);
          const to = [bl + dl, bd + dd];
          if (!r.has(stand) || !inRoom(...to) || rocks.has(to.join()) || s.bs.has(to.join())) continue;
          const bs = new Set(s.bs);
          bs.delete(b);
          bs.add(to.join());
          const path = s.path.concat([[[bl - dl, bd - dd], [bl, bd]]]);
          if (open(bs)) return path;
          const c = canon(bs, reach(bs, b));
          if (seen.has(c)) continue;
          seen.add(c);
          next.push({ bs, at: b, path });
        }
      }
    }
    frontier = next;
  }
  return null;
}

// ---------- the start ----------

Gen.prototype.start = function () {
  const r = this.rng.f();
  const first = this.links[0];
  const opener = OPENERS[first.kind].filter((k) => this.cfg[k].cls === 'vehicle' && this.cfg[k].terrain.includes('normal'));
  const at = this.spot(0, { inner: true });
  if (r < 0.55 || !opener.length) {
    this.add({ t: 'unit', cls: 'vehicle', kind: this.rng.pick(CARRIERS), at, name: 'u0' });
  } else if (r < 0.8) {
    this.add({ t: 'unit', cls: 'vehicle', kind: this.rng.pick(opener), at, name: 'u0' });
    if (this.rng.chance(0.6)) {
      const at2 = this.spot(0, { near: at, within: 5 });
      this.add({ t: 'unit', cls: 'vehicle', kind: this.rng.pick(CARRIERS), at: at2 });
    }
  } else {
    // nothing yet: the bricks for a carrier, and its plan
    const kind = this.rng.pick(CARRIERS);
    this.plan(kind, 0, false);
    this.kit(at, this.cfg[kind].recipe);
    this.play({ op: 'build', what: kind, at, as: 'u0' });
    this.tags.add('build ' + kind);
  }
  this.tags.add('start ' + this.unit('u0').kind);
  // plans for things the mission does not need, to think about
  if (this.d > 1) {
    const extra = ['buggy', 'dirtbuggy', 'steamshovel', 'treebot', 'dozer', 'duck', 'frog', 'snail', 'fish', 'tugboat', 'gas_station', 'house', 'repairbot'];
    for (let i = this.rng.int(0, this.d - 1); i > 0; i--) {
      const k = this.rng.pick(extra);
      this.world.inventory[k] = (this.world.inventory[k] || 0) + 1;
      this.model.inventory[k] = (this.model.inventory[k] || 0) + 1;
    }
  }
};

// ---------- goals ----------

const GOAL = {};

// A nook off an area's edge: a tile of ground with nothing round it but the area.
Gen.prototype.nook = function (a, opts = {}) {
  const A = this.areas[a];
  const cands = [];
  for (const k of A.tiles) {
    const [x, y] = k.split(',').map(Number);
    if (this.world.at(x, y) !== '.' || this.mouths.has(k)) continue;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!this.world.inside(nx, ny) || nx < 1 || ny < 1 || nx > this.world.W - 2 || ny > this.world.H - 2) continue;
      if (this.world.areaOf[ny][nx] !== -1) continue;
      // its other sides: off the map's ground
      const others = DIRS.filter(([ex, ey]) => ex !== -dx || ey !== -dy).map(([ex, ey]) => [nx + ex, ny + ey]);
      if (others.some(([p, q]) => (this.world.areaOf[q]?.[p] ?? -1) !== -1 || this.world.at(p, q) === 'w')) continue;
      if (this.reserved.has(key(x, y)) && !opts.anyMouth) continue;
      cands.push([[nx, ny], [x, y]]);
    }
  }
  if (!cands.length) no('no nook');
  const [n, e] = this.rng.pick(cands);
  this.world.set(n[0], n[1], '.');
  this.model.setChar(n[0], n[1], '.');
  this.world.areaOf[n[1]][n[0]] = -3;
  this.reserve(n);
  this.keep(e);
  this.nookEdge = e;
  return n;
};

// A unit brought to a place.
GOAL.reach = function (a, which) {
  const n = this.nook(a);
  let u = null;
  const units = Object.values(this.model.units).filter((x) => x.cls === 'vehicle' && !this.posted.has(x.name) && !this.spent.has(x.name) && this.model.dist(x, n) > 0);
  if (units.length && this.rng.chance(which === 'bonus' ? 0.6 : 0.5)) {
    // the farthest away, mostly
    units.sort((p, q) => this.model.dist(q, n) - this.model.dist(p, n));
    u = (this.rng.chance(0.7) ? units[0] : this.rng.pick(units)).name;
  } else {
    // one made for it: an animal, mostly
    const kinds = this.rng.chance(0.6) ? ['duck', 'frog', 'snail'] : ['buggy', 'forklift', 'dirtbuggy', 'dozer', 'steamshovel', 'treebot', 'freezebot', 'repairbot', 'defender', 'dumptruck'];
    const what = this.rng.pick(kinds);
    const site = this.spot(a, { test: (x, y) => this.roomAround(x, y) >= 4 && man([x, y], n) >= 3 });
    u = this.make(what, a, site, { partial: true });
    this.tags.add('made for the ' + which + ': ' + what);
  }
  const kind = this.unit(u).kind;
  const want = this.rng.chance(0.15) ? 'anything' : kind;
  this.add({ t: 'goal', which, at: n, want });
  this.go(u, n);
  this.tags.add(which + ': reach ' + (want === 'anything' ? 'anything' : kind));
  this.goalUnit = u;
};

// A building built on a place.
GOAL.build = function (a, which) {
  const what = this.rng.pick(GOAL_BUILDINGS);
  const g = this.spot(a, { test: (x, y) => this.roomAround(x, y) >= 6 });
  // nothing beside it a factory would take, or a windmill or nursery fill
  for (const [dx, dy] of DIRS) this.reserved.add(key(g[0] + dx, g[1] + dy));
  this.add({ t: 'goal', which, at: g, want: what });
  this.make(what, a, g, { fetchPlan: true, partial: true });
  this.tags.add(which + ': build ' + what);
};

// A monster between two boulders: frozen, the boulders pushed aside, and pushed out onto
// the goal (or into a pen marked out on the ground).
GOAL.monster = function (a, which) {
  const A = this.areas[a];
  const land = ['crab', 'lion', 'gator', 'scorpion', 'trex'];
  const pref = land.filter((m) => this.look.monsters.includes(m));
  const kind = this.rng.pick(pref.length ? pref : land);
  for (let tries = 0; tries < 30; tries++) {
    const [dx, dy] = this.rng.pick(DIRS);
    const [px, py] = [dy, dx];  // across the line
    const M = this.rng.pick([...A.tiles].map((k) => k.split(',').map(Number)));
    const at = (k, j = 0) => [M[0] + k * dx + j * px, M[1] + k * dy + j * py];
    const line = [-2, -1, 0, 1, 2, 3].map((k) => at(k));
    const around = [at(-1, -1), at(-1, 1), at(1, -1), at(1, 1), at(-1, -2), at(0, -2), at(1, -2), at(0, 1), at(0, -1)];
    const all = line.concat(around);
    if (!all.every(([x, y]) => A.tiles.has(key(x, y)) && this.isFree(x, y, 0) && !this.mouths.has(key(x, y)))) continue;
    // the den's walls, the boulders, the monster, the goal
    const rock = this.rng.pick(this.look.rocks);
    this.setGround(...at(0, 1), rock);
    this.setGround(...at(0, -1), rock);
    for (const p of [at(0, 1), at(0, -1)]) this.reserve(p);
    for (const p of all) this.reserve(p);
    this.add({ t: 'unit', cls: 'monster', kind: 'boulder', at: at(-1) });
    this.add({ t: 'unit', cls: 'monster', kind: 'boulder', at: at(1) });
    this.add({ t: 'unit', cls: 'monster', kind, at: M });
    const collect = this.rng.chance(0.6);
    const G = at(3);
    if (collect) {
      this.add({ t: 'goal', which, at: G, want: 'collect 1 ' + kind });
      for (const p of [at(4), at(3, 1), at(3, -1)]) {
        if (this.world.at(...p) === '.' && this.areas[a].tiles.has(key(...p)) && !this.model.res.has(key(...p))) {
          this.setGround(...p, ':');
          this.model.goalTiles.add(key(...p));
        }
      }
    } else this.add({ t: 'goal', which, at: G, want: kind });
    // the freezebot two tiles off, then the bulldozer
    const post = at(-2);
    const fz = this.need(['freezebot'], a, post, { within: 8 });
    this.busy.add(fz);
    this.go(fz, post);
    const dz = this.need(['dozer'], a, at(-2, -2), { within: 8 });
    this.play({ op: 'push', unit: dz, at: at(1), stand: at(1, -1) });
    this.play({ op: 'push', unit: dz, at: at(-1), stand: at(-1, -1) });
    this.play({ op: 'push', unit: dz, at: at(0), stand: at(-1) });
    this.play({ op: 'push', unit: dz, at: at(1), stand: at(0) });
    this.play({ op: 'push', unit: dz, at: at(2), stand: at(1) });
    // the freezebot by it from now on
    let post2 = null;
    for (const p of [at(3, 2), at(3, -2), at(2, 2), at(2, -2), at(4, 1), at(4, -1), at(5)]) {
      if (this.model.inside(...p) && this.model.canStand('freezebot', ...p) && !this.model.occ[p[1]][p[0]] && this.model.dist(this.unit(fz), p) > 0) { post2 = p; break; }
    }
    if (!post2) no('nowhere to hold it from');
    this.go(fz, post2);
    this.posted.add(fz);
    this.tags.add(which + ': ' + (collect ? 'collect ' : 'push ') + kind);
    this.tags.add('monster ' + kind);
    this.tags.add('freeze a monster');
    return;
  }
  no('no room for a den');
};

// A boulder pushed into a nook.
GOAL.boulder = function (a, which) {
  for (let tries = 0; tries < 20; tries++) {
    const n = this.nook(a);
    const e = this.nookEdge;
    const d = [n[0] - e[0], n[1] - e[1]];
    const k = this.rng.int(2, 3);
    const B0 = [n[0] - k * d[0], n[1] - k * d[1]];
    const line = [];
    for (let i = 1; i <= k + 1; i++) line.push([n[0] - i * d[0], n[1] - i * d[1]]);
    if (!line.every(([x, y]) => this.areas[a].tiles.has(key(x, y)) && (this.isFree(x, y, 0) || (x === e[0] && y === e[1])))) {
      // (put the nook back)
      this.world.set(n[0], n[1], '@'); this.model.setChar(n[0], n[1], '@'); this.world.areaOf[n[1]][n[0]] = -1;
      this.reserved.delete(key(...n));
      continue;
    }
    for (const p of line) this.reserve(p);
    this.add({ t: 'unit', cls: 'monster', kind: 'boulder', at: B0 });
    this.add({ t: 'goal', which, at: n, want: 'boulder' });
    const dz = this.need(['dozer'], a, line[line.length - 1], { within: 8 });
    for (let i = 0; i < k; i++) {
      const b = [B0[0] + i * d[0], B0[1] + i * d[1]];
      this.play({ op: 'push', unit: dz, at: b, stand: [b[0] - d[0], b[1] - d[1]] });
    }
    this.tags.add(which + ': push a boulder');
    return;
  }
  no('no room for a boulder');
};

Gen.prototype.goal = function () {
  const a = this.areas.length - 1;
  const order = [];
  const pool = [['reach', 4], ['build', 4], ['monster', this.d >= 2 ? 3 : 1], ['boulder', 2]];
  while (pool.length) {
    const k = this.rng.weighted(pool);
    order.push(k);
    pool.splice(pool.findIndex(([x]) => x === k), 1);
  }
  for (const k of order) {
    const snap = this.snapshot();
    this.busy = new Set();
    try {
      GOAL[k].call(this, a, 'goal');
      this.goalKind = k;
      if (!this.model.done('goal')) no('the goal is not reached');
      return;
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      this.restore(snap);
    }
  }
  no('no goal');
};

Gen.prototype.bonus = function () {
  this.into = this.bonusSteps;
  const pool = [['reach', 4], ['build', 3], ['monster', 2], ['boulder', 2]].filter(([k]) => k !== this.goalKind || this.rng.chance(0.2));
  const order = this.rng.shuffle(pool.map(([k]) => k));
  // where: the last area, or any other
  for (const k of order) {
    for (const a of this.rng.shuffle(this.areas.map((x) => x.i))) {
      const snap = this.snapshot();
      this.busy = new Set();
      try {
        GOAL[k].call(this, a, 'bonus');
        if (!this.model.done('bonus')) no('the bonus goal is not reached');
        this.bonusKind = k;
        return;
      } catch (e) {
        if (!(e instanceof Fail)) throw e;
        this.restore(snap);
      }
    }
  }
  no('no bonus goal');
};

// ---------- keeping and putting back the generator's state ----------

function clone(v, seen = new Map()) {
  if (v === null || typeof v !== 'object') return v;
  if (typeof v === 'function') return v;
  if (seen.has(v)) return seen.get(v);
  let out;
  if (v instanceof Map) { out = new Map(); seen.set(v, out); for (const [k, x] of v) out.set(k, clone(x, seen)); return out; }
  if (v instanceof Set) { out = new Set(); seen.set(v, out); for (const x of v) out.add(clone(x, seen)); return out; }
  if (Array.isArray(v)) { out = []; seen.set(v, out); for (const x of v) out.push(clone(x, seen)); return out; }
  out = Object.create(Object.getPrototypeOf(v));
  seen.set(v, out);
  for (const k of Object.keys(v)) out[k] = k === 'cfg' ? v[k] : clone(v[k], seen);
  return out;
}
Gen.prototype.snapshot = function () {
  return clone({
    model: this.model, world: this.world, areas: this.areas, reserved: this.reserved, keeps: this.keeps, mouths: this.mouths, touched: this.touched,
    posted: this.posted, spent: this.spent, tags: this.tags, steps: this.steps, bonusSteps: this.bonusSteps,
    whirlIds: this.whirlIds, hint: this.hint, goalUnit: this.goalUnit, busy: this.busy,
  });
};
Gen.prototype.restore = function (s) {
  const into = this.into === this.steps ? 'steps' : 'bonusSteps';
  const hook = this.model.drySwamp;
  Object.assign(this, s);
  this.into = this[into];
  this.model.drySwamp = hook;
};

// ---------- dressing the areas ----------

// Rounds off the areas' corners and bites into their edges, leaving the mouths.
Gen.prototype.shape = function () {
  for (const A of this.areas) {
    const edge = [];
    for (const k of A.tiles) {
      const [x, y] = k.split(',').map(Number);
      const onEdge = x === A.x0 || x === A.x1 || y === A.y0 || y === A.y1;
      if (onEdge) edge.push([x, y]);
    }
    const corners = [[A.x0, A.y0], [A.x1, A.y0], [A.x0, A.y1], [A.x1, A.y1]];
    const bites = corners.filter(() => this.rng.chance(0.65)).concat(this.rng.shuffle(edge).slice(0, this.rng.int(0, 3)));
    for (const [x, y] of bites) {
      const k = key(x, y);
      if (this.mouths.has(k) || DIRS.some(([dx, dy]) => this.mouths.has(key(x + dx, y + dy))) || this.keeps.has(k)) continue;
      if (DIRS.some(([dx, dy]) => this.world.areaOf[y + dy]?.[x + dx] === -2)) continue;
      A.tiles.delete(k);
      if (!this.areaJoined(A.i)) { A.tiles.add(k); continue; }
      this.world.set(x, y, '@');
      this.world.areaOf[y][x] = -1;
    }
  }
};

// Trees, rocks, rocky ground, swamp, ponds and (in the city) streets about the areas, each
// tile kept only if every place the solution goes to in the area can still be reached
// from the others.
Gen.prototype.decorate = function (density) {
  const rng = this.rng, look = this.look;
  const dens = new Set();
  for (const it of this.world.items) if (it.t === 'unit' && it.cls === 'monster' && it.kind !== 'boulder') {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) dens.add(key(it.at[0] + dx, it.at[1] + dy));
  }
  const used = new Set(this.trail || []);
  for (const s of this.steps.concat(this.bonusSteps)) {
    if (['plant', 'dig', 'build', 'push'].includes(s.op)) used.add(key(...s.at));
    if (s.op === 'push') for (const p of [s.at, s.stand]) for (const [dx, dy] of DIRS) used.add(key(p[0] + dx, p[1] + dy));
  }
  for (const A of this.areas) {
    const keeps = [...this.keeps].filter((k) => A.tiles.has(k) || this.world.areaOf[k.split(',')[1]]?.[k.split(',')[0]] === A.i);
    const ground = (x, y) => {
      const ch = this.world.at(x, y);
      return ch === '.' || ch === ':' || CHAR[ch] === 'street' || !!this.world.itemAt(x, y);
    };
    const label = (start) => {
      const seen = new Set([start]);
      const stack = [start.split(',').map(Number)];
      while (stack.length) {
        const [x, y] = stack.pop();
        for (const [dx, dy] of DIRS) {
          const k = key(x + dx, y + dy);
          if (!seen.has(k) && A.tiles.has(k) && ground(x + dx, y + dy)) { seen.add(k); stack.push([x + dx, y + dy]); }
        }
      }
      return seen;
    };
    // the keeps' pieces as they are
    const groups = [];
    const landKeeps = keeps.filter((k) => ground(...k.split(',').map(Number)));
    const done = new Set();
    for (const k of landKeeps) {
      if (done.has(k)) continue;
      const reach = label(k);
      const g = landKeeps.filter((j) => reach.has(j));
      for (const j of g) done.add(j);
      groups.push(g);
    }
    const joined = () => groups.every((g) => { const r = label(g[0]); return g.every((j) => r.has(j)); });
    const can = (x, y) => {
      const k = key(x, y);
      return A.tiles.has(k) && this.world.at(x, y) === '.' && !this.reserved.has(k) && !this.keeps.has(k) && !this.mouths.has(k) && !used.has(k) && !this.world.itemAt(x, y);
    };
    const tiles = [...A.tiles].map((k) => k.split(',').map(Number));
    const budget = Math.round(tiles.length * density);
    let placed = 0;
    const kinds = [['tree', 5], ['rock', 3], ['rocky', 2], ['pond', 1.5]];
    if (look.swamp) kinds.push(['swamp', 1.5]);
    for (let f = 0; f < 40 && placed < budget; f++) {
      const kind = rng.weighted(kinds);
      const ch = kind === 'tree' ? rng.pick(look.trees) : kind === 'rock' ? rng.pick(look.rocks) : kind === 'rocky' ? '_' : kind === 'swamp' ? '#' : rng.pick(['w', 'w', 'x']);
      let [x, y] = rng.pick(tiles);
      const len = rng.int(1, kind === 'pond' || kind === 'swamp' ? 3 : 4);
      for (let i = 0; i < len && placed < budget; i++) {
        if (can(x, y) && !(kind === 'swamp' && dens.has(key(x, y)))) {
          this.world.set(x, y, ch);
          if (joined()) placed++;
          else { this.world.set(x, y, '.'); break; }
        }
        const [dx, dy] = rng.pick(DIRS);
        x += dx; y += dy;
      }
    }
    if (look.city) this.streets(A, can);
  }
};

// Streets across an area, in the city.
Gen.prototype.streets = function (A, can) {
  const rows = [], cols = [];
  for (let y = A.y0 + 1; y < A.y1; y++) rows.push(y);
  for (let x = A.x0 + 1; x < A.x1; x++) cols.push(x);
  const ry = this.rng.chance(0.8) ? this.rng.pick(rows) : null;
  const cx = this.rng.chance(0.6) ? this.rng.pick(cols) : null;
  const road = (x, y) => {
    const k = key(x, y);
    return A.tiles.has(k) && !this.world.itemAt(x, y) && (this.world.at(x, y) === '.' || CHAR[this.world.at(x, y)] === 'street');
  };
  const plantUsed = new Set(this.steps.concat(this.bonusSteps).filter((s) => s.op === 'plant' || s.op === 'dig').map((s) => key(...s.at)));
  const put = (x, y, ch) => { if (road(x, y) && !plantUsed.has(key(x, y))) this.world.set(x, y, ch); };
  if (ry !== null) for (let x = A.x0; x <= A.x1; x++) put(x, ry, '\\');
  if (cx !== null) for (let y = A.y0; y <= A.y1; y++) put(cx, y, ry === y ? '+' : '/');
  // a square of cement
  if (this.rng.chance(0.5)) {
    const x0 = this.rng.int(A.x0, A.x1 - 1), y0 = this.rng.int(A.y0, A.y1 - 1);
    for (let y = y0; y < y0 + 2; y++) for (let x = x0; x < x0 + 2; x++) if (this.world.at(x, y) === '.' && !plantUsed.has(key(x, y))) put(x, y, '`');
  }
};

// ---------- checking it all, and the mission ----------

// Plays the whole solution, then the bonus, on a model of the finished map.
Gen.prototype.verify = function () {
  const m = new Model(this.cfg, this.world.grid, this.world.items, this.world.inventory);
  m.strict = true;
  try {
    for (const s of this.steps) m.play(s);
    if (!m.done('goal')) no('the goal is not reached');
    if (m.goals.some((g) => g.which === 'bonus' && g.done)) no('the bonus goal is reached too early');
    for (const s of this.bonusSteps) m.play(s);
    if (!m.done('bonus')) no('the bonus goal is not reached');
  } catch (e) {
    if (e instanceof StepError) no('verify: ' + e.message);
    throw e;
  }
  return m;
};

Gen.prototype.run = function () {
  this.reserved = new Set();
  this.keeps = new Set();
  this.mouths = new Set();
  this.touched = new Set();
  this.posted = new Set();
  this.whirlIds = 0;
  this.layout();
  for (const l of this.links) PREP[l.kind].call(this, l);
  this.shape();
  this.features();
  this.model = new Model(this.cfg, this.world.grid, [], {});
  this.model.strict = true;
  this.model.drySwamp = (tiles) => {
    for (const [x, y] of tiles) { this.world.set(x, y, '.'); this.model.setChar(x, y, '.'); }
    return true;
  };
  this.start();
  for (this.li = 0; this.li < this.links.length; this.li++) {
    const l = this.links[this.li];
    this.busy = new Set();
    RUN[l.kind].call(this, l);
    this.tags.add('link ' + l.kind);
    this.hint = l.kind === 'factory' ? this.hint : null;
  }
  this.goal();
  this.bonus();
  this.trail = this.verify().trail;
  const plain = this.world.grid.map((r) => r.slice());
  for (const dens of [0.3 + 0.05 * this.d, 0.12, 0]) {
    this.world.grid = plain.map((r) => r.slice());
    if (dens) this.decorate(dens);
    try {
      this.verify();
      this.density = dens;
      break;
    } catch (e) {
      if (!(e instanceof Fail) || !dens) throw e;
      (this.why || (this.why = [])).push(e.message);
    }
  }
  this.crop();
  for (const it of this.world.items) if (it.t === 'unit' && it.cls === 'monster') this.tags.add('monster ' + it.kind);
  for (const row of this.world.grid) for (const ch of row) this.tags.add('terrain ' + (ch === ':' ? 'goal' : CHAR[ch]));
  return this;
};

// Cuts the map down to what is on it, a tile of void round it, and moves everything to
// match.
Gen.prototype.crop = function () {
  const w = this.world;
  let x0 = w.W, y0 = w.H, x1 = -1, y1 = -1;
  for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
    if (w.grid[y][x] === '@' && !w.itemAt(x, y)) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const dx = 1 - x0, dy = 1 - y0;
  const W = x1 - x0 + 3, H = y1 - y0 + 3;
  if (!dx && !dy && W === w.W && H === w.H) return;
  const grid = Array.from({ length: H }, () => new Array(W).fill('@'));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y + dy][x + dx] = w.grid[y][x];
  w.grid = grid;
  w.W = W; w.H = H;
  const moved = new Set();
  const mv = (p) => { if (moved.has(p)) return; moved.add(p); p[0] += dx; p[1] += dy; };
  for (const it of w.items) mv(it.at);
  for (const s of this.steps.concat(this.bonusSteps)) {
    for (const k of ['to', 'at', 'stand', 'out']) if (s[k]) mv(s[k]);
    if (s.made) s.made.forEach(mv);
  }
  this.verify();
};

// Ground an area is shaped with before anything is put on it: a pond, a grove, an outcrop
// of rocks, a patch of rocky ground or swamp, each kept only if the area's open ground
// stays in one piece.
Gen.prototype.features = function () {
  const rng = this.rng, look = this.look;
  for (const A of this.areas) {
    const n = rng.int(1, 2 + (this.d > 1 ? 1 : 0));
    const kinds = [['pond', 3], ['grove', 3], ['outcrop', 2], ['rocky', 2]];
    if (look.swamp) kinds.push(['swamp', 2]);
    if (look.city) kinds.push(['plaza', 3]);
    for (let f = 0; f < n; f++) {
      const kind = rng.weighted(kinds);
      const size = rng.int(2, kind === 'pond' ? 6 : 4);
      const pick = () => kind === 'pond' ? rng.pick(['w', 'w', 'x']) : kind === 'grove' ? rng.pick(look.trees) : kind === 'outcrop' ? rng.pick(look.rocks) : kind === 'rocky' ? '_' : kind === 'plaza' ? '`' : '#';
      const tiles = [...A.tiles].map((k) => k.split(',').map(Number));
      let [x, y] = rng.pick(tiles);
      for (let i = 0; i < size * 2 && i < 12; i++) {
        const k = key(x, y);
        const nearMouth = DIRS.concat([[0, 0]]).some(([dx, dy]) => this.mouths.has(key(x + dx, y + dy))) || DIRS.some(([dx, dy]) => this.world.areaOf[y + dy]?.[x + dx] === -2);
        if (A.tiles.has(k) && this.world.at(x, y) === '.' && !nearMouth && !this.keeps.has(k)) {
          const ch = pick();
          this.world.set(x, y, ch);
          if (!this.groundJoined(A.i)) this.world.set(x, y, '.');
          else this.tags.add('feature ' + kind);
        }
        const [dx, dy] = rng.pick(DIRS);
        x += dx; y += dy;
      }
    }
  }
};
// Is an area's open ground in one piece?
Gen.prototype.groundJoined = function (a) {
  const A = this.areas[a];
  const ground = [...A.tiles].filter((k) => { const [x, y] = k.split(',').map(Number); const ch = this.world.at(x, y); return ch === '.' || CHAR[ch] === 'street'; });
  if (!ground.length) return false;
  const set = new Set(ground);
  const seen = new Set([ground[0]]);
  const stack = [ground[0].split(',').map(Number)];
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of DIRS) {
      const k = key(x + dx, y + dy);
      if (!seen.has(k) && set.has(k)) { seen.add(k); stack.push([x + dx, y + dy]); }
    }
  }
  return seen.size === ground.length && ground.length >= A.tiles.size * 0.6;
};
