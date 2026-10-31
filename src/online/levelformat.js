// Custom levels: what one is, as the level editor (src/online/editor.js) makes it and the server
// (server/src/levels.js) keeps it, and the game's own map text made from it.  The same module on
// both sides: what the editor lets through, the server checks again, and only the server's own
// text, made here from a level that passed, is ever given to the game.
//
// A level:
//   { v: 1, name, sky: 1..7 (the world it is played in: its sky and its music),
//     rows: ['....', ...] (the ground, a terrain character a tile: TERRAIN),
//     items: [{ x, y, t, ... }] (on a tile each; land items on ground, water items on water):
//       { t: 'pile', bricks: { red: 10, energy: 1, ... } }
//       { t: 'plan', what: 'buggy', n: 1 }           a plan lying there (n of them)
//       { t: 'unit', cls: 'vehicle'|'building'|'monster', kind }
//       { t: 'goal' | 'bonus', want: kind | 'anything' | { collect: n, kind } }
//       { t: 'whirl', id }                          whirlpools of an id take a unit between them
//     inventory: { buggy: 3, ... } (plans in hand),
//     center: [x, y] (where the view starts; optional) }
// Whether an item is a water one is its tile's: on water it is, on ground it is not.
//
// The game reads the text with its own parseParams and value(), which reads Lingo literals and
// nothing else (src/director/lingo.js): no text can run anything.  Even so, nothing goes in that
// is not one of these: the characters of TERRAIN, the kinds of KINDS, whole numbers in range.

// The ground: each character as the game's map reader has it (map_display's pterrainlookup).
export const TERRAIN = {
  '.': 'normal', '_': 'normal_undiggable', ':': 'goal', '#': 'swamp', '@': 'hole',
  w: 'water', x: 'water_undiggable', r: 'water_reefs',
  T: 'tree', '!': 'tree2', "'": 'tree3', '?': 'tree4',
  M: 'mountain', '^': 'volcano', '%': 'jungle1', '&': 'jungle2', '$': 'jungle3', '*': 'jungle4', '~': 'billboard',
  '`': 'cement', '>': 'roadblock', '-': 'street_undiggable',
  '(': 'street1', '[': 'street2', '{': 'street3', '\\': 'street4', '/': 'street5', ')': 'street6', ']': 'street7', '}': 'street8', '+': 'street9', '=': 'street10',
};
const WATER = new Set(['w', 'x', 'r']);
// (what a land item, or a water one, may stand on: the game puts it on plain ground or water)
const LAND_UNDER = '.', WATER_UNDER = 'w';

// What may be put on the map and in hand: the game's own units, buildings and monsters (its
// "config" text; tools/verify checks these against it).
export const KINDS = {
  vehicle: ['buggy', 'dirtbuggy', 'forklift', 'dumptruck', 'steamshovel', 'dozer', 'treebot', 'repairbot', 'duck', 'frog', 'fish', 'snail',
    'tugboat', 'freighter', 'speedboat', 'defender', 'defender2', 'defender3', 'freezebot', 'bluebird'],
  building: ['house', 'gas_station', 'robot_lab', 'guard_tower', 'factory', 'windmill', 'garage', 'nursery', 'marina'],
  monster: ['crab', 'lion', 'scorpion', 'trex', 'gator', 'shark', 'water_crab', 'boulder'],
};
export const BRICKS = ['red', 'yellow', 'green', 'blue', 'white', 'wheel', 'energy'];
const PLANNABLE = KINDS.vehicle.concat(KINDS.building);
const ALL_KINDS = new Set(PLANNABLE.concat(KINDS.monster));

export const LIMITS = { minW: 4, minH: 4, maxW: 48, maxH: 32, itemKinds: 31, planKinds: 10, name: 30, bricks: 999, planN: 20, inHand: 99, whirlIds: 30 };

// ---------- the game's text to a level (a campaign map, to start one from) ----------

export function parseMap(text) {
  const lines = String(text).split(/\r\n?|\n/);
  let sect = '';
  const rows = [], defs = {}, inventory = {};
  let name = '', center = null;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l || l.startsWith('--')) continue;
    if (l.startsWith('[')) { sect = l.toLowerCase().replace(/\].*/, ']'); continue; }
    const eq = l.indexOf('=');
    if (eq < 0) continue;
    const k = l.slice(0, eq).trim(), v = l.slice(eq + 1);
    if (sect === '[map]') {
      if (k.toLowerCase() === 'map') rows.push(v.replace(/\s+$/, '').replace(/--.*$/, ''));
      else if (k.toLowerCase() === 'name') name = v.trim();
      else if (k.toLowerCase() === 'center') { const c = v.split(',').map((n) => parseInt(n, 10)); if (c.length === 2 && c.every(Number.isFinite)) center = c; }
    // (a key given twice is the first's, as the game's property list has it: 2.7's b)
    } else if (sect === '[mapitems]') { if (!(k.toLowerCase() in defs)) defs[k.toLowerCase()] = v.split(',').map((s) => s.trim()); }
    else if (sect === '[inventory]') { const n = parseInt(v, 10); if (Number.isFinite(n) && n > 0) inventory[k.toLowerCase()] = n; }
  }
  const W = Math.max(...rows.map((r) => r.length));
  const items = [];
  const grid = rows.map((r, y) => [...r.padEnd(W, '@')].map((ch, x) => {
    if (TERRAIN[ch] !== undefined) return ch;
    // (an item's key is the game's symbol: upper or lower case alike)
    const d = defs[ch.toLowerCase()];
    if (!d) return '@';
    const it = itemOf(d);
    if (!it) return '@';
    items.push(Object.assign({ x, y }, it.item));
    return it.water ? WATER_UNDER : LAND_UNDER;
  }));
  // (a map's own view may start off it: kept on it)
  if (center) center = [Math.max(0, Math.min(W - 1, center[0])), Math.max(0, Math.min(grid.length - 1, center[1]))];
  return { v: 1, name, sky: 1, rows: grid.map((r) => r.join('')), items, inventory, center };
}

// A [mapitems] definition: the item, and whether it is a water one.
function itemOf(d) {
  const t = (d[0] || '').toLowerCase();
  const water = t.startsWith('water');
  const base = water ? t.slice(5) : t;
  if (base === 'pile') {
    const bricks = {};
    for (let i = 1; i + 1 < d.length; i += 2) bricks[d[i].toLowerCase()] = (bricks[d[i].toLowerCase()] || 0) + (parseInt(d[i + 1], 10) || 0);
    return { water, item: { t: 'pile', bricks } };
  }
  if (base === 'plan') return { water, item: { t: 'plan', what: (d[1] || '').toLowerCase(), n: parseInt(d[2], 10) || 1 } };
  if (base === 'unit') return { water, item: { t: 'unit', cls: (d[1] || '').toLowerCase(), kind: (d[2] || '').toLowerCase() } };
  if (t === 'goal' || t === 'bonusgoal') {
    const rest = d.slice(1).map((s) => s.toLowerCase()).filter(Boolean);
    const onWater = rest[rest.length - 1] === 'water';
    if (onWater) rest.pop();
    let want = rest[0] || 'anything';
    const m = /^collect\s+(\d+)\s+(\w+)$/.exec(want);
    if (m) want = { collect: parseInt(m[1], 10), kind: m[2] };
    return { water: onWater, item: { t: t === 'goal' ? 'goal' : 'bonus', want } };
  }
  if (t === 'whirlpool') return { water: true, item: { t: 'whirl', id: parseInt(d[1], 10) || 1 } };
  return null;
}

// ---------- a level to the game's text ----------

// The keys an item may have on the map: none of the terrain's characters, and none twice in
// either case (the game looks an item's key up as a symbol: A and a are one).  1 and 2 are the
// goal's and the bonus goal's; with the rest, as many as the game has room for.
const KEYS = 'abcdefghijklmnopqstuvyz0345678'.split('').filter((c) => TERRAIN[c] === undefined);

function defOf(it, water) {
  const w = water ? 'water' : '';
  switch (it.t) {
    case 'pile': return w + 'pile,' + BRICKS.filter((b) => it.bricks[b] > 0).map((b) => b + ',' + it.bricks[b]).join(',');
    case 'plan': return w + 'plan,' + it.what + ',' + (it.n || 1);
    case 'unit': return w + 'unit,' + it.cls + ',' + it.kind;
    case 'goal': case 'bonus': {
      const want = typeof it.want === 'object' ? 'collect ' + it.want.collect + ' ' + it.want.kind : it.want;
      return (it.t === 'goal' ? 'goal,' : 'bonusgoal,') + want + (water ? ',water' : '');
    }
    case 'whirl': return 'whirlpool,' + it.id;
    default: throw new Error('no such item ' + it.t);
  }
}

// The text for the game (the level checked first: validate).  The goal's key is 1 and the bonus
// goal's 2, as the game's own maps have them.
export function toMapText(level) {
  const grid = level.rows.map((r) => [...r]);
  const keys = new Map();
  const lines = [];
  const order = level.items.filter((it) => it.t === 'goal').concat(level.items.filter((it) => it.t === 'bonus'), level.items.filter((it) => it.t !== 'goal' && it.t !== 'bonus'));
  let k = 0;
  const firsts = new Set();
  for (const it of order) {
    const water = WATER.has(grid[it.y][it.x]);
    const def = defOf(it, water);
    if (!keys.has(def)) {
      const first = (it.t === 'goal' || it.t === 'bonus') && !firsts.has(it.t);
      if (first) firsts.add(it.t);
      const key = first ? (it.t === 'goal' ? '1' : '2') : KEYS[k++];
      if (!key) throw new Error('too many kinds of item');
      keys.set(def, key);
      lines.push(key + '=' + def);
    }
    grid[it.y][it.x] = keys.get(def);
  }
  const center = level.center || [Math.floor(level.rows[0].length / 2), Math.floor(level.rows.length / 2)];
  return ['[map]', 'name=' + cleanText(level.name), 'center=' + center.join(','), ...grid.map((r) => ' map=' + r.join('')), '',
    '[mapitems]', ...lines, '', '[inventory]', ...Object.entries(level.inventory || {}).filter(([, n]) => n > 0).map(([kind, n]) => kind + '=' + n), ''].join('\r');
}

// (a name in the text: letters, digits, spaces and plain punctuation, upper case as the game
// shows mission names, nothing the reader would take for its own: no = [ ] , or line ends)
export function cleanText(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9 !?.'&-]/g, '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.name);
}

// ---------- the checks ----------

// What is wrong with a level, if anything: [] when it may be played and uploaded.  Anything not
// of the shape above is turned down whole, so that a level from anywhere but the editor is no
// risk (the server runs this on every upload).
export function validate(level) {
  const errs = [];
  const bad = (why) => { errs.push(why); return errs; };
  if (!level || typeof level !== 'object' || Array.isArray(level)) return bad('not a level');
  if (level.v !== 1) return bad('not a version this game reads');
  const allowed = new Set(['v', 'name', 'sky', 'rows', 'items', 'inventory', 'center']);
  for (const k of Object.keys(level)) if (!allowed.has(k)) return bad('unknown field ' + String(k).slice(0, 20));
  if (typeof level.name !== 'string' || !cleanText(level.name)) bad('it needs a name');
  else if (level.name.length > LIMITS.name) bad('a name of at most ' + LIMITS.name + ' letters');
  if (!Number.isInteger(level.sky) || level.sky < 1 || level.sky > 7) bad('no such sky');
  const rows = level.rows;
  if (!Array.isArray(rows) || rows.length < LIMITS.minH || rows.length > LIMITS.maxH) return bad('the map is ' + LIMITS.minH + ' to ' + LIMITS.maxH + ' tiles high');
  const W = typeof rows[0] === 'string' ? rows[0].length : 0;
  if (W < LIMITS.minW || W > LIMITS.maxW) return bad('the map is ' + LIMITS.minW + ' to ' + LIMITS.maxW + ' tiles wide');
  for (const r of rows) {
    if (typeof r !== 'string' || r.length !== W) return bad('the rows are not all as wide');
    for (const ch of r) if (TERRAIN[ch] === undefined) return bad('no such ground');
  }
  if (!Array.isArray(level.items) || level.items.length > W * rows.length) return bad('items');
  const taken = new Set();
  const defs = new Set(), plans = new Set();
  let goals = 0, bonuses = 0;
  const whirls = {};
  for (const it of level.items) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return bad('not an item');
    if (!Number.isInteger(it.x) || !Number.isInteger(it.y) || it.x < 0 || it.y < 0 || it.x >= W || it.y >= rows.length) return bad('an item off the map');
    const k = it.x + ',' + it.y;
    if (taken.has(k)) return bad('two items on one tile (' + k + ')');
    taken.add(k);
    const under = rows[it.y][it.x];
    const water = WATER.has(under);
    if (it.t !== 'whirl' && under !== LAND_UNDER && under !== WATER_UNDER) bad('an item on ' + TERRAIN[under] + ' at ' + k + ' (only on plain ground or water)');
    const fields = { pile: ['bricks'], plan: ['what', 'n'], unit: ['cls', 'kind'], goal: ['want'], bonus: ['want'], whirl: ['id'] }[it.t];
    if (!fields) return bad('no such item');
    for (const f of Object.keys(it)) if (!['x', 'y', 't', ...fields].includes(f)) return bad('unknown item field ' + String(f).slice(0, 20));
    switch (it.t) {
      case 'pile': {
        if (!it.bricks || typeof it.bricks !== 'object' || Array.isArray(it.bricks)) return bad('a pile without bricks');
        const ks = Object.keys(it.bricks);
        if (!ks.length) bad('an empty pile at ' + k);
        for (const b of ks) if (!BRICKS.includes(b) || !Number.isInteger(it.bricks[b]) || it.bricks[b] < 1 || it.bricks[b] > LIMITS.bricks) return bad('a pile of 1 to ' + LIMITS.bricks + ' bricks of each colour');
        break;
      }
      case 'plan':
        if (!PLANNABLE.includes(it.what)) return bad('no such plan');
        if (!Number.isInteger(it.n) || it.n < 1 || it.n > LIMITS.planN) return bad('a plan for 1 to ' + LIMITS.planN);
        plans.add(it.what);
        break;
      case 'unit':
        if (!KINDS[it.cls] || !KINDS[it.cls].includes(it.kind)) return bad('no such unit');
        break;
      case 'goal': case 'bonus': {
        const w = it.want;
        if (typeof w === 'string') { if (w !== 'anything' && !ALL_KINDS.has(w)) return bad('no such goal'); }
        else if (!w || typeof w !== 'object' || Object.keys(w).some((f) => f !== 'collect' && f !== 'kind') || !Number.isInteger(w.collect) || w.collect < 1 || w.collect > 20 || !ALL_KINDS.has(w.kind)) return bad('no such goal');
        if (it.t === 'goal') goals++; else bonuses++;
        break;
      }
      case 'whirl':
        if (!Number.isInteger(it.id) || it.id < 1 || it.id > LIMITS.whirlIds) return bad('a whirlpool numbered 1 to ' + LIMITS.whirlIds);
        if (!water) bad('a whirlpool on dry ground at ' + k);
        whirls[it.id] = (whirls[it.id] || 0) + 1;
        break;
    }
    defs.add(it.t === 'whirl' ? 'w' + it.id : defOf(it, water));
  }
  if (goals < 1 || goals > 8) bad('a goal (one to eight of its tiles)');
  if (bonuses > 8) bad('no more than eight bonus goal tiles');
  for (const [id, n] of Object.entries(whirls)) if (n < 2) bad('whirlpool ' + id + ' has nowhere to go');
  if (defs.size > LIMITS.itemKinds) bad('more than ' + LIMITS.itemKinds + ' kinds of item');
  const inv = level.inventory;
  if (!inv || typeof inv !== 'object' || Array.isArray(inv)) return bad('plans in hand');
  for (const [kind, n] of Object.entries(inv)) {
    if (!PLANNABLE.includes(kind)) return bad('no such plan in hand');
    if (!Number.isInteger(n) || n < 0 || n > LIMITS.inHand) return bad('0 to ' + LIMITS.inHand + ' plans of a kind in hand');
    if (n > 0) plans.add(kind);
  }
  if (plans.size > LIMITS.planKinds) bad('more than ' + LIMITS.planKinds + ' kinds of plan');
  if (level.center != null && (!Array.isArray(level.center) || level.center.length !== 2 || !level.center.every(Number.isInteger)
    || level.center[0] < 0 || level.center[1] < 0 || level.center[0] >= W || level.center[1] >= rows.length)) bad('where the view starts');
  return errs;
}
