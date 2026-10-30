// Rando v4's generator (Rando v1's, v2's and v3's are kept in src/online/puzzle/v1/, v2/ and v3/):
// a mission's layout, the puzzles on its way, its goal and bonus goal, and
// the solution to all of them, each step played on a live model of the rules as it is
// written (src/online/puzzle/model.js).
//
// A mission is a chain of areas, of all sizes and shaped like the games' own islands (see
// "the shape of the land").  Each link between two areas is one of the game's
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
// A crab or gator may roam the whole of an area beyond the first, kept in by the way there:
// before anything goes in, two defenders are built there from the bricks lying in it and take
// it apart (hazards, hunt).  What a unit is built from is found in different ways: bricks already by its site, bricks
// to be fetched, a windmill or garage that makes the energy bricks or wheels that are
// short, a unit taken apart for its bricks, a monster taken apart by a defender.  Plans
// are in hand or lie on the map to be fetched.  The goal is mostly a unit brought to a
// place from well away, or a building built on it from bricks brought to it; rarely a
// monster let onto a yellow goal area or a boulder pushed onto it (goalPool); the bonus
// goal is another of those.

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
    // how the land is dressed, as the originals' missions differ: open, wooded, rocky or wet
    // (mountains and other rocks only now and then, as in theirs)
    this.style = rng.weighted([['open', 3], ['forest', 3], ['rocky', 2], ['wet', 2]]);
  }
  dressing() {
    const k = { open: [3, 0.4, 2, 2, 0.6], forest: [6, 0.4, 1, 1, 1], rocky: [2, 1.2, 6, 1, 1], wet: [3, 0.4, 1, 5, 1] }[this.style];
    return { kinds: [['tree', k[0]], ['rock', k[1]], ['rocky', k[2]], ['pond', k[3]]], density: k[4] };
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
    if (['pick', 'drop', 'push', 'dig', 'fill', 'uproot', 'plant', 'regate'].includes(s.op)) this.touched.add(key(...s.at));
    if (s.op === 'regate') this.touched.add(key(...s.stand));
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
  go(name, to) { this.fuel(name, to); this.play({ op: 'go', unit: name, to }); }
  act(op, name, at, opts) {
    const stand = this.standFor(name, at, opts);
    if (this.fuel(name, stand)) return this.act(op, name, at, opts);
    this.play({ op, unit: name, at, stand });
  }
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
    if (!cands.length) no('no room in area ' + a + (o.why ? ' for ' + o.why : ''));
    const p = this.rng.pick(cands);
    if (!o.noReserve) this.reserve(p);
    return p;
  }
  // Puts an item on the map, in the world and the live model alike.
  add(it) {
    if (it.t === 'unit' && !it.name) it.name = this.world.name(it.cls === 'monster' ? 'm' : it.cls === 'building' ? 'b' : 'u');
    const k = key(it.at[0], it.at[1]);
    // (a unit on the map from the start is there while a monster in the field still roams: not
    // where it can get to, nor beside it)
    if (it.t === 'unit' && it.cls !== 'monster' && this.areas) {
      for (const A of this.areas) {
        if (!A.roams) continue;
        if (A.roams.has(k) || DIRS.some(([dx, dy]) => A.roams.has(key(it.at[0] + dx, it.at[1] + dy)))) no('a unit where a monster roams from the start');
      }
    }
    if (this.world.itemAt(it.at[0], it.at[1])) no('two things on one tile');
    if ((it.t === 'pile' || it.t === 'plan') && this.touched.has(k)) no('a tile used before');
    if (it.t === 'unit' && this.model && this.model.trail.has(k)) no('a tile gone over before');
    this.world.items.push(it);
    if (this.model) {
      this.model.addItem(it);
      if (it.t === 'unit' && it.cls === 'monster') this.model.afterTerrain();
    }
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
    if (mayFetch && fetchers.length && this.rng.chance(0.55 + 0.15 * this.d)) {
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
      try { site = this.spot(a, { near: this.hint.at, within: 2, spacing: 0, test: (x, y) => this.roomAround(x, y) >= 3 }); } catch (e) { site = null; }
      if (site) this.tags.add('use the factory bricks');
    }
    if (!site) {
      const tries = [[opts.within ?? 6, 4, 1], [10, 3, 1], [14, 3, 0]];
      for (const [within, room, spacing] of tries) {
        try { site = this.spot(a, { near, within, spacing, test: (x, y) => this.roomAround(x, y) >= room && !water }); break; } catch (e) { if (!(e instanceof Fail)) throw e; }
      }
      if (!site) no('no room in area ' + a + ' for a ' + kinds.join('/'));
    }
    return this.make(what, a, site, opts);
  }
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
    // (more often than not, some of it to be fetched from elsewhere)
    if (!opts.full && (opts.partial || this.rng.chance(0.5 + 0.15 * this.d))) {
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
    else if (opts.way === 'garage' || opts.way === 'windmill') {
      try {
        this.fromProducer(a, site, opts.way);
      } catch (e) {
        if (!(e instanceof Fail) || !/^no room for a/.test(e.message)) throw e;
        this.kit(site, missing);
      }
    } else if (opts.way === 'recycle') this.fromRecycle(site, missing);
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
  fromLoose(a, site, bricks, o = {}) {
    const total = Object.values(bricks).reduce((x, y) => x + y, 0);
    const carrier = o.carrier || this.carrierFor(site);
    if (!carrier) no('nothing to carry');
    const u = this.unit(carrier);
    const cap = this.cfg[u.kind].carries;
    const trips = Math.ceil(total / cap);
    const far = o.within || (trips > 3 ? 7 : 11);
    const at = this.spot(a, { near: site, within: far, min: o.min || 4, why: 'a pile', test: (x, y) => this.model.dist(u, [x, y]) > 0 || DIRS.some(([dx, dy]) => this.model.dist(u, [x + dx, y + dy]) >= 0) });
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

// ---------- energy ----------

// What recharges each kind of unit: buildings, and the repairbot.
const RECHARGERS = { gas_station: 'normal', robot_lab: 'normal', marina: 'water', repairbot: 'normal' };

// If a unit would come back from a trip with too little energy, it recharges first: beside
// a building that recharges it (or a repairbot), made for it if there is none.  Answers
// whether it did.
Gen.prototype.fuel = function (name, to) {
  const u = this.unit(name);
  if (!u || !u.energy.length || this.fueling) return false;
  const c = this.cfg[u.kind];
  const move = c.energy.move || 0;
  const d = this.model.dist(u, to);
  if (d < 0) return false;
  const after = this.model.energyOf(u) - d * move - 0.12 * (u.dist + d) * move - 6;
  if (after >= 14) return false;
  const kinds = Object.keys(RECHARGERS).filter((k) => (this.cfg[k].recharges || []).includes(u.kind));
  if (!kinds.length) return false;
  this.fueling = true;
  const wasBusy = this.busy && this.busy.has(name);
  if (this.busy) this.busy.add(name);
  try {
    // one there already, within reach
    for (const r of Object.values(this.model.units)) {
      if (!kinds.includes(r.kind) || r === u) continue;
      const stand = DIRS.map(([dx, dy]) => [r.x + dx, r.y + dy]).find((p) => { const dd = this.model.dist(u, p); return dd >= 0 && this.model.energyOf(u) - dd * move * 1.15 > 14; });
      if (stand) { this.play({ op: 'recharge', unit: name, from: r.name, stand }); this.tags.add('recharge at a ' + r.kind); return true; }
    }
    // or one made beside where it is
    const a = this.areaNear(u);
    const what = this.rng.pick(kinds.filter((k) => RECHARGERS[k] === (c.terrain.includes('normal') ? 'normal' : 'water')));
    if (!what) return false;
    let site;
    if (RECHARGERS[what] === 'water') site = this.waterSite(a, u);
    else site = this.spot(a, { near: [u.x, u.y], within: 5, why: 'a recharger', test: (x, y) => this.roomAround(x, y) >= 4 && this.model.dist(u, [x, y]) > 0 });
    const r = this.make(what, a, site, { fetchPlan: false });
    const rr = this.unit(r);
    const stand = DIRS.map(([dx, dy]) => [rr.x + dx, rr.y + dy]).find((p) => this.model.dist(u, p) >= 0);
    if (!stand) no('cannot get beside the ' + what);
    this.play({ op: 'recharge', unit: name, from: r, stand });
    this.tags.add('recharge at a ' + what);
    return true;
  } finally {
    this.fueling = false;
    if (this.busy && !wasBusy) this.busy.delete(name);
  }
};
// The area a unit is in, or the nearest.
Gen.prototype.areaNear = function (u) {
  const a = this.world.areaOf[u.y][u.x];
  if (a >= 0) return a;
  let best = 0, bd = 1e9;
  for (const A of this.areas) for (const k of A.tiles) {
    const [x, y] = k.split(',').map(Number);
    const d = Math.abs(x - u.x) + Math.abs(y - u.y);
    if (d < bd) { bd = d; best = A.i; }
  }
  return best;
};
// A water tile beside the land, near a boat, for a marina.
Gen.prototype.waterSite = function (a, u) {
  const out = [];
  for (let y = 0; y < this.world.H; y++) for (let x = 0; x < this.world.W; x++) {
    const k = key(x, y);
    if (this.model.grid[y][x] !== 'w' || this.model.occ[y][x] || this.model.res.has(k) || this.reserved.has(k) || this.touched.has(k) || this.world.itemAt(x, y)) continue;
    if (!DIRS.some(([dx, dy]) => this.areas[a].tiles.has(key(x + dx, y + dy)) && this.isFree(x + dx, y + dy, 0))) continue;
    const d = this.model.dist(u, [x, y]);
    if (d > 1 && d < 8) out.push([x, y]);
  }
  if (!out.length) no('no room for a marina');
  const p = this.rng.pick(out);
  this.reserve(p);
  return p;
};

// ---------- the layout ----------

// What opens each kind of link.
export const OPENERS = {
  rock: ROCK_CROSSERS, fill: ['steamshovel'], trees: ['treebot'], boulders: ['dozer'], factory: ['factory'],
  ferry: BOATS, whirl: BOATS, swim: SWIMMERS, swamp: ['defender'], guard: ['freezebot'],
};

// How often each kind of link comes, by the look: what the games' own worlds are made of
// (World Builder's first worlds: rocks, rivers, trees; its ocean: water and whirlpools; its
// prehistoric world: swamps and rocky ground; World Builder 2's jungle: trees; its city:
// factories).  Boulders to push are a puzzle now and then, not the rule; a monster held by a
// freezebot only in the harder missions.
const LINK_WEIGHTS = {
  grass: { rock: 3, fill: 3, trees: 3, boulders: 0.8, factory: 0.4, ferry: 2.5, whirl: 0.6, swim: 2, swamp: 0.4, guard: 0.5 },
  prehistoric: { rock: 4, fill: 2.5, trees: 1.5, boulders: 0.8, factory: 0.3, ferry: 2, whirl: 0.5, swim: 2, swamp: 3, guard: 0.6 },
  jungle: { rock: 2, fill: 2, trees: 4, boulders: 0.8, factory: 1.5, ferry: 2, whirl: 0.6, swim: 2.5, swamp: 1, guard: 0.8 },
  city: { rock: 2, fill: 2.5, trees: 2.5, boulders: 0.8, factory: 3, ferry: 2, whirl: 0.6, swim: 1.5, swamp: 0, guard: 0.5 },
  ocean: { rock: 0.8, fill: 2.5, trees: 0.6, boulders: 0.4, factory: 0.2, ferry: 5, whirl: 3, swim: 4, swamp: 0, guard: 0.5 },
};

Gen.prototype.chooseLinks = function (n) {
  const d = this.d;
  const pool = Object.entries(LINK_WEIGHTS[this.look.name])
    .map(([k, w]) => [k, k === 'guard' ? w * (d - 1) : k === 'whirl' ? w * (0.5 + d / 2) : w])
    .filter(([, w]) => w > 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < 20; t++) {
      const k = this.rng.weighted(pool);
      if (out.includes(k) && t < 15) continue;
      // (a water link, or a swamp, not first in the easiest missions)
      if (d === 1 && i === 0 && ['whirl', 'swamp'].includes(k)) continue;
      out.push(k);
      break;
    }
  }
  return out;
};

// The kinds of goal (and bonus goal) and how often each comes, as the games' own missions
// have them: most bring a unit somewhere or build something there; a monster brought to a
// place, or a boulder, is rare, and only in the harder missions.
Gen.prototype.goalPool = function () {
  return [['reach', 46], ['build', 30], ['water', this.look.ocean ? 26 : 12],
    ['monster', this.d >= 2 ? 4 : 0], ['boulder', this.d >= 2 ? 1.5 : 0]].filter(([, w]) => w > 0);
};

// Void left round the map while it is made, for pens, islets and coasts (cropped off where
// nothing is put).
const MARGIN = 6;

Gen.prototype.layout = function () {
  const rng = this.rng, d = this.d;
  // (more than Rando v2's in the harder missions: Rando v3's fewer made its missions too
  // short to be any trouble.  The code says how many, not the attempt: a long chain turned
  // down is tried again as long, not swapped for an easier one.)
  let h = 7;
  for (const ch of this.c.code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const n = d === 1 ? 2 + (h % 2) : d === 2 ? 3 + (h % 3) : 4 + (h % 3);
  const kinds = this.chooseLinks(n - 1);
  const w = walk(rng, n, kinds.map((k) => k === 'whirl'));
  if (!w) no('no walk');
  const { cols, rows, cells } = w;
  // cells of all sizes, from an islet's to a wide island's
  const colW = Array.from({ length: cols }, () => rng.int(5, cols > 3 ? 9 : 12));
  const rowH = Array.from({ length: rows }, () => rng.int(5, rows > 2 ? 8 : 10));
  // the goal and bonus goal, chosen now: an area with a goal has room for it
  const pool = this.goalPool();
  this.goalKind0 = rng.weighted(pool);
  const other = pool.filter(([k]) => k !== this.goalKind0 || rng.chance(0.15));
  this.bonusKind0 = rng.weighted(other.length ? other : pool);
  this.bonusArea0 = rng.int(0, n - 1);
  for (const ai of [n - 1, this.bonusArea0]) {
    const [c, r] = cells[ai];
    colW[c] = Math.max(colW[c], 7);
    rowH[r] = Math.max(rowH[r], 6);
  }
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
  for (const l of links) if (l.kind === 'guard') {
    const [ac, ar] = cells[l.a], [bc, br] = cells[l.b];
    if (ar === br) tc[Math.min(ac, bc)] = 3; else tr[Math.min(ar, br)] = 3;
  }
  const W = 2 + colW.reduce((a, b) => a + b, 0) + tc.reduce((a, b) => a + b, 0);
  const H = 2 + rowH.reduce((a, b) => a + b, 0) + tr.reduce((a, b) => a + b, 0);
  if (W > 48 || H > 32) no('too big');
  const colX = [], rowY = [];
  let x = 1 + MARGIN;
  for (let c = 0; c < cols; c++) { colX.push(x); x += colW[c] + (tc[c] || 0); }
  let y = 1 + MARGIN;
  for (let r = 0; r < rows; r++) { rowY.push(y); y += rowH[r] + (tr[r] || 0); }
  this.world = new World(W + 2 * MARGIN, H + 2 * MARGIN, this.look);
  // each area in its cell: flush with it on the sides a link goes from, drawn in by a tile
  // or two on the others (so that the areas are of different sizes and out of line)
  const sides = cells.map(() => new Set());
  for (const l of links) if (l.adj && l.kind !== 'whirl') {
    const [ac, ar] = cells[l.a], [bc, br] = cells[l.b];
    if (ar === br) { sides[l.a].add(bc > ac ? 'R' : 'L'); sides[l.b].add(bc > ac ? 'L' : 'R'); }
    else { sides[l.a].add(br > ar ? 'B' : 'T'); sides[l.b].add(br > ar ? 'T' : 'B'); }
  }
  this.areas = cells.map(([c, r], i) => {
    const s = sides[i];
    const cut = (side) => (s.has(side) ? 0 : rng.int(0, 2));
    let x0 = colX[c], x1 = colX[c] + colW[c] - 1, y0 = rowY[r], y1 = rowY[r] + rowH[r] - 1;
    const L = cut('L'), R = cut('R'), T = cut('T'), B = cut('B');
    if (x1 - x0 + 1 - L - R >= 4 && (i !== n - 1 && i !== this.bonusArea0 || x1 - x0 + 1 - L - R >= 7)) { x0 += L; x1 -= R; }
    if (y1 - y0 + 1 - T - B >= 4 && (i !== n - 1 && i !== this.bonusArea0 || y1 - y0 + 1 - T - B >= 6)) { y0 += T; y1 -= B; }
    return { i, c, r, x0, y0, x1, y1, tiles: new Set(), cell: [colX[c], rowY[r], colX[c] + colW[c] - 1, rowY[r] + rowH[r] - 1] };
  });
  // two linked areas face each other along enough of their sides for the link
  for (const l of links) if (l.adj && l.kind !== 'whirl') {
    const A = this.areas[l.a], B = this.areas[l.b];
    if (A.r === B.r && Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0) + 1 < 6) for (const X of [A, B]) { X.y0 = X.cell[1]; X.y1 = X.cell[3]; }
    if (A.c === B.c && Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) + 1 < 6) for (const X of [A, B]) { X.x0 = X.cell[0]; X.x1 = X.cell[2]; }
  }
  for (const a of this.areas) {
    for (let yy = a.y0; yy <= a.y1; yy++) for (let xx = a.x0; xx <= a.x1; xx++) {
      this.world.set(xx, yy, '.');
      this.world.areaOf[yy][xx] = a.i;
      a.tiles.add(key(xx, yy));
    }
  }
  this.links = links;
  for (const l of links) if (l.adj && l.kind !== 'whirl') this.strip(l);
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
    const at = this.spot(side, { near: mouth, within: 5, why: 'a steamshovel' });
    u = this.add({ t: 'unit', cls: 'vehicle', kind: 'steamshovel', at }).name;
    this.tags.add('help from the far side');
  } else u = this.need(['steamshovel'], l.a, mouth);
  for (const lat of l.lats) for (const dep of depths) {
    let pit;
    for (const within of [4, 7, 10]) {
      try { pit = this.spot(side, { near: mouth, within, edge: within < 10, why: 'a pit', test: (x, y) => !this.mouths.has(key(x, y)) }); break; } catch (e) { if (!(e instanceof Fail) || within === 10) throw e; }
    }
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
    const at = this.spot(side, { near: mouth, within: 5, why: 'a treebot' });
    u = this.add({ t: 'unit', cls: 'vehicle', kind: 'treebot', at }).name;
    this.tags.add('help from the far side');
  } else u = this.need(['treebot'], l.a, mouth);
  for (const lat of l.lats) for (const dep of depths) {
    this.act('uproot', u, l.tile(lat, dep));
    let spot;
    for (const within of [3, 5, 8]) {
      try { spot = this.spot(side, { near: this.unit(u) ? [this.unit(u).x, this.unit(u).y] : mouth, within, edge: within < 8, why: 'a tree', test: (x, y) => !this.mouths.has(key(x, y)) }); break; } catch (e) { if (!(e instanceof Fail) || within === 8) throw e; }
    }
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
  const want = Math.min(1 + this.d, 3);
  for (let tries = 0; tries < 150; tries++) {
    const lats = this.lanes(l, w);
    const rocks = new Set(), stones = new Set();
    // a line across the room, each lane shut within a tile of the next (so nothing gets
    // round), of boulders and rocks; and a boulder or a rock more about it
    let dep = this.rng.int(0, l.t - 1);
    for (const lat of lats) {
      dep = Math.max(0, Math.min(l.t - 1, dep + this.rng.int(-1, 1)));
      (this.rng.chance(0.65) ? stones : rocks).add(lat + ',' + dep);
    }
    if (!stones.size) continue;
    for (let i = this.rng.int(0, 2); i > 0; i--) {
      const k = this.rng.pick(lats) + ',' + this.rng.int(0, l.t - 1);
      if (!rocks.has(k) && !stones.has(k)) (this.rng.chance(0.6) ? stones : rocks).add(k);
    }
    const sol = sokoban(lats, l.t, rocks, stones);
    if (!sol || sol.length < want - (tries > 100 ? 1 : 0)) continue;
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
  l.ground = this.rng.pick(['.', '.', '_', 'w']);
  const choices = l.ground === '.' ? water : l.ground === 'w' ? ['crab', 'lion', 'scorpion', 'trex'] : land.concat(water);
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
  const by = l.tile(l.lats[0], 1);
  // a defender may take it apart while it is frozen (its bricks left in its den), and the
  // freezebot is free again
  if (l.ground === '.' && this.d > 1 && this.rng.chance(0.4)) {
    const m = Object.values(this.model.units).find((x) => x.x === l.den[0] && x.y === l.den[1]);
    const df = this.need(['defender'], l.a, mouth);
    this.play({ op: 'attack', unit: df, target: m.name, stand: by });
    this.go(df, this.spot(l.a, { near: mouth, within: 6, spacing: 0, noReserve: true, why: 'the defender', test: (x, y) => !this.mouths.has(key(x, y)) && this.model.dist(this.unit(df), [x, y]) > 0 }));
    this.posted.delete(fz);
    this.tags.add('defender takes a monster apart');
  }
  let u;
  if (l.ground === 'w') {
    // over the water past it: a boat with bricks, or a swimmer for a plan
    if (this.rng.chance(0.6)) {
      const yard = l.tile(l.lats[0], 0);
      const bank = [l.tile(l.lats[0] - 1, -1), l.tile(l.lats[0], -1), l.tile(l.lats[0] + 1, -1)].filter(([x, y]) => this.world.areaOf[y]?.[x] === l.a);
      const boat = this.boat(l.a, yard, bank);
      this.busy.add(boat);
      return [this.deliver(l.a, boat, l.b, l.tile(l.lats[0], l.t - 1), l.tile(l.lats[0], l.t), bank)];
    }
    u = this.need(SWIMMERS, l.a, mouth, { within: 5 });
    this.cross(u, l);
    return [this.landing(l.b, u)];
  }
  if (l.ground === '_') u = this.need(ROCK_CROSSERS, l.a, mouth);
  else u = this.have(['forklift', 'dumptruck', 'buggy', 'dirtbuggy', 'dozer', 'steamshovel', 'treebot'], mouth) || this.need(CARRIERS, l.a, mouth);
  this.cross(u, l);
  return [u];
};


// ---------- moving about ----------

// Takes a unit over a link into the area beyond it.
Gen.prototype.cross = function (u, l) {
  const mouthB = l.tile(l.lats[0], l.t);
  const to = this.spot(l.b, { near: mouthB, within: 4, spacing: 0, noReserve: true, why: 'crossing', test: (x, y) => !this.mouths.has(key(x, y)) && this.model.dist(this.unit(u), [x, y]) > 0 });
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
  let cargoAt = null;
  const carrier = this.carrierFor(bank && bank[0] ? bank[0] : land);
  let drop = null;
  try { drop = this.spot(a, { spacing: 0, why: 'the boat', test: (x, y) => pickable(x, y) }); } catch (e) { if (!(e instanceof Fail)) throw e; }
  if (drop && carrier && this.rng.chance(0.5)) {
    const from = this.spot(a, { near: drop, within: 7, min: 3, why: 'cargo' });
    this.add({ t: 'pile', at: from, bricks: short });
    this.haul(carrier, from, drop);
    this.tags.add('haul to the boat');
    cargoAt = drop;
  } else if (drop) {
    cargoAt = drop;
    this.add({ t: 'pile', at: cargoAt, bricks: short });
  } else {
    // floating in the water, for the boat to pick up from beside it
    const wet = [];
    for (let y = 0; y < this.world.H; y++) for (let x = 0; x < this.world.W; x++) {
      const k = key(x, y);
      if (this.model.grid[y][x] !== 'w' || this.reserved.has(k) || this.touched.has(k) || this.model.trail.has(k) || this.model.res.has(k) || this.model.occ[y][x] || this.world.itemAt(x, y)) continue;
      const d = this.model.dist(boatU, [x, y]);
      if (d > 0 && d < 12 && DIRS.some(([dx, dy]) => this.model.dist(boatU, [x + dx, y + dy]) >= 0 && !(x + dx === boatU.x && y + dy === boatU.y && false))) wet.push([x, y]);
    }
    if (!wet.length) no('no room for the cargo');
    cargoAt = this.rng.pick(wet);
    this.add({ t: 'pile', at: cargoAt, bricks: short, water: true });
    this.tags.add('bricks afloat');
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
  const planAt = this.spot(b, { why: 'a plan', test: (x, y) => this.model.dist(unit, [x, y]) > 0 });
  this.add({ t: 'plan', at: planAt, what, n: 1 });
  this.go(u, planAt);
  this.tags.add('fetch plan');
  const site = this.spot(b, { near: planAt, within: 7, min: 2, why: 'a landing kit', test: (x, y) => this.roomAround(x, y) >= 4 });
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
    if (tiles.some(([x, y]) => !A.tiles.has(key(x, y)) || this.mouths.has(key(x, y)) || this.world.at(x, y) !== '.' || this.reserved.has(key(x, y)) || this.keeps.has(key(x, y)) || this.world.itemAt(x, y) || (this.model && (this.model.trail.has(key(x, y)) || this.model.res.has(key(x, y)) || this.model.occ[y][x])))) continue;
    if (!this.world.inside(wx, wy) || wx < 1 || wy < 1 || wx > this.world.W - 2 || wy > this.world.H - 2) continue;
    if (this.world.areaOf[wy][wx] !== -1 || this.world.at(wx, wy) !== '@' && !SOLID.has(this.world.at(wx, wy))) continue;
    // the whirlpool's other sides: nothing a boat goes on
    if (DIRS.some(([dx, dy]) => { const x = wx + dx, y = wy + dy; return !tiles.some(([p, q]) => p === x && q === y) && (this.world.areaOf[y]?.[x] ?? -1) !== -1; })) continue;
    // the rest of the area still in one piece
    for (const [x, y] of tiles) { this.world.set(x, y, 'w'); A.tiles.delete(key(x, y)); }
    if (!this.areaJoined(a) || (this.model && !this.groundJoined(a))) {
      for (const [x, y] of tiles) { this.world.set(x, y, '.'); A.tiles.add(key(x, y)); }
      continue;
    }
    if (this.model) for (const [x, y] of tiles) this.model.setChar(x, y, 'w');
    this.setGround(wx, wy, '.');
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
  const at = this.spot(0, { inner: true, why: 'the start' });
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
  this.startKind = this.unit('u0').kind;
  this.tags.add('start ' + this.startKind);
};

// ---------- goals ----------

// Each kind of goal (and bonus goal) is prepared before anything is put on the map, so
// that the room it needs is kept for it, and run once the links are dealt with.
const GOAL_PREP = {};
const GOAL_RUN = {};

// A tile of open ground nothing has been put on or claimed.
Gen.prototype.clearTile = function (x, y) {
  const k = key(x, y);
  if (this.world.at(x, y) !== '.' || this.reserved.has(k) || this.mouths.has(k) || this.world.itemAt(x, y)) return false;
  if (this.model && (this.model.occ[y][x] || this.model.res.has(k) || this.touched.has(k) || this.model.trail.has(k))) return false;
  return true;
};

// A site with the eight tiles round it clear, claimed for later (for a kit of bricks).
Gen.prototype.holdBlock = function (a, near, within = 99) {
  const A = this.areas[a];
  const cands = [...A.tiles].map((k) => k.split(',').map(Number)).filter(([x, y]) => {
    if (near && man([x, y], near) > within) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!A.tiles.has(key(x + dx, y + dy)) || !this.clearTile(x + dx, y + dy)) return false;
    return true;
  });
  if (!cands.length) no('no room to build');
  const site = this.rng.pick(cands);
  const held = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const p = [site[0] + dx, site[1] + dy]; this.reserve(p); held.push(p); }
  return { site, held };
};
Gen.prototype.release = function (held, keep) {
  for (const p of held) if (!keep || p[0] !== keep[0] || p[1] !== keep[1]) this.reserved.delete(key(...p));
};

// A nook off an area's edge: a tile of ground with nothing round it but the area.
Gen.prototype.nook = function (a) {
  const A = this.areas[a];
  const cands = [];
  for (const k of A.tiles) {
    const [x, y] = k.split(',').map(Number);
    if (!this.clearTile(x, y) && !(this.model && this.world.at(x, y) === '.' && !this.reserved.has(k) && !this.mouths.has(k))) continue;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!this.world.inside(nx, ny) || nx < 1 || ny < 1 || nx > this.world.W - 2 || ny > this.world.H - 2) continue;
      if (this.world.areaOf[ny][nx] !== -1) continue;
      // its other sides: off the map's ground
      const others = DIRS.filter(([ex, ey]) => ex !== -dx || ey !== -dy).map(([ex, ey]) => [nx + ex, ny + ey]);
      if (others.some(([p, q]) => (this.world.areaOf[q]?.[p] ?? -1) !== -1)) continue;
      cands.push([[nx, ny], [x, y]]);
    }
  }
  if (!cands.length) no('no nook');
  const [n, e] = this.rng.pick(cands);
  this.setGround(n[0], n[1], '.');
  this.world.areaOf[n[1]][n[0]] = -3;
  this.reserve(n);
  this.keep(e);
  return { n, e };
};

// A unit brought to a nook.
GOAL_PREP.reach = function (a) {
  return this.nook(a);
};
GOAL_RUN.reach = function (g) {
  const { a, which, n } = g;
  let u = null;
  const units = Object.values(this.model.units).filter((x) => x.cls === 'vehicle' && !this.posted.has(x.name) && !this.spent.has(x.name) && this.model.dist(x, n) >= 6);
  if (units.length && this.rng.chance(which === 'bonus' ? 0.55 : 0.45)) {
    // the farthest away, mostly
    units.sort((p, q) => this.model.dist(q, n) - this.model.dist(p, n));
    u = (this.rng.chance(0.7) ? units[0] : this.rng.pick(units)).name;
  } else {
    // one made for it, well away from the goal, so that bringing it is a trip of its own:
    // an animal, mostly
    const kinds = this.rng.chance(0.5) ? ['duck', 'frog', 'snail'] : ['buggy', 'forklift', 'dirtbuggy', 'dozer', 'steamshovel', 'treebot', 'freezebot', 'repairbot', 'defender', 'dumptruck'];
    const what = this.rng.pick(kinds);
    let site = null, area = a;
    const far = this.farSite(what, n);
    if (far) { site = [far[0], far[1]]; area = far[2]; }
    else site = this.spot(a, { why: 'a goal unit', test: (x, y) => this.roomAround(x, y) >= 4 && man([x, y], n) >= 5 });
    u = this.make(what, area, site, { partial: true });
    this.tags.add('made for the ' + which + ': ' + what);
  }
  const kind = this.unit(u).kind;
  const want = this.rng.chance(0.15) ? 'anything' : kind;
  this.add({ t: 'goal', which, at: n, want });
  this.go(u, n);
  this.tags.add(which + ': reach ' + (want === 'anything' ? 'anything' : kind));
};

// A site to build a unit at, well away from where it is to go: anywhere on the map that it
// can drive there from, far but not past all reason.  [x, y, area] or null.
Gen.prototype.farSite = function (what, to, min = 7, max = 34) {
  const probe = { name: '#probe', cls: 'vehicle', kind: what, x: 0, y: 0, energy: [100], cargo: { bricks: {}, energy: [] }, dist: 0 };
  const cands = [];
  for (const A of this.areas) for (const k of A.tiles) {
    const [x, y] = k.split(',').map(Number);
    if (man([x, y], to) < min || !this.isFree(x, y) || this.roomAround(x, y) < 4) continue;
    if (!this.cfg[what].terrain.includes(CHAR[this.model.grid[y][x]])) continue;
    probe.x = x; probe.y = y;
    let d = -1;
    try { d = this.model.dist(probe, to); } catch (e) { if (!(e instanceof StepError)) throw e; }
    if (d >= min && d <= max) cands.push([x, y, A.i]);
  }
  if (!cands.length) return null;
  const p = this.rng.pick(cands);
  this.reserve([p[0], p[1]]);
  return p;
};

// A building built on a place: its plan to be had, and most of its bricks brought to it from
// piles well away (by the biggest carrier there is, or one made for it), as the games' own
// missions have it.
GOAL_PREP.build = function (a) {
  const A = this.areas[a];
  const cands = [...A.tiles].map((k) => k.split(',').map(Number)).filter(([x, y]) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!A.tiles.has(key(x + dx, y + dy)) || !this.clearTile(x + dx, y + dy)) return false;
    return true;
  });
  if (!cands.length) no('no room to build');
  const site = this.rng.pick(cands);
  const held = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const p = [site[0] + dx, site[1] + dy]; this.reserve(p); held.push(p); }
  return { site, held, what: this.rng.pick(GOAL_BUILDINGS) };
};
GOAL_RUN.build = function (g) {
  const { a, which, site, what } = g;
  // the room kept for it, given back for its bricks; its sides kept clear (of what a factory
  // would take, a windmill or garage fill, a nursery plant)
  for (const p of g.held) if (p[0] !== site[0] || p[1] !== site[1]) this.reserved.delete(key(...p));
  this.add({ t: 'goal', which, at: site, want: what });
  const recipe = this.cfg[what].recipe;
  this.plan(what, a, true);
  // a carrier big enough to bring them
  let carrier = this.carrierFor(site, 10);
  if (!carrier) {
    // (what a carrier that could not be made left on the map, and its plan, taken back)
    const snap = this.snapshot();
    try { carrier = this.need(['dumptruck', 'forklift'], a, site); } catch (e) { if (!(e instanceof Fail)) throw e; this.restore(snap); carrier = this.carrierFor(site); }
  }
  if (carrier) {
    const cap = this.cfg[this.unit(carrier).kind].carries;
    const far = {};
    let total = 0;
    for (const k of this.rng.shuffle(Object.keys(recipe))) {
      if (k === 'energy') continue;
      let n = Math.round(recipe[k] * (0.55 + 0.4 * this.rng.f()));
      n = Math.min(n, cap * 6 - total);
      if (n > 0) { far[k] = n; total += n; }
    }
    const near = {};
    for (const [k, n] of Object.entries(recipe)) if (n - (far[k] || 0) > 0) near[k] = n - (far[k] || 0);
    if (Object.keys(near).length) this.kit(site, near);
    if (total) this.fromLoose(a, site, far, { carrier, min: 6, within: 14 });
  } else this.supply(a, site, recipe, { partial: true });
  this.play({ op: 'build', what, at: site, as: this.world.name('b') });
  this.tags.add('build ' + what);
  const sides = DIRS.map(([dx, dy]) => [site[0] + dx, site[1] + dy]);
  for (const p of sides) this.reserve(p);
  this.tags.add(which + ': build ' + what);
};

// A monster's den and a yellow goal area beside it, off an area's shore, kept apart by a
// tree.  Out from the shore: the tile a treebot stands on, then the tree; the yellow ground
// runs off to one side of the tree, and on the other a way goes round to the den, far
// enough off that the monster takes no notice of the treebot (it goes after anything within
// four tiles).  The treebot takes up the tree, backs off and plants it where it stood: the
// den and the yellow ground are one, shut in, and the monster wanders onto the yellow
// ground before long (or is lured there).
GOAL_PREP.monster = function (a, which) {
  const A = this.areas[a];
  const w = this.world;
  const of = (x, y) => w.areaOf[y]?.[x] ?? -1;
  const sky = (x, y) => x > 1 && y > 1 && x < w.W - 2 && y < w.H - 2 && of(x, y) === -1 && w.at(x, y) === '@';
  const beasts = ['crab', 'scorpion', 'trex'].filter((m) => this.look.monsters.includes(m));
  const kind = this.rng.pick(beasts.length ? beasts : ['crab']);
  const edges = [];
  for (const k of A.tiles) {
    const [x, y] = k.split(',').map(Number);
    if (!this.clearTile(x, y)) continue;
    for (const [dx, dy] of DIRS) if (sky(x + dx, y + dy)) edges.push([x, y, dx, dy]);
  }
  for (let tries = 0; tries < 40 && edges.length; tries++) {
    const [ex, ey, dx, dy] = this.rng.pick(edges);
    const [px, py] = this.rng.pick([[dy, dx], [-dy, -dx]]);
    const at = (i, j) => [ex + i * dx + j * px, ey + i * dy + j * py];   // i out from the shore, j along it
    const s = at(1, 0), g = at(2, 0);
    // the yellow ground on the -j side, the way and the den on the +j side
    const yellow = [], den = [];
    const way = [at(2, 1), at(2, 2), at(3, 2), at(4, 2), at(5, 2)];
    const seed = [at(2, -1), at(3, -1)];
    const tiles = new Set([s, g, ...way, ...seed].map((p) => key(...p)));
    const ok = (p) => sky(...p) && !tiles.has(key(...p));
    if (![s, g, ...way, ...seed].every((p) => sky(...p))) continue;
    // nothing else beside them but sky (and the shore by s)
    const apart = [g, ...way, ...seed].every(([x, y]) => AROUND.every(([ax, ay]) => {
      const o = of(x + ax, y + ay);
      return o === -1 || tiles.has(key(x + ax, y + ay));
    }));
    if (!apart) continue;
    yellow.push(...seed);
    const grow = (list, want, side, minOut) => {
      for (let t = 0; t < 80 && list.length < want; t++) {
        const [x, y] = this.rng.pick(list);
        const [ax, ay] = this.rng.pick(DIRS);
        const p = [x + ax, y + ay];
        const i = (p[0] - ex) * dx + (p[1] - ey) * dy, j = (p[0] - ex) * px + (p[1] - ey) * py;
        if (i < minOut || Math.sign(j) !== side || !ok(p)) continue;
        if (!AROUND.every(([bx, by]) => { const o = of(p[0] + bx, p[1] + by); return o === -1 || tiles.has(key(p[0] + bx, p[1] + by)); })) continue;
        // (the den's and the way's tiles not beside the yellow ground's, nor it beside them)
        const other = side < 0 ? den.concat(way) : yellow;
        if (other.some((q) => man(q, p) <= 1)) continue;
        if (side > 0 && (man(p, s) < 6 || man(p, at(0, 0)) < 6)) continue;
        tiles.add(key(...p));
        list.push(p);
      }
    };
    grow(yellow, this.rng.int(7, 11), -1, 2);
    den.push(at(6, 2));
    if (!ok(den[0]) || !AROUND.every(([bx, by]) => { const o = of(den[0][0] + bx, den[0][1] + by); return o === -1; })) continue;
    tiles.add(key(...den[0]));
    grow(den, this.rng.int(3, 5), 1, 4);
    if (yellow.length < 6 || den.length < 3) continue;
    // laid down: the treebot's tile and the way open ground, the gate a tree, the den ground,
    // the goal's ground yellow
    const tree = this.rng.pick(this.look.trees);
    this.setGround(...s, '.');
    w.areaOf[s[1]][s[0]] = -3;
    this.setGround(...g, tree);
    for (const p of way.concat(den)) this.setGround(...p, '.');
    for (const p of yellow) this.setGround(...p, ':');
    for (const p of [g, ...way, ...den, ...yellow]) w.areaOf[p[1]][p[0]] = -4;
    for (const p of [s, at(0, 0), g, ...way, ...den, ...yellow]) this.reserve(p);
    // (the monster as far in as it goes)
    const M = den.slice().sort((p, q) => man(q, s) - man(p, s))[0];
    this.add({ t: 'unit', cls: 'monster', kind, at: M });
    const G = this.rng.pick(yellow);
    this.add({ t: 'goal', which, at: G, want: 'collect 1 ' + kind });
    return { beast: kind, s, g, e: at(0, 0), yellow, M, which };
  }
  no('no room for a den');
};
GOAL_RUN.monster = function (g) {
  const { a, which, beast: kind, s, e, yellow } = g;
  // (a treebot with energy to spare: one there with plenty, or a new one built by the den)
  let tb = this.have(['treebot'], e);
  if (!tb || this.model.energyOf(this.unit(tb)) < 70) tb = this.need(['treebot'], a, e, { fresh: true });
  this.busy.add(tb);
  // (empty-handed)
  const u = this.unit(tb);
  if (Object.keys(u.cargo.bricks).length) no('the treebot is carrying');
  if (this.fuel(tb, s)) this.go(tb, e);
  this.play({ op: 'regate', unit: tb, at: g.g, stand: s, back: e });
  // and away, so that the monster is not drawn to the gate by it
  const away = this.spot(a, { noReserve: true, spacing: 0, why: 'the treebot', test: (x, y) => man([x, y], g.g) >= 7 && this.model.dist(this.unit(tb), [x, y]) > 0 });
  this.go(tb, away);
  const m = Object.values(this.model.units).find((x) => x.kind === kind && x.cls === 'monster' && x.pen && yellow.every((p) => x.pen.has(key(...p))));
  if (!m) no('the den is not open to the yellow ground');
  this.play({ op: 'wander', unit: m.name, to: this.rng.pick(yellow) });
  this.tags.add(which + ': lead a ' + kind + ' in');
  this.tags.add('monster ' + kind);
};

// A boulder pushed into a nook.
GOAL_PREP.boulder = function (a) {
  for (let tries = 0; tries < 12; tries++) {
    const { n, e } = this.nook(a);
    const d = [n[0] - e[0], n[1] - e[1]];
    const k = this.rng.int(2, 3);
    const line = [];
    for (let i = 1; i <= k + 1; i++) line.push([n[0] - i * d[0], n[1] - i * d[1]]);
    if (line.every(([x, y]) => this.areas[a].tiles.has(key(x, y)) && (this.clearTile(x, y) || (x === e[0] && y === e[1])))) {
      for (const p of line) this.reserve(p);
      let kit = null;
      try { kit = this.holdBlock(a, n, 10); } catch (e) { if (!(e instanceof Fail)) throw e; }
      const B0 = [n[0] - k * d[0], n[1] - k * d[1]];
      this.add({ t: 'unit', cls: 'monster', kind: 'boulder', at: B0 });
      this.add({ t: 'goal', which: arguments[1], at: n, want: 'boulder' });
      return { n, d, k, kit };
    }
    // (the nook back as it was)
    this.setGround(n[0], n[1], '@');
    this.world.areaOf[n[1]][n[0]] = -1;
    this.reserved.delete(key(...n));
  }
  no('no room for a boulder');
};
GOAL_RUN.boulder = function (g) {
  const { a, which, n, d, k } = g;
  const B0 = [n[0] - k * d[0], n[1] - k * d[1]];
  if (g.kit) this.release(g.kit.held, g.kit.site);
  const dz = this.need(['dozer'], a, [B0[0] - d[0], B0[1] - d[1]], g.kit ? { site: g.kit.site } : { within: 8 });
  for (let i = 0; i < k; i++) {
    const b = [B0[0] + i * d[0], B0[1] + i * d[1]];
    this.play({ op: 'push', unit: dz, at: b, stand: [b[0] - d[0], b[1] - d[1]] });
  }
  this.tags.add(which + ': push a boulder');
};

// A fish, a duck, a frog or a boat brought to the end of a pond.
GOAL_PREP.water = function (a) {
  const p = this.pond(a);
  return { pond: p, n: p.whirl };
};
GOAL_RUN.water = function (g) {
  const { a, which, pond, n } = g;
  this.setGround(n[0], n[1], 'w');
  // or a marina built on the pond, by its bank
  if (this.rng.chance(0.3)) {
    this.add({ t: 'goal', which, at: pond.yard, want: 'marina', terrain: 'water' });
    this.make('marina', a, pond.yard, { partial: true, fetchPlan: true });
    this.tags.add(which + ': build marina');
    return;
  }
  // who: a boat or an animal that can get there from well away, or one made for it: a duck
  // or a frog away on the land, mostly, that comes to the pond (a fish or a boat is made in
  // the pond itself)
  const swimmers = Object.values(this.model.units).filter((x) => x.cls === 'vehicle' && this.cfg[x.kind].terrain.includes('water') && !this.posted.has(x.name) && !this.spent.has(x.name) && this.model.dist(x, n) >= 5);
  let u;
  if (swimmers.length && this.rng.chance(0.5)) u = this.rng.pick(swimmers).name;
  else {
    const what = this.rng.weighted([['duck', 3], ['frog', 3], ['fish', 2], ['speedboat', 1], ['tugboat', 1], ['freighter', 0.5]]);
    const far = this.cfg[what].terrain.includes('normal') ? this.farSite(what, n) : null;
    u = far ? this.make(what, far[2], [far[0], far[1]], { partial: true, fetchPlan: true })
      : this.make(what, a, pond.yard, { partial: true, fetchPlan: false });
    this.tags.add('made for the ' + which + ': ' + what);
  }
  const kind = this.unit(u).kind;
  this.add({ t: 'goal', which, at: n, want: kind, terrain: 'water' });
  this.go(u, n);
  this.tags.add(which + ': swim ' + kind);
};

Gen.prototype.planGoals = function () {
  const last = this.areas.length - 1;
  const pool = this.goalPool();
  const order = (exclude) => {
    const p = pool.filter(([k]) => k !== exclude);
    const out = [];
    while (p.length) { const k = this.rng.weighted(p); out.push(k); p.splice(p.findIndex(([x]) => x === k), 1); }
    return out;
  };
  this.plans = {};
  for (const which of ['goal', 'bonus']) {
    const a = which === 'goal' ? last : this.bonusArea0;
    const first = which === 'goal' ? this.goalKind0 : this.bonusKind0;
    const rest = order(which === 'bonus' && this.rng.chance(0.85) ? this.plans.goal?.kind : null).filter((k) => k !== first);
    for (const kind of [first].concat(rest)) {
      try {
        this.plans[which] = Object.assign({ kind, a, which }, GOAL_PREP[kind].call(this, a, which));
        this.plans[which].kind = kind;
        break;
      } catch (e) {
        if (!(e instanceof Fail)) throw e;
      }
    }
  }
};

// The goal, or the bonus goal: the one planned, or failing that another, made now.
Gen.prototype.makeGoal = function (which) {
  const tries = [];
  if (this.plans[which]) tries.push(this.plans[which]);
  // (failing that, another of the common kinds)
  const common = this.goalPool().filter(([k]) => k !== 'monster' && k !== 'boulder');
  const kinds = [];
  while (common.length) { const k = this.rng.weighted(common); kinds.push(k); common.splice(common.findIndex(([x]) => x === k), 1); }
  const areas = which === 'goal' ? [this.areas.length - 1] : this.rng.shuffle(this.areas.map((x) => x.i));
  for (const k of kinds) for (const a of areas) tries.push({ kind: k, a, which });
  for (const t of tries.slice(0, 12)) {
    // (a planned goal that could not be had: its goal taken off the map, what it put down
    // left as it is)
    if (t !== this.plans[which]) this.dropGoal(which);
    const snap = this.snapshot();
    this.busy = new Set();
    try {
      const g = t.n || t.site || t.M || t.pond ? t : Object.assign(t, GOAL_PREP[t.kind].call(this, t.a, which), { kind: t.kind });
      if (g.kit && g !== this.plans[which]) { this.release(g.kit.held); g.kit = null; }
      GOAL_RUN[g.kind].call(this, g);
      if (!this.model.done(which)) no('the ' + which + ' is not reached');
      if (which === 'goal') this.goalKind = g.kind; else this.bonusKind = g.kind;
      return;
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      if (this.debug) this.debug(which + ' ' + t.kind + ': ' + e.message);
      this.restore(snap);
    }
  }
  no('no ' + which);
};
Gen.prototype.dropGoal = function (which) {
  const gone = this.world.items.filter((it) => it.t === 'goal' && it.which === which);
  if (!gone.length) return;
  this.world.items = this.world.items.filter((it) => !gone.includes(it));
  this.model.goals = this.model.goals.filter((g) => !gone.some((it) => it.at[0] === g.at[0] && it.at[1] === g.at[1]));
  for (const it of gone) {
    this.model.goalTiles.delete(key(...it.at));
    for (const [dx, dy] of DIRS) {
      const x = it.at[0] + dx, y = it.at[1] + dy;
      if (this.world.at(x, y) === ':') { this.setGround(x, y, '.'); this.model.goalTiles.delete(key(x, y)); }
    }
  }
};
Gen.prototype.goal = function () { this.makeGoal('goal'); };
Gen.prototype.bonus = function () {
  this.into = this.bonusSteps;
  this.makeGoal('bonus');
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

// ---------- the shape of the land ----------

const split = (k) => k.split(',').map(Number);
const AROUND = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
// What each tile that is no area's is, in world.areaOf: -1 the sky, -2 a link's strip, -3 a
// goal's nook, -4 a monster's pen, -5 a coast's water, -6 a maze's wall.

// The areas' outlines made like the games' own islands: their edges worn away here and there
// and grown out into points and lobes, clear of the strips, the nooks and pens and the other
// areas (a tile of sky at least between any two of them).
Gen.prototype.shape = function () {
  const rng = this.rng, w = this.world;
  const of = (x, y) => w.areaOf[y]?.[x] ?? -1;
  const guarded = (x, y) => {
    const k = key(x, y);
    if (this.mouths.has(k) || this.keeps.has(k) || this.reserved.has(k)) return true;
    return AROUND.some(([dx, dy]) => { const o = of(x + dx, y + dy); return o === -2 || o === -3 || o === -4 || this.mouths.has(key(x + dx, y + dy)); });
  };
  for (const A of this.areas) {
    if (A.maze) continue;
    const size0 = A.tiles.size;
    for (let pass = 0; pass < (size0 > 60 ? 3 : 2); pass++) {
      const edge = [...A.tiles].map(split).filter(([x, y]) => DIRS.some(([dx, dy]) => !A.tiles.has(key(x + dx, y + dy))));
      for (const [x, y] of rng.shuffle(edge)) {
        if (A.tiles.size <= Math.max(14, size0 * 0.62)) break;
        if (!rng.chance(pass === 0 ? 0.42 : 0.25) || guarded(x, y)) continue;
        const k = key(x, y);
        A.tiles.delete(k);
        if (!this.areaJoined(A.i)) { A.tiles.add(k); continue; }
        w.set(x, y, '@');
        w.areaOf[y][x] = -1;
      }
    }
    // points and lobes out into the sky
    const grow = (x, y) => x > 1 && y > 1 && x < w.W - 2 && y < w.H - 2 && of(x, y) === -1 && w.at(x, y) === '@'
      && AROUND.every(([dx, dy]) => { const o = of(x + dx, y + dy); return o === -1 || o === A.i; });
    const put = (x, y) => { w.set(x, y, '.'); w.areaOf[y][x] = A.i; A.tiles.add(key(x, y)); };
    for (let i = rng.int(1, size0 > 50 ? 4 : 2); i > 0; i--) {
      const starts = [];
      for (const k of A.tiles) {
        const [x, y] = split(k);
        for (const [dx, dy] of DIRS) if (grow(x + dx, y + dy)) starts.push([x, y, dx, dy]);
      }
      if (!starts.length) break;
      let [x, y, dx, dy] = rng.pick(starts);
      for (let n = rng.int(2, 6); n > 0; n--) {
        x += dx; y += dy;
        if (!grow(x, y)) break;
        put(x, y);
        // (a lobe a tile or two wide here and there)
        if (rng.chance(0.45)) {
          const [sx, sy] = rng.pick([[dy, dx], [-dy, -dx]]);
          if (grow(x + sx, y + sy)) put(x + sx, y + sy);
        }
        if (rng.chance(0.35)) [dx, dy] = rng.pick([[dy, dx], [-dy, -dx]]);
      }
    }
  }
};

// Water along some of the areas' shores (and in the ocean all round, with reefs beyond it):
// each stretch of it beside one area only, so that nothing gets from one area to another by
// it, and clear of the strips, nooks and pens.
Gen.prototype.coasts = function () {
  const look = this.look, rng = this.rng, w = this.world;
  const of = (x, y) => w.areaOf[y]?.[x] ?? -1;
  const share = look.ocean ? 1 : { grass: 0.45, prehistoric: 0.3, jungle: 0.35, city: 0.12 }[look.name];
  const owner = new Map();
  const ok = (x, y, a) => {
    if (x < 1 || y < 1 || x > w.W - 2 || y > w.H - 2 || of(x, y) !== -1 || w.at(x, y) !== '@') return false;
    return AROUND.every(([dx, dy]) => {
      const k = key(x + dx, y + dy), o = of(x + dx, y + dy);
      if (owner.has(k)) return owner.get(k) === a;
      return o === -1 || o === a;
    });
  };
  for (const A of this.areas) {
    if (!rng.chance(share)) continue;
    let front = [...A.tiles].map(split);
    const rings = look.ocean ? rng.int(1, 3) : rng.int(1, 2);
    for (let r = 0; r < rings; r++) {
      const next = [];
      for (const [x, y] of front) for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny);
        if (owner.has(k) || !ok(nx, ny, A.i)) continue;
        // (a stretch of shore left dry here and there, but for the ocean)
        if (!look.ocean && r === 0 && rng.chance(0.3)) continue;
        if (r > 0 && rng.chance(0.35)) continue;
        owner.set(k, A.i);
        next.push([nx, ny]);
      }
      front = next;
    }
  }
  for (const k of owner.keys()) {
    const [x, y] = split(k);
    const deep = look.ocean && !DIRS.some(([dx, dy]) => of(x + dx, y + dy) >= 0);
    w.set(x, y, deep && rng.chance(0.6) ? 'x' : 'w');
    w.areaOf[y][x] = -5;
  }
  if (owner.size) this.tags.add('feature coast');
  // reefs off the ocean's coasts
  if (look.ocean) {
    for (const k of owner.keys()) {
      const [x, y] = split(k);
      for (const [dx, dy] of AROUND) if (of(x + dx, y + dy) === -1 && w.at(x + dx, y + dy) === '@' && rng.chance(0.4)) w.set(x + dx, y + dy, 'r');
    }
  }
};

// Some areas made a maze of narrow ways over the sky, as in the games' own (The Long Road,
// Treebot in the Forest): walls of sky, or of the look's trees and rocks, with a room or two
// and a few loops, and the ways to its links kept open.
Gen.prototype.mazes = function () {
  const share = { grass: 0.25, prehistoric: 0.2, jungle: 0.3, city: 0, ocean: 0.08 }[this.look.name] * (0.6 + 0.2 * this.d);
  for (const A of this.areas) {
    if (A.x1 - A.x0 < 6 || A.y1 - A.y0 < 6 || !this.rng.chance(share)) continue;
    this.maze(A);
  }
};
Gen.prototype.maze = function (A) {
  const rng = this.rng, w = this.world;
  const open = new Set();
  const cell = (i, j) => [A.x0 + 2 * i, A.y0 + 2 * j];
  const ci = Math.floor((A.x1 - A.x0) / 2) + 1, cj = Math.floor((A.y1 - A.y0) / 2) + 1;
  const seen = new Set();
  const stack = [[rng.int(0, ci - 1), rng.int(0, cj - 1)]];
  seen.add(stack[0].join());
  open.add(key(...cell(...stack[0])));
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const next = rng.shuffle(DIRS).map(([di, dj]) => [i + di, j + dj]).filter(([a, b]) => a >= 0 && b >= 0 && a < ci && b < cj && !seen.has(a + ',' + b));
    if (!next.length) { stack.pop(); continue; }
    const [a, b] = next[0];
    seen.add(a + ',' + b);
    const [x, y] = cell(a, b), [px, py] = cell(i, j);
    open.add(key(x, y));
    open.add(key((x + px) / 2, (y + py) / 2));
    stack.push([a, b]);
  }
  // a few loops, and a room or two
  for (const k of A.tiles) {
    const [x, y] = split(k);
    if (open.has(k) || ((x - A.x0) % 2 === 1) === ((y - A.y0) % 2 === 1)) continue;
    if (rng.chance(0.12)) open.add(k);
  }
  for (let r = rng.int(1, 2); r > 0; r--) {
    const [x, y] = cell(rng.int(0, ci - 1), rng.int(0, cj - 1));
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (A.tiles.has(key(x + dx, y + dy))) open.add(key(x + dx, y + dy));
  }
  // the ground beside every strip open, and a way from it into the maze
  const center = [(A.x0 + A.x1) / 2, (A.y0 + A.y1) / 2];
  for (const k of A.tiles) {
    let [x, y] = split(k);
    if (!DIRS.some(([dx, dy]) => w.areaOf[y + dy]?.[x + dx] === -2)) continue;
    for (let n = 0; n < 4 && A.tiles.has(key(x, y)); n++) {
      open.add(key(x, y));
      if (Math.abs(center[0] - x) > Math.abs(center[1] - y)) x += Math.sign(center[0] - x); else y += Math.sign(center[1] - y);
    }
  }
  const walls = [...A.tiles].filter((k) => !open.has(k));
  const wall = rng.chance(0.65) ? () => '@' : () => rng.pick(this.look.trees.concat(this.look.rocks));
  const old = new Set(A.tiles);
  for (const k of walls) A.tiles.delete(k);
  if (!this.areaJoined(A.i) || A.tiles.size < 24) { A.tiles = old; return; }
  for (const k of walls) { const [x, y] = split(k); w.set(x, y, wall()); w.areaOf[y][x] = -6; }
  A.maze = true;
  this.tags.add('feature maze');
};

// ---------- monsters in the field ----------

// Monsters as the games' own have them: out on the land the mission is played on, a crab or a
// gator roaming the whole of one of its areas (not the first), kept in by the way there, which
// it cannot cross (rocky ground, water, trees, a gap) as the units cannot without what the
// solution brings.  Before anything goes in, a defender is built there from the bricks lying in
// it and takes the monster apart ("send a Defender in to take apart the crab", as the
// walkthroughs have it): the hunt (model.js).  One to an area: two at once beat a defender.
Gen.prototype.hazards = function () {
  if (this.calm) { this.tags.add('calm'); return; }
  const rng = this.rng, w = this.world;
  // (how many, the code says, not the attempt: a mission turned down is tried again with as many)
  let h = 11;
  for (const ch of this.c.code) h = (h * 37 + ch.charCodeAt(0)) >>> 0;
  const n = [h % 5 < 3 ? 1 : 0, 1 + (h % 3 === 0 ? 1 : 0), 1 + (h % 3 === 0 ? 0 : 1)][this.d - 1];
  const kinds = [['crab', 3], ['gator', 1]].filter(([k]) => this.look.monsters.includes(k));
  if (!kinds.length) return;
  const areas = rng.shuffle(this.areas.slice(1).filter((A) => !A.maze));
  const want = Math.min(n, areas.length);
  let placed = 0;
  for (let i = 0; i < n && areas.length; i++) {
    for (let t = 0; t < areas.length; t++) {
      const A = areas[t];
      const kind = rng.weighted(kinds);
      const walks = new Set(this.cfg[kind].terrain);
      const can = (x, y) => walks.has(CHAR[w.at(x, y)]) || (w.at(x, y) === ':' && walks.has('normal'));
      // (where it starts: open ground well inside the area, away from the way in)
      const starts = [...A.tiles].map(split).filter(([x, y]) => w.at(x, y) === '.' && !w.itemAt(x, y) && !this.reserved.has(key(x, y)) && !this.keeps.has(key(x, y))
        && [...this.mouths].every((k) => man([x, y], split(k)) >= 4));
      if (!starts.length) continue;
      const at = rng.pick(starts);
      // all it can get to is the area itself, and the strips of the ways in: no swamp (it chases
      // over it), nothing beyond
      const seen = new Set([key(...at)]);
      const stack = [at];
      const swamp = new Set();
      let ok = true;
      while (stack.length && ok) {
        const [x, y] = stack.pop();
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy, k = key(nx, ny);
          // (a patch of swamp in the area made rocky ground; a swamp on the way in, no)
          if (w.at(nx, ny) === '#') { if (A.tiles.has(k)) { swamp.add(k); continue; } ok = false; break; }
          if (seen.has(k) || !can(nx, ny)) continue;
          // (the strip of a way in and the goal's nook, but no other area)
          if (!A.tiles.has(k) && ![-2, -3].includes(w.areaOf[ny]?.[nx])) { ok = false; break; }
          seen.add(k);
          stack.push([nx, ny]);
        }
      }
      if (!ok || seen.size < 8) continue;
      for (const k of swamp) w.set(...split(k), '_');
      A.monster = this.add({ t: 'unit', cls: 'monster', kind, at });
      A.roams = seen;
      placed++;
      this.tags.add('feature monster in the field');
      this.tags.add('monster ' + kind);
      areas.splice(t, 1);
      break;
    }
  }
  // (fewer than the code says: tried again, not let off with fewer)
  if (placed < want) no('no room for its monsters');
};

// The hunt in an area with a monster in it: two defenders' plans in hand, their bricks laid by
// two sites side by side in the area, and the two built there to take the monster apart
// together ("try to use 2 Defenders on the same crab", as the walkthroughs have it).
Gen.prototype.hunt = function (A) {
  const m = A.monster;
  if (!m || A.hunted) return;
  if (!this.model.units[m.name]) { A.hunted = true; return; }
  const pen = this.model.units[m.name].pen;
  const site = this.spot(A.i, { spacing: 1, why: 'the hunters', test: (x, y) => this.roomAround(x, y) >= 4 && pen.has(key(x, y)) && man([x, y], m.at) >= 3 });
  // (far enough apart that each one's bricks are its own)
  const site2 = this.spot(A.i, { spacing: 1, near: site, within: 5, min: 3, why: 'the second hunter', test: (x, y) => Math.max(Math.abs(x - site[0]), Math.abs(y - site[1])) >= 3 && this.roomAround(x, y) >= 3 && pen.has(key(x, y)) && man([x, y], m.at) >= 3 });
  // (a plan for each, in hand)
  for (const inv of [this.world.inventory, this.model.inventory]) inv.defender = (inv.defender || 0) + 2;
  this.supply(A.i, site, this.cfg.defender.recipe, { full: true });
  this.supply(A.i, site2, this.cfg.defender.recipe, { full: true });
  const as = this.world.name('u'), as2 = this.world.name('u');
  this.play({ op: 'hunt', what: 'defender', at: site, as, at2: site2, as2, target: m.name });
  A.hunted = true;
  this.tags.add('defender hunts a monster in the field');
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
    if (s.op === 'wait') for (const p of s.made || [s.at]) if (p) used.add(key(...p));
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
    const style = this.dressing();
    const budget = Math.round(tiles.length * density * style.density);
    let placed = 0;
    const kinds = style.kinds.slice();
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
  }
};

const STREET_EW = String.fromCharCode(92);   // a street going east and west

// Streets across an area, in the city: a street the width of it, a street its height
// crossing it, a square of cement; laid before anything is put on the map, so that they
// stay whole.
Gen.prototype.streets = function (A) {
  const ok = (x, y) => A.tiles.has(key(x, y)) && this.world.at(x, y) === '.' && !this.reserved.has(key(x, y));
  const rows = [], cols = [];
  for (let y = A.y0 + 1; y < A.y1; y++) rows.push(y);
  for (let x = A.x0 + 1; x < A.x1; x++) cols.push(x);
  const ry = this.rng.chance(0.85) ? this.rng.pick(rows) : null;
  const cx = this.rng.chance(0.65) ? this.rng.pick(cols) : null;
  if (ry !== null) for (let x = A.x0; x <= A.x1; x++) if (ok(x, ry)) this.world.set(x, ry, STREET_EW);
  if (cx !== null) for (let y = A.y0; y <= A.y1; y++) {
    if (y === ry && this.world.at(cx, y) === STREET_EW) this.world.set(cx, y, '+');
    else if (ok(cx, y)) this.world.set(cx, y, '/');
  }
  if (this.rng.chance(0.5)) {
    const x0 = this.rng.int(A.x0, A.x1 - 1), y0 = this.rng.int(A.y0, A.y1 - 1);
    for (let y = y0; y < y0 + 2; y++) for (let x = x0; x < x0 + 2; x++) if (ok(x, y)) this.world.set(x, y, '`');
  }
  this.tags.add('feature streets');
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
  this.mazes();
  this.planGoals();
  this.shape();
  this.coasts();
  if (this.look.city) for (const A of this.areas) if (!A.maze) this.streets(A);
  this.features();
  this.hazards();
  this.model = new Model(this.cfg, this.world.grid, this.world.items, this.world.inventory);
  this.model.strict = true;
  if (this.model.monsters().some((m) => m.loose)) no('a monster is not shut in');
  this.model.drySwamp = (tiles) => {
    for (const [x, y] of tiles) { this.world.set(x, y, '.'); this.model.setChar(x, y, '.'); }
    return true;
  };
  this.start();
  for (this.li = 0; this.li < this.links.length; this.li++) {
    const l = this.links[this.li];
    this.busy = new Set();
    this.hunt(this.areas[l.b]);
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
  this.infill();
  this.ornaments();
  this.spares();
  this.mapPlans();
  this.unyellow();
  // (the map has room for 31 kinds of item)
  const defs = new Set(this.world.items.map((it) => JSON.stringify([it.t, it.cls, it.kind, it.bricks, it.what, it.which, it.want, it.id, it.water])));
  if (defs.size > 31) no('too many kinds of item');
  // (and the plans bar room for ten kinds of plan)
  const planKinds = new Set(Object.keys(this.world.inventory).filter((k) => this.world.inventory[k] > 0).concat(this.world.items.filter((it) => it.t === 'plan').map((it) => it.what)));
  if (planKinds.size > 10) no('too many kinds of plan');
  this.crop();
  for (const it of this.world.items) if (it.t === 'unit' && it.cls === 'monster') this.tags.add('monster ' + it.kind);
  for (const row of this.world.grid) for (const ch of row) this.tags.add('terrain ' + (ch === ':' ? 'goal' : CHAR[ch]));
  return this;
};

// Yellow ground no goal is on (a monster's goal that was planned and not had): plain
// ground, its den left as a den.
Gen.prototype.unyellow = function () {
  const w = this.world;
  const keep = new Set();
  for (const g of w.items) {
    if (g.t !== 'goal' || !/^collect/.test(g.want)) continue;
    const stack = [g.at];
    keep.add(key(...g.at));
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [dx, dy] of DIRS) {
        const k = key(x + dx, y + dy);
        if (!keep.has(k) && w.at(x + dx, y + dy) === ':') { keep.add(k); stack.push([x + dx, y + dy]); }
      }
    }
  }
  let changed = false;
  for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) if (w.grid[y][x] === ':' && !keep.has(key(x, y))) { w.grid[y][x] = '.'; changed = true; }
  if (changed) this.verify();
};

// ---------- finishing as the originals are ----------

// A tile of open ground in an area for something put there once the solution is made: not
// one the solution acts on or stands on to act (a route may go over it: whether the solution
// still plays is checked after); `test` for any other condition.
Gen.prototype.looseSpot = function (A, test) {
  const w = this.world;
  const cands = [...A.tiles].map(split).filter(([x, y]) => {
    const k = key(x, y);
    return w.at(x, y) === '.' && !w.itemAt(x, y) && !this.touched.has(k) && !this.keeps.has(k) && !this.mouths.has(k) && (!test || test(x, y));
  });
  if (!cands.length) no('no room');
  // (off the solution's way if it can be)
  const off = cands.filter(([x, y]) => !this.trail || !this.trail.has(key(x, y)));
  return this.rng.pick(off.length ? off : cands);
};
// Open ground round a tile.
Gen.prototype.openAround = function (x, y) {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && this.world.at(x + dx, y + dy) === '.' && !this.world.itemAt(x + dx, y + dy)) n++;
  return n;
};

// How many more kinds of item the map has room for (31 in all), with this one.
Gen.prototype.itemDef = (it) => JSON.stringify([it.t, it.cls, it.kind, it.bricks, it.what, it.which, it.want, it.id, it.water]);
Gen.prototype.roomFor = function (it) {
  const defs = new Set(this.world.items.map(this.itemDef));
  return defs.has(this.itemDef(it)) || defs.size < 31;
};

// Is the mission as it is now still played by its solution, every monster shut in?  If not,
// `undo` puts it back.
Gen.prototype.stillPlays = function (undo) {
  try {
    const m = this.verify();
    if (m.monsters().some((x) => x.loose)) no('a monster is let out');
    return true;
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    undo();
    return false;
  }
};

// The sky inside the map filled, as the originals' maps are one piece of land and water: what
// keeps their parts apart is water, rocky ground or a line of trees, a hole only now and
// then.  Each stretch of sky is filled with deep water, or trees or rocks (beside a monster
// that swims, or as the look has it), or left a hole; kept only if the solution still plays.
Gen.prototype.infill = function () {
  const rng = this.rng, w = this.world, look = this.look;
  let x0 = w.W, y0 = w.H, x1 = -1, y1 = -1;
  for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
    if (w.grid[y][x] === '@' && !w.itemAt(x, y)) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  // monsters that swim, and where each may be: no water is put beside them
  const swimmers = new Set();
  for (const it of w.items) if (it.t === 'unit' && it.cls === 'monster' && it.kind !== 'boulder' && this.cfg[it.kind].terrain.includes('water')) {
    const stack = [it.at];
    const seen = new Set([key(...it.at)]);
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [dx, dy] of DIRS) {
        const k = key(x + dx, y + dy);
        if (seen.has(k) || !this.cfg[it.kind].terrain.includes(CHAR[w.at(x + dx, y + dy)])) continue;
        seen.add(k);
        stack.push([x + dx, y + dy]);
      }
    }
    for (const k of seen) { const [x, y] = split(k); for (const [dx, dy] of DIRS) swimmers.add(key(x + dx, y + dy)); }
  }
  const done = new Set();
  let filled = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (w.grid[y][x] !== '@' || w.itemAt(x, y) || done.has(key(x, y))) continue;
    const part = [];
    const stack = [[x, y]];
    done.add(key(x, y));
    let rim = false, byWet = false;
    const touches = new Set();
    while (stack.length) {
      const [a, b] = stack.pop();
      part.push([a, b]);
      if (a === x0 || a === x1 || b === y0 || b === y1) rim = true;
      if (swimmers.has(key(a, b))) byWet = true;
      // (what it lies beside: an area, a way between two, a nook or a pen)
      for (const [dx, dy] of DIRS) {
        const o = w.areaOf[b + dy]?.[a + dx];
        if (o !== undefined && o !== -1 && w.grid[b + dy][a + dx] !== '@') touches.add(o >= 0 ? 'a' + o : 'x' + key(a + dx, b + dy));
      }
      for (const [dx, dy] of DIRS) {
        const nx = a + dx, ny = b + dy, k = key(nx, ny);
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1 || done.has(k) || w.grid[ny][nx] !== '@' || w.itemAt(nx, ny)) continue;
        done.add(k);
        stack.push([nx, ny]);
      }
    }
    // (the map's own edge is ragged now and then; a small hole inside is kept now and then)
    if (rim && rng.chance(0.12)) continue;
    if (!rim && part.length <= 3 && rng.chance(0.4)) continue;
    const fills = byWet ? [[look.trees, 3], [look.rocks, 0.5]]
      : look.ocean ? [[['x', 'x', 'w'], 6], [look.trees, 1]]
        : [[['x', 'x', 'w'], { wet: 6, open: 4, forest: 2, rocky: 2 }[this.style]], [look.trees, { forest: 1.5, open: 0.7, wet: 0.5, rocky: 0.5 }[this.style]], [look.rocks, 0.25], [['_'], this.style === 'rocky' ? 3 : 1.2]];
    // (a wide stretch of sky is water, as the originals' seas are, not a forest; beside a monster
    // that swims, where water would let it out, a hole)
    if (part.length > 14 && byWet) continue;
    // (beside two places or more, water a boat crosses, rocky ground a dirtbuggy does, or trees a
    // treebot takes up would be a way between them past what the mission puts there: rocks, or
    // a hole)
    if (new Set([...touches].filter((t) => t.startsWith('a'))).size > 1 || [...touches].some((t) => t.startsWith('x'))) {
      if (rng.chance(0.4)) continue;
      for (const [a, b] of part) w.set(a, b, rng.pick(look.rocks));
      if (this.stillPlays(() => { for (const [a, b] of part) w.set(a, b, '@'); })) filled += part.length;
      continue;
    }
    const wide = part.length > 14 ? rng.weighted([['sea', 3], ['hole', 1.5], ['wood', 0.7], ['rocky', 1]]) : null;
    if (wide === 'hole') continue;
    const set = wide === 'sea' ? ['x', 'x', 'w'] : wide === 'wood' ? look.trees : wide === 'rocky' ? ['_'] : rng.weighted(fills);
    for (const [a, b] of part) w.set(a, b, rng.pick(set));
    if (this.stillPlays(() => { for (const [a, b] of part) w.set(a, b, '@'); })) filled += part.length;
  }
  if (filled) this.tags.add('feature infill');
};

// What stands on the map from the start besides what the solution uses, as the originals
// have: a building or two (a house, a gas station, a robot lab, a guard tower, kept well away
// from any monster, which it would go after), a spare unit or two of the mission's own
// kinds, and now and then boulders lying about.  Each kept only if the solution still plays.
Gen.prototype.ornaments = function () {
  const rng = this.rng;
  const monsters = this.world.items.filter((it) => it.t === 'unit' && it.cls === 'monster' && it.kind !== 'boulder');
  const place = (it, test, tag) => {
    const quiet = this.areas.filter((A) => !A.monster || it.t !== 'unit');
    for (let t = 0; t < 8 && quiet.length; t++) {
      const A = rng.pick(quiet);
      let at;
      try {
        at = this.looseSpot(A, test);
      } catch (e) {
        if (!(e instanceof Fail)) throw e;
        continue;
      }
      const one = { ...it, at };
      if (!this.roomFor(one)) return null;
      this.world.items.push(one);
      if (this.stillPlays(() => this.world.items.splice(this.world.items.indexOf(one), 1))) { this.tags.add(tag); return one; }
    }
    return null;
  };
  // (only what is no help: a gas station or robot lab would recharge for nothing)
  const buildings = rng.chance(0.5) ? (rng.chance(0.35) ? 2 : 1) : 0;
  for (let i = 0; i < buildings; i++) {
    const kind = rng.pick(['house', 'house', 'house', 'guard_tower']);
    place({ t: 'unit', cls: 'building', kind, name: this.world.name('b') },
      (x, y) => monsters.every((m) => man([x, y], m.at) > 4) && this.openAround(x, y) >= 5, 'start building ' + kind);
  }
  // (no spare units: one more of a unit the mission has is a way round what it asks)
  // boulders lying about, in a clump
  if (rng.chance(this.d === 1 ? 0.2 : 0.35)) {
    const first = place({ t: 'unit', cls: 'monster', kind: 'boulder', name: this.world.name('m') }, (x, y) => this.openAround(x, y) >= 4, 'feature loose boulders');
    if (first) {
      let last = first.at;
      for (let i = 0, t = 0; i < rng.int(1, 6) && t < 12; t++) {
        const [dx, dy] = rng.pick(AROUND);
        const at = [last[0] + dx, last[1] + dy];
        const k = key(...at);
        if (this.world.at(...at) !== '.' || this.world.itemAt(...at) || this.touched.has(k) || this.keeps.has(k) || this.mouths.has(k) || this.world.areaOf[at[1]]?.[at[0]] < 0) continue;
        const one = { t: 'unit', cls: 'monster', kind: 'boulder', at, name: this.world.name('m') };
        if (!this.roomFor(one)) break;
        this.world.items.push(one);
        if (this.stillPlays(() => this.world.items.splice(this.world.items.indexOf(one), 1))) { i++; last = at; }
      }
    }
  }
};

// Plans lying on the map, more of them than the solution fetches, as the originals have: one
// of a unit the mission has, or by a monster a defender's or a freezebot's.
Gen.prototype.mapPlans = function () {
  const rng = this.rng;
  const monsters = this.world.items.filter((it) => it.t === 'unit' && it.cls === 'monster' && it.kind !== 'boulder');
  const kinds = Object.keys(this.world.inventory).filter((k) => this.world.inventory[k] > 0 && this.cfg[k].cls === 'vehicle');
  const n = rng.int(1, 3);
  for (let i = 0, t = 0; i < n && t < 6; t++) {
    let what, near = null;
    // (only more of a plan in hand: one for anything else is a way round what the mission asks)
    if (kinds.length) what = rng.pick(kinds);
    else break;
    const A = near ? this.areas.reduce((best, X) => {
      const d = Math.min(...[...X.tiles].map((k) => man(split(k), near)));
      return !best || d < best.d ? { X, d } : best;
    }, null).X : rng.pick(this.areas);
    let at;
    try {
      at = this.looseSpot(A, (x, y) => !near || (man([x, y], near) > 2 && man([x, y], near) <= 7));
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      continue;
    }
    const it = { t: 'plan', at, what, n: 1 };
    if (!this.roomFor(it)) break;
    this.world.items.push(it);
    if (this.stillPlays(() => this.world.items.splice(this.world.items.indexOf(it), 1))) { i++; this.tags.add('spare plan on the map'); }
  }
};

// Bricks lying about beyond what the solution uses, as the originals have them: a pile or two
// of the look's colours, for whoever finds another way.
Gen.prototype.sparePiles = function () {
  const rng = this.rng;
  const n = rng.chance(0.6) ? rng.int(1, 2) : 0;
  for (let i = 0, t = 0; i < n && t < 6; t++) {
    const A = rng.pick(this.areas);
    let at;
    try {
      at = this.looseSpot(A, (x, y) => this.openAround(x, y) >= 3);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      continue;
    }
    let bricks = {};
    for (const c of rng.shuffle(COLORS).slice(0, rng.int(1, 2))) bricks[c] = rng.pick([5, 10, 10, 15, 20, 25, 40]);
    if (rng.chance(0.25)) bricks.energy = 1;
    let it = { t: 'pile', at, bricks };
    // (short of room for another kind of item: one more of a pile there already is)
    if (!this.roomFor(it)) {
      const piles = this.world.items.filter((x) => x.t === 'pile' && !x.water);
      if (!piles.length) break;
      it = { t: 'pile', at, bricks: { ...rng.pick(piles).bricks } };
    }
    this.world.items.push(it);
    if (this.stillPlays(() => this.world.items.splice(this.world.items.indexOf(it), 1))) { i++; this.tags.add('spare bricks'); }
  }
};

// Spare plans, as the games' own missions give them: more of the units the mission has plans
// for in hand (one lost to a monster, or taken apart once too often, can be built again).
Gen.prototype.spares = function () {
  const inv = this.world.inventory;
  for (const k of Object.keys(inv)) {
    if (!(inv[k] > 0) || this.cfg[k].cls !== 'vehicle') continue;
    if (k === this.startKind) inv[k] += this.rng.int(1, 4);
    else if (this.rng.chance(0.6)) inv[k] += this.rng.int(1, 2);
  }
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
    for (const k of ['to', 'at', 'at2', 'stand', 'out', 'back']) if (s[k]) mv(s[k]);
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
    const kinds = [['pond', 3], ['grove', 3], ['outcrop', 0.7], ['rocky', 2]];
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
        if (A.tiles.has(k) && this.world.at(x, y) === '.' && !nearMouth && !this.keeps.has(k) && !this.reserved.has(k)) {
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
Gen.prototype.groundJoined = function (a, least = 0.6) {
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
  return seen.size === ground.length && ground.length >= A.tiles.size * least;
};
