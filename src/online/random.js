// Generated missions, in the game's own map format, so the game plays them as it plays its
// own.  A generated mission is one of the game's missions remixed: its items (units, piles,
// plans, goals, monsters) and its plans to start with are the designers', and so is the
// ground right around each cluster of items, where a mission's puzzle is (a pile on an
// island, a goal in the water to fill, a boulder to push); the rest of the map is new. The
// ground between the clusters is laid out afresh in the template's proportions of land,
// water and holes, every cluster is joined to the others by land (and by water, for what
// floats), and the template's trees, mountains, rocks and swamps are scattered where they
// cut nothing off.
//
// A mission is named by a code: its world and mission (the template) and a seed, written
// like 6D-K2Q9 (world 6, mission D = 4, seed K2Q9).  The same code makes the same map.

const SEED_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford's base 32
const MISSION_CHARS = 'ABCDEFGHIJKL';                    // missions 1 to 12

// Not remixed: World One's first mission, the tutorial's; and World Three's second, whose
// plan is walled in by floating bricks to tow away, a puzzle the whole map is.
const NOT_TEMPLATES = new Set(['1.1', '3.2']);

// ---------- codes ----------

export function parseCode(code) {
  const s = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const m = /^([1-7])([A-L])([0-9A-Z]{4})$/.exec(s);
  if (!m) return null;
  const seed = m[3].replace(/O/g, '0').replace(/[IL]/g, '1');
  if ([...seed].some((c) => !SEED_CHARS.includes(c))) return null;
  const world = Number(m[1]), mission = MISSION_CHARS.indexOf(m[2]) + 1;
  if (NOT_TEMPLATES.has(world + '.' + mission)) return null;
  return { world, mission, seed, code: m[1] + m[2] + seed };
}

export function showCode(code) {
  const c = parseCode(code);
  return c ? c.code.slice(0, 2) + '-' + c.code.slice(2) : String(code);
}

// A new code for a world (or any), from Math.random: not part of a mission, so not seeded.
export function randomCode(world) {
  for (;;) {
    const w = world || 1 + Math.floor(Math.random() * 7);
    const m = 1 + Math.floor(Math.random() * 12);
    if (NOT_TEMPLATES.has(w + '.' + m)) continue;
    let seed = '';
    for (let i = 0; i < 4; i++) seed += SEED_CHARS[Math.floor(Math.random() * 32)];
    return w + MISSION_CHARS[m - 1] + seed;
  }
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

// ---------- the map format ----------

// A mission's text: its [map] (name, center, rows), and the rest as it is.
export function parseMission(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const rows = [];
  const items = {};
  let name = '', section = '', rest = [];
  for (const raw of lines) {
    const line = raw.trim();
    const sec = /^\[(\w+)\]$/.exec(line);
    if (sec) section = sec[1].toLowerCase();
    if (section === 'map') {
      if (sec || !line || line.startsWith('--')) continue;
      const eq = line.indexOf('=');
      const key = line.slice(0, eq).trim(), value = line.slice(eq + 1).trim();
      if (key === 'map') rows.push(value);
      else if (key === 'name') name = value;
      continue;
    }
    rest.push(raw);
    if (section === 'mapitems' && line && !line.startsWith('--') && !sec) {
      const eq = line.indexOf('=');
      if (eq > 0) items[line.slice(0, eq).trim()] = line.slice(eq + 1).split(',').map((f) => f.trim());
    }
  }
  return { name, rows, items, rest: rest.join('\r') };
}

// The terrainmap text: which characters are terrain (the others are items).
export function terrainChars(terrainmapText) {
  const set = new Set();
  for (const line of String(terrainmapText).replace(/\r\n?/g, '\n').split('\n')) if (line.length) set.add(line[0]);
  return set;
}

const HOLE = '@';
const LAND = '.';
const WATER = 'w';
const STREETS = new Set(['(', '[', '{', '\\', '/', ')', ']', '}', '+', '=', '-']);
const WATERS = new Set(['w', 'x', 'r']);      // water, deep water, reefs
const BOAT = new Set(['w', 'x']);             // what boats cross

// What an item stands on: water for the water kinds and for goals placed in water.
function itemOnWater(def) {
  if (!def) return false;
  if (/^water/.test(def[0]) || def[0] === 'whirlpool') return true;
  if ((def[0] === 'goal' || def[0] === 'bonusgoal') && def.length > 2 && /water/.test(def[2])) return true;
  return false;
}

function isMonster(def) {
  return !!def && /unit$/.test(def[0]) && def[1] === 'monster';
}

function isPlayerUnit(def) {
  return !!def && /unit$/.test(def[0]) && def[1] !== 'monster';
}

// ---------- the generator ----------

// Each unit's terrains, from the config: {buggy: ['normal', 'street', 'swamp'], ...}.
export function unitTerrains(configText) {
  const out = {};
  for (const line of String(configText || '').replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^#(\w+)\s*=.*?#terrain:\s*\[([^\]]*)\]/.exec(line.trim());
    if (m) out[m[1].toLowerCase()] = m[2].split(',').map((x) => x.trim().replace(/^#/, '').toLowerCase());
  }
  return out;
}

// The land every unit the player starts with can cross: normal ground, and rocky ground if
// they all can, or if the mission is mostly built on it.  (Swamps hurt, so a way is never
// made through one.)  Without a land unit to start with, the units the mission's plans
// make are asked instead.
export function groundFor(t, terrains) {
  const land = (def) => def && !/^water/.test(def[0]) && (terrains[def[2]] || []).some((x) => x === 'normal');
  let kinds = Object.values(t.items).filter((d) => d[0] === 'unit' && d[1] !== 'monster' && land(d)).map((d) => d[2]);
  if (!kinds.length) kinds = Object.values(t.items).filter((d) => d[0] === 'plan' && terrains[d[1]]).map((d) => d[1]);
  const ground = new Set([LAND]);
  if (kinds.length && kinds.every((k) => (terrains[k] || []).includes('normal_undiggable'))) ground.add('_');
  const count = (ch) => t.rows.reduce((n, r) => n + r.split(ch).length - 1, 0);
  if (count('_') > count(LAND)) ground.add('_');
  return ground;
}

// configText: the game's config member, for what ground each unit can cross; why, if
// given, collects why each attempt that failed did (for working on the generator).
export function generateMission(templateText, terrainmapText, configText, code, why) {
  const c = parseCode(code);
  if (!c) return null;
  const t = parseMission(templateText);
  if (!t.rows.length) return null;
  const terrain = terrainChars(terrainmapText);
  const ground = groundFor(t, unitTerrains(configText));
  const rng = mulberry32(hash('wb:' + c.code));
  for (let attempt = 0; attempt < 56; attempt++) {
    const map = tryGenerate(t, terrain, ground, rng, why, Math.floor(attempt / 8));
    if (map) return Object.assign(serialise(t, map, c), { ground: [...ground] });
  }
  return null;
}

function tryGenerate(t, terrain, ground, rng, why = [], grow = 0) {
  const fail = (reason) => { why.push(reason); return null; };
  const TH = t.rows.length, TW = Math.max(...t.rows.map((r) => r.length));
  const at = (x, y) => (t.rows[y] && t.rows[y][x]) || HOLE;
  const isItem = (ch) => !terrain.has(ch) && ch !== ' ';
  const feature = (ch) => isItem(ch) || ch === ':' || ch === '~';
  const classOf = (ch) => {
    if (ch === HOLE) return 'hole';
    if (WATERS.has(ch)) return 'water';
    if (isItem(ch)) return itemOnWater(t.items[ch]) ? 'water' : 'land';
    return 'land';
  };

  // the clusters: items (and goal ground, billboards) within two tiles of each other
  const feats = [];
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) if (feature(at(x, y))) feats.push([x, y]);
  if (!feats.some(([x, y]) => /[1-9]/.test(at(x, y)))) return fail('no goal');
  const parent = feats.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < feats.length; i++) {
    for (let j = i + 1; j < feats.length; j++) {
      if (Math.max(Math.abs(feats[i][0] - feats[j][0]), Math.abs(feats[i][1] - feats[j][1])) <= 2) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  feats.forEach((f, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(f);
  });
  // a cluster is its items and the ground touching them, as the template has it
  const near = new Set();
  const stamps = [...groups.values()].map((g) => {
    const cells = new Map();
    for (const [fx, fy] of g) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = fx + dx, y = fy + dy;
          if (x < 0 || y < 0 || x >= TW || y >= TH) continue;
          cells.set(x + ',' + y, [x, y, at(x, y)]);
          near.add(x + ',' + y);
        }
      }
    }
    const list = [...cells.values()];
    const x0 = Math.min(...list.map((c) => c[0])), y0 = Math.min(...list.map((c) => c[1]));
    const tiles = list.map(([x, y, ch]) => [x - x0, y - y0, ch]);
    const kinds = g.map(([x, y]) => t.items[at(x, y)]);
    return {
      w: Math.max(...tiles.map((c) => c[0])) + 1, h: Math.max(...tiles.map((c) => c[1])) + 1, tiles,
      player: kinds.some(isPlayerUnit), monster: kinds.some(isMonster),
    };
  });

  // the template's proportions, and what it has scattered about outside the clusters
  let holes = 0, waters = 0;
  const scatter = [];
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      const ch = at(x, y), k = classOf(ch);
      if (k === 'hole') holes++;
      else if (k === 'water') waters++;
      if (!near.has(x + ',' + y) && ch !== LAND && ch !== WATER && ch !== HOLE && !STREETS.has(ch) && !feature(ch)) scatter.push(ch);
    }
  }
  // (a map that will not hold its clusters is made a little bigger, in the same proportions)
  const W = TW + grow, H = TH + grow;
  const scale = (W * H) / (TW * TH);
  holes = Math.round(holes * scale);
  waters = Math.round(waters * scale);

  // new ground: holes towards the edges, water and land by smoothed noise
  const grid = Array.from({ length: H }, () => new Array(W).fill(LAND));
  const noise = smooth(W, H, rng, 2), noise2 = smooth(W, H, rng, 2);
  const cells = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y) / (Math.min(W, H) / 2);
      cells.push({ x, y, hole: noise[y][x] * 0.6 + (1 - Math.min(1, edge)) * 0.8, water: noise2[y][x] });
    }
  }
  cells.sort((a, b) => b.hole - a.hole);
  cells.slice(0, holes).forEach((p) => { grid[p.y][p.x] = HOLE; });
  const solid = cells.slice(holes).sort((a, b) => a.water - b.water);
  solid.slice(0, waters).forEach((p) => { grid[p.y][p.x] = WATER; });

  // the clusters, those with the player's units first, the monsters' far from them
  const taken = Array.from({ length: H }, () => new Array(W).fill(false));
  const order = stamps.slice().sort((a, b) => (b.player - a.player) || (b.tiles.length - a.tiles.length));
  const playerSpots = [];
  for (const s of order) {
    let best = null;
    for (let tries = 0; tries < 80; tries++) {
      const ox = Math.floor(rng() * (W - s.w + 1)), oy = Math.floor(rng() * (H - s.h + 1));
      let score = 0;
      const free = s.tiles.every(([x, y, ch]) => {
        if (taken[oy + y][ox + x]) return false;
        if (classOf(ch) === classOf(grid[oy + y][ox + x])) score++;
        return true;
      });
      if (!free) continue;
      if (s.monster && playerSpots.length) {
        const cx = ox + s.w / 2, cy = oy + s.h / 2;
        score += 0.5 * Math.min(...playerSpots.map(([px, py]) => Math.abs(px - cx) + Math.abs(py - cy)));
      }
      if (!best || score > best.score) best = { ox, oy, score };
    }
    if (!best) return fail('no room for a cluster ' + s.w + 'x' + s.h);
    for (const [x, y, ch] of s.tiles) {
      grid[best.oy + y][best.ox + x] = ch;
      taken[best.oy + y][best.ox + x] = true;
    }
    if (s.player) playerSpots.push([best.ox + s.w / 2, best.oy + s.h / 2]);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (STREETS.has(grid[y][x])) grid[y][x] = LAND;

  // everything joined up: what floats by water, then everything else by land
  const items = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (feature(grid[y][x])) items.push([x, y, grid[y][x]]);
  const onWater = (ch) => isItem(ch) && itemOnWater(t.items[ch]);
  const landNeeded = items.filter(([, , ch]) => !onWater(ch) && !isMonster(t.items[ch]));
  const waterNeeded = items.filter(([, , ch]) => onWater(ch) && !isMonster(t.items[ch]));
  const landOpen = (ch) => ground.has(ch) || ch === ':' || ch === '~' || (isItem(ch) && !onWater(ch));
  const waterOpen = (ch) => BOAT.has(ch) || onWater(ch);
  const fixed = (ch) => feature(ch);
  for (let round = 0; round < 3; round++) {
    if (!join(grid, waterNeeded, waterOpen, WATER, fixed)) return fail('water not joined');
    if (!join(grid, landNeeded, landOpen, LAND, fixed)) return fail('land not joined');
    if (joined(grid, waterNeeded, waterOpen) && joined(grid, landNeeded, landOpen)) break;
  }
  if (!joined(grid, waterNeeded, waterOpen) || !joined(grid, landNeeded, landOpen)) return fail('joining undid itself');

  // the template's trees, rocks, mountains and swamps, where they cut nothing off
  shuffle(scatter, rng);
  const free = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!taken[y][x]) free.push([x, y]);
  shuffle(free, rng);
  for (const ch of scatter) {
    const water = WATERS.has(ch);
    const spot = free.findIndex(([x, y]) => grid[y][x] === (water ? WATER : LAND));
    if (spot < 0) continue;
    const [x, y] = free[spot];
    free.splice(spot, 1);
    const was = grid[y][x];
    grid[y][x] = ch;
    if (!joined(grid, landNeeded, landOpen) || !joined(grid, waterNeeded, waterOpen)) grid[y][x] = was;
  }
  return grid;
}

// Smoothed noise in 0..1.
function smooth(W, H, rng, passes) {
  let g = Array.from({ length: H }, () => Array.from({ length: W }, rng));
  for (let p = 0; p < passes; p++) {
    g = g.map((row, y) => row.map((_, x) => {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const r = g[y + dy];
        if (r && r[x + dx] !== undefined) { s += r[x + dx]; n++; }
      }
      return s / n;
    }));
  }
  return g;
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// The parts of the open ground, numbered (4 ways, as the game's units move).
function parts(grid, open) {
  const H = grid.length, W = grid[0].length;
  const part = Array.from({ length: H }, () => new Array(W).fill(-1));
  let n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (part[y][x] >= 0 || !open(grid[y][x])) continue;
      const stack = [[x, y]];
      part[y][x] = n;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx, ny = cy + dy;
          if (ny < 0 || ny >= H || nx < 0 || nx >= W || part[ny][nx] >= 0 || !open(grid[ny][nx])) continue;
          part[ny][nx] = n;
          stack.push([nx, ny]);
        }
      }
      n++;
    }
  }
  return part;
}

function joined(grid, needed, open) {
  if (needed.length < 2) return true;
  const part = parts(grid, open);
  const p0 = part[needed[0][1]][needed[0][0]];
  return needed.every(([x, y]) => part[y][x] === p0 && p0 >= 0);
}

// Join every needed tile's part to the first's, digging the cheapest way through what is
// between (never through an item or goal ground): ground of the right kind costs nothing,
// anything else one, the clusters' own ground five, so that their puzzles are left alone
// where they can be.
function join(grid, needed, open, carve, fixed) {
  if (needed.length < 2) return true;
  const H = grid.length, W = grid[0].length;
  for (let guard = 0; guard < 40; guard++) {
    const part = parts(grid, open);
    const main = part[needed[0][1]][needed[0][0]];
    const other = needed.find(([x, y]) => part[y][x] !== main);
    if (!other) return true;
    const target = part[other[1]][other[0]];
    // a cheapest path from the main part to the other's (Dijkstra over small costs)
    const cost = Array.from({ length: H }, () => new Array(W).fill(Infinity));
    const from = Array.from({ length: H }, () => new Array(W).fill(null));
    const queue = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (main >= 0 && part[y][x] === main) { cost[y][x] = 0; queue.push([0, x, y]); }
    if (main < 0) { cost[needed[0][1]][needed[0][0]] = 0; queue.push([0, needed[0][0], needed[0][1]]); }
    let end = null;
    while (queue.length) {
      queue.sort((a, b) => a[0] - b[0]);
      const [c, x, y] = queue.shift();
      if (c > cost[y][x]) continue;
      if ((target >= 0 && part[y][x] === target) || (x === other[0] && y === other[1])) { end = [x, y]; break; }
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (ny < 0 || ny >= H || nx < 0 || nx >= W) continue;
        const ch = grid[ny][nx];
        const isTarget = (target >= 0 && part[ny][nx] === target) || (nx === other[0] && ny === other[1]);
        if (fixed(ch) && !isTarget && !open(ch)) continue;
        const step = open(ch) ? 0 : (ch === LAND || ch === WATER || ch === HOLE ? 1 : 2);
        const nc = c + step;
        if (nc < cost[ny][nx]) { cost[ny][nx] = nc; from[ny][nx] = [x, y]; queue.push([nc, nx, ny]); }
      }
    }
    if (!end) return false;
    for (let p = end; p; p = from[p[1]][p[0]]) {
      const ch = grid[p[1]][p[0]];
      if (!open(ch) && !fixed(ch)) grid[p[1]][p[0]] = carve;
    }
  }
  return false;
}

function serialise(t, grid, c) {
  // the view starts on the player's first unit, else on the first goal
  let center = null;
  for (let y = 0; y < grid.length && !center; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (isPlayerUnit(t.items[grid[y][x]])) { center = [x + 1, y + 1]; break; }
    }
  }
  for (let y = 0; y < grid.length && !center; y++) {
    for (let x = 0; x < grid[y].length; x++) if (/[1-9]/.test(grid[y][x])) { center = [x + 1, y + 1]; break; }
  }
  const name = 'RANDOM ' + c.code.slice(0, 2) + '-' + c.code.slice(2);
  const lines = ['[map]', 'name=' + name, 'center=' + center.join(','), ...grid.map((r) => ' map=' + r.join('')), ''];
  return { text: lines.join('\r') + '\r' + t.rest, name, rows: grid.map((r) => r.join('')), template: c.world + '.' + c.mission };
}
