// Generated missions: puzzles made from the game's own rules, each with a solution that is
// played through before the mission is given (and, offline, by tools/verify/puzzles.py in
// the game itself).
//
// A mission is a string of land regions, left to right, joined by gates. Each gate lets
// through only the unit that can deal with it:
//   rock   a strip of rocky ground, which a dirtbuggy or a dumptruck drives over and a
//          buggy, forklift or steamshovel cannot;
//   water  a channel; a steamshovel digs dirt out of the ground somewhere and fills it in;
//   trees  a wall of trees; a treebot uproots one, plants it somewhere else, and so on.
// The player starts with a carrier (a buggy or a forklift) and the plans for the units the
// gates need. The bricks lie in piles about the regions, more than one trip's worth; the
// carrier hauls them to a site, the unit is built there from them (bricks within a tile of
// the site count), and so on through the gates to the goal. A bonus goal asks for one more
// thing with the bricks left over. The regions have trees and mountains about them, which
// the routes go round.
//
// The solution is a list of steps, as the game's own controls do them:
//   {op: 'haul', unit, from, to}     pick up from the pile at `from` and drop at `to`, until
//                                    the pile is gone
//   {op: 'build', what, at, as}      build `what` from its plan at `at`, naming it `as`
//   {op: 'dig', unit, at}, {op: 'fill', unit, at}
//   {op: 'uproot', unit, at}, {op: 'plant', unit, at}
//   {op: 'go', unit, to}             drive there
// It is played through a model of the rules (paths over each unit's ground, what each
// carries, the energy each move costs, the ground dug, filled and cleared); a mission
// whose solution does not play through is not given.
//
// A mission is named by a code: its difficulty (1 to 3), its look (A grass, B prehistoric,
// C jungle, D city) and a seed, written like 2C-K2Q9.

const SEED_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford's base 32
const LOOKS = {
  A: { name: 'grass', slot: [1, 12], trees: ['T'], rocks: ['M'] },
  B: { name: 'prehistoric', slot: [5, 12], trees: ['T'], rocks: ['M'] },
  C: { name: 'jungle', slot: [6, 12], trees: ['!', "'", '?'], rocks: ['%', '&', '$', '*'] },
  D: { name: 'city', slot: [7, 12], trees: ['!', "'"], rocks: ['M'] },
};

// ---------- codes ----------

export function parseCode(code) {
  const s = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const m = /^([1-3])([A-D])([0-9A-Z]{4})$/.exec(s);
  if (!m) return null;
  const seed = m[3].replace(/O/g, '0').replace(/[IL]/g, '1');
  if ([...seed].some((c) => !SEED_CHARS.includes(c))) return null;
  return { difficulty: Number(m[1]), look: m[2], seed, code: m[1] + m[2] + seed };
}

export function showCode(code) {
  const c = parseCode(code);
  return c ? c.code.slice(0, 2) + '-' + c.code.slice(2) : String(code);
}

export function randomCode(difficulty, look) {
  const d = difficulty || 1 + Math.floor(Math.random() * 3);
  const l = look || 'ABCD'[Math.floor(Math.random() * 4)];
  let seed = '';
  for (let i = 0; i < 4; i++) seed += SEED_CHARS[Math.floor(Math.random() * 32)];
  return d + l + seed;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- the rules, from the game's config ----------

// Each unit's and building's numbers: {terrain: [...], recipe: {brick: n}, carries, move,
// dig, transplant}.
export function readConfig(text) {
  const out = {};
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const m = /^#(\w+)\s*=\s*\[(.*)\]\s*$/.exec(line);
    if (!m) continue;
    const body = m[2];
    const list = (key) => {
      const r = new RegExp('#' + key + ':\\s*\\[([^\\]]*)\\]').exec(body);
      return r ? r[1] : '';
    };
    const terrain = list('terrain').split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean);
    const recipe = {};
    for (const p of list('recipe').split(',')) {
      const kv = /#(\w+)\s*:\s*([\d.]+)/.exec(p);
      if (kv) recipe[kv[1]] = Number(kv[2]);
    }
    const carries = /#carries:\s*([\d.]+)/.exec(body);
    const move = /#energy:\s*\[[^\]]*#move:\s*([\d.]+)/.exec(body);
    out[m[1].toLowerCase()] = {
      terrain, recipe,
      carries: carries ? Number(carries[1]) : 0,
      move: move ? Number(move[1]) : 0,
      dig: /#dig:\s*#yes/.test(body),
      transplant: /#transplant:\s*#yes/.test(body),
    };
  }
  return out;
}

// What each map character is, as the terrainmap member has it (the few this uses).
const GROUND = {
  '.': 'normal', '_': 'normal_undiggable', '#': 'swamp', 'w': 'water', 'x': 'water_undiggable',
  'r': 'water_reefs', 'M': 'mountain', '@': 'hole', 'T': 'tree', '!': 'tree2', "'": 'tree3', '?': 'tree4',
  '%': 'jungle1', '&': 'jungle2', '$': 'jungle3', '*': 'jungle4',
};
const TREES = new Set(['T', '!', "'", '?']);
const RESERVE = 20;       // energy a unit is never planned to go below
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// ---------- the model: the map as the solution changes it ----------

class Model {
  constructor(grid, units, config) {
    this.grid = grid.map((r) => r.slice());
    this.H = grid.length;
    this.W = grid[0].length;
    this.config = config;
    this.units = {};          // name -> {kind, x, y, energy, cargo}
    for (const [name, u] of Object.entries(units)) this.units[name] = Object.assign({ energy: 100, cargo: 0 }, u);
    this.piles = new Map();   // "x,y" -> bricks on that tile
  }
  at(x, y) { return y >= 0 && y < this.H && x >= 0 && x < this.W ? this.grid[y][x] : '@'; }
  occupied(x, y, except) {
    return Object.entries(this.units).some(([n, u]) => n !== except && u.x === x && u.y === y);
  }
  canStand(kind, x, y) {
    return (this.config[kind].terrain || []).includes(GROUND[this.at(x, y)]);
  }
  // Shortest route for a unit to a tile (or, `next`, to a tile beside it): its length, or -1.
  route(name, tx, ty, next) {
    const u = this.units[name];
    const goal = (x, y) => (next ? Math.abs(x - tx) + Math.abs(y - ty) === 1 : x === tx && y === ty);
    if (goal(u.x, u.y)) return 0;
    const seen = new Set([u.x + ',' + u.y]);
    let frontier = [[u.x, u.y]];
    for (let d = 1; frontier.length; d++) {
      const nextF = [];
      for (const [x, y] of frontier) {
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
          if (seen.has(k) || !this.canStand(u.kind, nx, ny) || this.occupied(nx, ny, name)) continue;
          if (goal(nx, ny)) { u.lastStop = [nx, ny]; return d; }
          seen.add(k);
          nextF.push([nx, ny]);
        }
      }
      frontier = nextF;
    }
    return -1;
  }
  drive(name, tx, ty, next) {
    const d = this.route(name, tx, ty, next);
    if (d < 0) throw new Error(name + ' cannot get to ' + tx + ',' + ty);
    const u = this.units[name];
    if (d > 0) [u.x, u.y] = next ? u.lastStop : [tx, ty];
    // (a trip to beside a pile or a site: the game's unit at times stops a tile further
    // round it than the nearest side, so a move more is counted)
    u.energy -= (d + (next ? 1 : 0)) * (this.config[u.kind].move || 0);
    // (a reserve: the game's own routes are at times longer than the shortest)
    if (u.energy < RESERVE) throw new Error(name + ' runs out of energy');
  }
  // Plays one step; throws if it cannot be done.
  play(step) {
    const u = step.unit && this.units[step.unit];
    if (step.unit && !u) throw new Error('no unit ' + step.unit);
    switch (step.op) {
      case 'go': this.drive(step.unit, ...step.to, false); return;
      case 'haul': {
        const [fx, fy] = step.from, [tx, ty] = step.to;
        const cap = this.config[u.kind].carries;
        let left = this.piles.get(fx + ',' + fy) || 0;
        if (!cap || !left) throw new Error('nothing to haul');
        while (left > 0) {
          this.drive(step.unit, fx, fy, true);
          const n = Math.min(cap, left);
          left -= n;
          this.drive(step.unit, tx, ty, true);
          this.piles.set(tx + ',' + ty, (this.piles.get(tx + ',' + ty) || 0) + n);
        }
        this.piles.delete(fx + ',' + fy);
        return;
      }
      case 'build': {
        const [x, y] = step.at;
        const recipe = this.config[step.what].recipe;
        const need = Object.values(recipe).reduce((a, b) => a + b, 0);
        let have = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) have += this.piles.get((x + dx) + ',' + (y + dy)) || 0;
        if (have < need) throw new Error('not enough bricks to build ' + step.what);
        if (this.occupied(x, y) || !this.canStand(step.what, x, y)) throw new Error('cannot build ' + step.what + ' there');
        // (the bricks used: taken from the site's own pile first)
        let take = need;
        for (let dy = -1; dy <= 1 && take; dy++) for (let dx = -1; dx <= 1 && take; dx++) {
          const k = (x + dx) + ',' + (y + dy), n = Math.min(take, this.piles.get(k) || 0);
          if (n) { this.piles.set(k, (this.piles.get(k) || 0) - n); take -= n; }
        }
        this.units[step.as] = { kind: step.what, x, y, energy: 100 * (recipe.energy || 0), cargo: 0 };
        return;
      }
      case 'dig': case 'fill': case 'uproot': case 'plant': {
        const [x, y] = step.at;
        this.drive(step.unit, x, y, true);
        const ch = this.at(x, y);
        const cfg = this.config[u.kind];
        if (step.op === 'dig') {
          if (!cfg.dig || ch !== '.' || u.cargo) throw new Error('cannot dig');
          this.grid[y][x] = 'w';
          u.cargo = 1;
        } else if (step.op === 'fill') {
          if (ch !== 'w' || !u.cargo) throw new Error('cannot fill');
          this.grid[y][x] = '.';
          u.cargo = 0;
        } else if (step.op === 'uproot') {
          if (!cfg.transplant || !TREES.has(ch) || u.cargo) throw new Error('cannot uproot');
          this.grid[y][x] = '.';
          u.cargo = ch;
        } else {
          if (ch !== '.' || !u.cargo || this.piles.has(x + ',' + y)) throw new Error('cannot plant');
          this.grid[y][x] = u.cargo;
          u.cargo = 0;
        }
        u.energy -= cfg.move || 0;
        if (u.energy < RESERVE) throw new Error(step.unit + ' runs out of energy');
      }
    }
  }
}

// ---------- the generator ----------

// The gates, and the unit each needs.
const GATES = {
  rock: { needs: ['dirtbuggy', 'dumptruck'] },
  water: { needs: ['steamshovel'] },
  trees: { needs: ['treebot'] },
};

export function generatePuzzle(configText, code, why = []) {
  const c = parseCode(code);
  if (!c) return null;
  const config = readConfig(configText);
  const rng = mulberry32(hash('wbp:' + c.code));
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const p = tryPuzzle(c, config, rng);
      if (p) return p;
    } catch (e) {
      why.push(e.message);
    }
  }
  return null;
}

const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const int = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));

function tryPuzzle(c, config, rng) {
  const look = LOOKS[c.look];
  // the gates, by difficulty: one, then two of different kinds
  const kinds = ['rock', 'water', 'trees'];
  const gates = [];
  const n = c.difficulty === 1 ? 1 : 2;
  while (gates.length < n) {
    const g = pick(rng, kinds);
    if (!gates.includes(g)) gates.push(g);
  }
  // region sizes, and the map
  const H = int(rng, 10, 13) + (c.difficulty - 1);
  const widths = gates.map(() => int(rng, 7, 9 + c.difficulty));
  widths.push(int(rng, 5, 7));
  const W = widths.reduce((a, b) => a + b, 0) + gates.length * 2 + 2;
  const grid = Array.from({ length: H }, () => new Array(W).fill('@'));
  // each region: land, its corners rounded off, a tile of hole round the map
  const regions = [];
  let x = 1;
  for (let i = 0; i < widths.length; i++) {
    const top = int(rng, 1, 2), bottom = H - 1 - int(rng, 1, 2);
    const r = { x0: x, x1: x + widths[i] - 1, y0: top, y1: bottom };
    for (let yy = r.y0; yy <= r.y1; yy++) for (let xx = r.x0; xx <= r.x1; xx++) grid[yy][xx] = '.';
    for (const [cx, cy] of [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]]) if (rng() < 0.6) grid[cy][cx] = '@';
    regions.push(r);
    x = r.x1 + 1;
    if (i < gates.length) {
      // the gate: two columns, a passage through them two or three tiles high
      const gy0 = int(rng, Math.max(r.y0, 2), Math.min(r.y1, H - 3) - 2);
      const gh = int(rng, 2, 3);
      r.gate = { kind: gates[i], x0: x, x1: x + 1, y0: gy0, y1: Math.min(gy0 + gh - 1, H - 2) };
      for (let yy = 1; yy < H - 1; yy++) {
        for (let gx = x; gx <= x + 1; gx++) {
          const inPass = yy >= r.gate.y0 && yy <= r.gate.y1;
          if (gates[i] === 'rock') grid[yy][gx] = inPass ? '_' : '@';
          else if (gates[i] === 'water') grid[yy][gx] = inPass ? 'w' : 'x';
          else grid[yy][gx] = inPass ? pick(rng, look.trees) : 'M';
        }
      }
      x += 2;
    }
  }
  // what crosses each gate, and the plans to start with
  const crossers = gates.map((g) => pick(rng, GATES[g].needs));
  const carrier = pick(rng, ['forklift', 'forklift', 'buggy']);
  const r0 = regions[0];
  const taken = [];
  const clear = (fx, fy) => grid[fy][fx] === '.' && !taken.some(([ax, ay]) => Math.abs(ax - fx) <= 1 && Math.abs(ay - fy) <= 1);
  // a free tile of a region (not next to another thing placed), anywhere or near a point
  const place = (r, near, within) => {
    for (let t = 0; t < 300; t++) {
      const fx = int(rng, r.x0 + 1, r.x1 - 1), fy = int(rng, r.y0 + 1, r.y1 - 1);
      if (near && Math.abs(fx - near[0]) + Math.abs(fy - near[1]) > within) continue;
      if (clear(fx, fy)) { taken.push([fx, fy]); return [fx, fy]; }
    }
    throw new Error('no room');
  };
  const start = place(r0);
  const units = { u0: { kind: carrier, x: start[0], y: start[1] } };
  const steps = [];
  const piles = [];            // {at, bricks: {kind: n}}
  const plans = {};
  const mapPlans = [];         // {at, what}: plans lying on the map, to be fetched
  const keepBy = regions.map(() => []);   // what each region's walls must leave reachable
  // For each gate: bricks for its unit in the region before it, hauled by whoever can
  // reach them, built by the gate, then the gate dealt with.
  let hauler = 'u0';
  let goer = 'u0';
  for (let i = 0; i < gates.length; i++) {
    const r = regions[i], g = r.gate, what = crossers[i];
    const recipe = config[what].recipe;
    // the site, by the gate's mouth
    const site = [r.x1 - 1, int(rng, g.y0, g.y1)];
    if (grid[site[1]][site[0]] !== '.') throw new Error('site');
    taken.push(site);
    keepBy[i].push(site, [r.x1, g.y0]);
    if (i === 0) keepBy[0].push(start);
    // the plan: in hand, or (the harder missions' last gate) lying in the region, fetched
    if (c.difficulty >= 2 && i === gates.length - 1) {
      const at = place(r);
      mapPlans.push({ at, what });
      keepBy[i].push(at);
      steps.push({ op: 'go', unit: hauler, to: at });
    } else {
      plans[what] = (plans[what] || 0) + 1;
    }
    // the bricks: in two to four piles, each its own trip's worth or more
    const count = int(rng, 2, Math.min(4, 1 + c.difficulty));
    const kindsOf = Object.entries(recipe).filter(([, v]) => v > 0);
    const heaps = Array.from({ length: count }, () => ({}));
    for (const [k, v] of kindsOf) {
      let left = v + (k === 'energy' ? 0 : int(rng, 0, 2));
      while (left > 0) {
        const h = heaps[Math.floor(rng() * count)];
        const m = Math.min(left, k === 'energy' ? 1 : int(rng, 2, 8));
        h[k] = (h[k] || 0) + m;
        left -= m;
      }
    }
    for (const h of heaps) {
      if (!Object.keys(h).length) continue;
      const at = place(r, site, 10);
      piles.push({ at, bricks: h });
      keepBy[i].push(at);
      steps.push({ op: 'haul', unit: hauler, from: at, to: site });
    }
    const name = 'u' + (i + 1);
    steps.push({ op: 'build', what, at: site, as: name });
    // the gate, dealt with from near its mouth
    if (g.kind === 'water') {
      for (let gx = g.x0; gx <= g.x1; gx++) {
        const pit = place(r, site, 4);
        keepBy[i].push(pit);
        steps.push({ op: 'dig', unit: name, at: pit });
        steps.push({ op: 'fill', unit: name, at: [gx, g.y0] });
      }
    } else if (g.kind === 'trees') {
      for (let gx = g.x0; gx <= g.x1; gx++) {
        steps.push({ op: 'uproot', unit: name, at: [gx, g.y0] });
        const spot = place(r, site, 4);
        keepBy[i].push(spot);
        steps.push({ op: 'plant', unit: name, at: spot });
      }
    }
    if (i + 1 < regions.length) keepBy[i + 1].push([regions[i + 1].x0, g.y0]);
    goer = name;
    // the hauler for the next region: the new unit if it carries, else the first carrier,
    // which can follow through a water or tree gate but not over rock
    if (config[what].carries) hauler = name;
    else if (g.kind === 'rock') hauler = null;
    if (!hauler) hauler = name;
  }
  // the goal, in the last region, for the last unit built (or anyone, sometimes)
  const last = regions[regions.length - 1];
  const goalAt = place(last);
  keepBy[regions.length - 1].push(goalAt);
  const goalWants = rng() < 0.7 ? crossers[crossers.length - 1] : 'anything';
  steps.push({ op: 'go', unit: goer, to: goalAt });
  // bricks nothing needs, off to one side (the harder missions)
  if (c.difficulty >= 2) {
    const r = regions[int(rng, 0, regions.length - 2)];
    try {
      const at = place(r);
      piles.push({ at, bricks: { [pick(rng, ['red', 'blue', 'green', 'white'])]: int(rng, 4, 12) } });
    } catch (e) { /* no room: none */ }
  }
  // walls of trees, mountains and rocks in the regions: grown a tile at a time, each kept
  // only if every place the solution goes to in the region can still be reached from the
  // others, so the routes wind round them
  regions.forEach((r, i) => {
    const keep = keepBy[i];
    const walls = int(rng, 2 + c.difficulty, 4 + c.difficulty * 2);
    for (let w = 0; w < walls; w++) {
      let wx = int(rng, r.x0, r.x1), wy = int(rng, r.y0, r.y1);
      const [dx, dy] = pick(rng, DIRS);
      const len = int(rng, 2, 5);
      const ch = rng() < 0.6 ? pick(rng, look.trees) : pick(rng, look.rocks);
      for (let k = 0; k < len; k++, wx += dx, wy += dy) {
        if (wx < r.x0 || wx > r.x1 || wy < r.y0 || wy > r.y1 || grid[wy][wx] !== '.') break;
        if (taken.some(([ax, ay]) => Math.abs(ax - wx) <= 1 && Math.abs(ay - wy) <= 1)) break;
        if (r.gate && wx >= r.x1 - 1 && wy >= r.gate.y0 - 1 && wy <= r.gate.y1 + 1) break;
        grid[wy][wx] = ch;
        if (!joinedOn(grid, keep)) { grid[wy][wx] = '.'; break; }
      }
    }
  });
  const model = new Model(grid, units, config);
  for (const p of piles) model.piles.set(p.at.join(), Object.values(p.bricks).reduce((a, b) => a + b, 0));
  for (const s of steps) model.play(s);
  const bonus = makeBonus(model, config, steps, piles, last, [], rng, plans, (r) => place(r));
  return finish(c, look, grid, units, piles, plans, mapPlans, goalAt, goalWants, steps, bonus);
}

// Can every one of the points be reached from the first, over open ground?
function joinedOn(grid, points) {
  if (points.length < 2) return true;
  const H = grid.length, W = grid[0].length;
  const open = (x, y) => y >= 0 && y < H && x >= 0 && x < W && grid[y][x] === '.';
  const seen = new Set([points[0].join()]);
  const stack = [points[0]];
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (seen.has(k) || !open(nx, ny)) continue;
      seen.add(k);
      stack.push([nx, ny]);
    }
  }
  return points.every((p) => seen.has(p.join()));
}

// A bonus goal: drive the first carrier into the last region, when it can get there; or
// nothing.
function makeBonus(model, config, steps, piles, last, keep, rng, plans, place) {
  const u0 = model.units.u0;
  if (!u0) return null;
  let at;
  try {
    at = place(last);
  } catch (e) {
    return null;
  }
  const trial = new Model(model.grid, {}, config);
  trial.units = JSON.parse(JSON.stringify(model.units));
  trial.piles = new Map(model.piles);
  try {
    trial.play({ op: 'go', unit: 'u0', to: at });
  } catch (e) {
    return null;
  }
  return { at, wants: u0.kind, steps: [{ op: 'go', unit: 'u0', to: at }] };
}

function finish(c, look, grid, units, piles, plans, mapPlans, goalAt, goalWants, steps, bonus) {
  const items = [];
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let li = 0;
  const g = grid.map((r) => r.slice());
  const put = (at, def) => {
    const ch = letters[li++];
    g[at[1]][at[0]] = ch;
    items.push(ch + '=' + def);
  };
  for (const [, u] of Object.entries(units)) put([u.x, u.y], 'unit,vehicle,' + u.kind);
  for (const p of piles) put(p.at, 'pile,' + Object.entries(p.bricks).map(([k, v]) => k + ',' + v).join(','));
  for (const p of mapPlans) put(p.at, 'plan,' + p.what + ',1');
  g[goalAt[1]][goalAt[0]] = '1';
  items.push('1=goal,' + goalWants);
  if (bonus) {
    g[bonus.at[1]][bonus.at[0]] = '2';
    items.push('2=bonusgoal,' + bonus.wants);
  }
  const name = 'GENERATED ' + c.code.slice(0, 2) + '-' + c.code.slice(2);
  const center = [units.u0.x + 1, units.u0.y + 1];
  const lines = ['[map]', 'name=' + name, 'center=' + center.join(','), ...g.map((r) => ' map=' + r.join('')), '',
    '[mapitems]', ...items, '', '[inventory]', ...Object.entries(plans).map(([k, v]) => k + '=' + v), ''];
  return {
    code: c.code, name, slot: look.slot, text: lines.join('\r'), rows: g.map((r) => r.join('')),
    solution: steps, bonus: bonus ? bonus.steps : [],
    // where the units start (0-based; the game counts from 1)
    units: Object.fromEntries(Object.entries(units).map(([n, u]) => [n, [u.x, u.y]])),
  };
}
