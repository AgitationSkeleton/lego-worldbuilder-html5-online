// Generated missions: puzzles made from the game's own rules, each with a solution that is
// played through before the mission is given (and, offline, by tools/verify/puzzles.py in
// the game itself).
//
// A mission (Rando v2: src/online/puzzle/gen.js) is two to five areas of all sizes, shaped
// like the games' own islands (worn edges, points and lobes, coasts, mazes), each link
// between them one of the game's obstacles: rocky ground, water to fill, trees to move,
// boulders to push (a small pushing puzzle), a tree or boulder a factory turns into
// bricks, a river a boat carries bricks over, ponds joined by whirlpools, water a duck or
// frog swims, a swamp only a defender wades, a monster's den a freezebot holds frozen,
// each as often as the look's world has it.  What gets past each is built from bricks
// found by its site, fetched from elsewhere, made by a windmill or a garage, or got by
// taking a unit apart; its plan is in hand or lies somewhere to fetch.  The goal is mostly
// a unit brought somewhere from well away or a building built from bricks brought to it;
// rarely a boulder pushed into a nook or a monster let onto a yellow goal area; the bonus
// goal is another of those, and every mission has both.  Monsters roam ground of their
// own.  The areas are dressed with the look's trees, rocks, ponds, swamp, rocky ground and
// (in the city) streets, each kept only if the solution still plays.
//
// The solution is a list of steps, as the game's own controls do them, each naming the
// tile its unit stands on to act (see src/online/puzzle/model.js for the model of the
// rules they are played through):
//   {op: 'go', unit, to}                         drive there
//   {op: 'pick'|'drop', unit, at, stand}         pick up from / drop onto a tile beside
//   {op: 'dig'|'fill'|'uproot'|'plant', ...}     the same, for the ground
//   {op: 'push', unit, at, stand}                a bulldozer pushes what is on `at`
//   {op: 'whirl', unit, at, out}                 into a whirlpool, out of its partner
//   {op: 'build', what, at, as}                  build from a plan, naming it `as`
//   {op: 'take', unit}                           take a unit apart into its bricks
//   {op: 'color', unit, times}                   change a factory's colour
//   {op: 'wait', unit, at|made}                  a building makes bricks (or wheels)
//   {op: 'regate', unit, at, stand, back}        (v2) a treebot takes up the tree between a
//                                                monster's den and its goal area, backs
//                                                off and plants it where it stood
//   {op: 'wander', unit, to}                     (v2) a monster wanders (or is lured) to a
//                                                tile: the player waits for it
//
// A mission is named by a code: its difficulty (1 to 3), its look (A grass, B prehistoric,
// C jungle, D city, E ocean) and a seed, written like 2C-K2Q9X.  The seed's length says
// which generator made it: four characters, the first one (Rando v1, kept as it was in
// src/online/puzzle/v1/ so that its codes make the missions they always made, and only
// for the looks A to D); five, the one in use (Rando v2).

import { readConfig } from './puzzle/config.js';
import { Gen, Fail } from './puzzle/gen.js';
import { LOOKS, Rng } from './puzzle/world.js';
import { Gen as Gen1, Fail as Fail1 } from './puzzle/v1/gen.js';
import { LOOKS as LOOKS1, Rng as Rng1 } from './puzzle/v1/world.js';

export { readConfig };

const SEED_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford's base 32

// The generators, newest first: a code's version is its seed's length less three.
export const GENERATORS = [
  { version: 2, name: 'Rando v2', looks: 'ABCDE' },
  { version: 1, name: 'Rando v1', looks: 'ABCD' },
];
export const LATEST = GENERATORS[0].version;

// ---------- codes ----------

export function parseCode(code) {
  const s = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const m = /^([1-3])([A-E])([0-9A-Z]{4,5})$/.exec(s);
  if (!m) return null;
  const seed = m[3].replace(/O/g, '0').replace(/[IL]/g, '1');
  if ([...seed].some((c) => !SEED_CHARS.includes(c))) return null;
  const version = seed.length - 3;
  if (!GENERATORS.find((g) => g.version === version).looks.includes(m[2])) return null;
  return { difficulty: Number(m[1]), look: m[2], seed, code: m[1] + m[2] + seed, version };
}

export function showCode(code) {
  const c = parseCode(code);
  return c ? c.code.slice(0, 2) + '-' + c.code.slice(2) : String(code);
}

// A new code: for the generator asked for (the newest by default), at a difficulty and a
// look (any, if not given or not one that generator has).
export function randomCode(difficulty, look, version = LATEST) {
  const gen = GENERATORS.find((g) => g.version === version) || GENERATORS[0];
  const d = difficulty || 1 + Math.floor(Math.random() * 3);
  const l = look && gen.looks.includes(look) ? look : gen.looks[Math.floor(Math.random() * gen.looks.length)];
  let seed = '';
  for (let i = 0; i < gen.version + 3; i++) seed += SEED_CHARS[Math.floor(Math.random() * 32)];
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

// ---------- the generator ----------

// The mission a code makes, or null (`why` collects the reasons attempts were turned down).
export function generatePuzzle(configText, code, why = []) {
  const c = parseCode(code);
  if (!c) return null;
  const cfg = typeof configText === 'string' ? readConfig(configText) : configText;
  const v1 = c.version === 1;
  const G = v1 ? Gen1 : Gen, F = v1 ? Fail1 : Fail;
  const rng = new (v1 ? Rng1 : Rng)(mulberry32(hash((v1 ? 'wbp2:' : 'wbp3:') + c.code)));
  for (let attempt = 0; attempt < 80; attempt++) {
    const g = new G(cfg, c, rng);
    try {
      g.run();
      return finish(c, g);
    } catch (e) {
      if (!(e instanceof F)) throw e;
      why.push(e.message);
    }
  }
  return null;
}

function finish(c, g) {
  const look = (c.version === 1 ? LOOKS1 : LOOKS)[c.look];
  const name = 'GENERATED ' + c.code.slice(0, 2) + '-' + c.code.slice(2);
  const first = g.world.items.find((it) => it.t === 'unit' && it.cls === 'vehicle') || g.world.items.find((it) => it.t === 'pile');
  const center = first ? [first.at[0] + 1, first.at[1] + 1] : [Math.round(g.world.W / 2), Math.round(g.world.H / 2)];
  const { text, rows } = g.world.text(name, center);
  const units = {};
  for (const it of g.world.items) if (it.t === 'unit') units[it.name] = it.at.slice();
  return {
    code: c.code, version: c.version, name, slot: look.slot, text, rows,
    solution: g.steps, bonus: g.bonusSteps,
    // where the units, buildings and monsters on the map start (0-based; the game counts
    // from 1)
    units,
    // and what each is: {kind, cls} ('vehicle', 'monster')
    pieces: g.world.items.filter((it) => it.t === 'unit').map((it) => ({ kind: it.kind, cls: it.cls })),
    goal: g.goalKind, bonusGoal: g.bonusKind,
    tags: [...g.tags].sort(),
  };
}
