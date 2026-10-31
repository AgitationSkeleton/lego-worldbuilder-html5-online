// The custom levels' format (src/online/levelformat.js) against the campaign: every one of World
// Builder's and World Builder 2's maps read into a level, checked, and written back, the text
// meaning to the game what the map's own does (the same ground, the same item on each tile, the
// same plans in hand); its kinds against the game's config; and levels made to be refused.
//   node tools/verify/levelformat.mjs
import { readFileSync } from 'node:fs';
import { parseMap, toMapText, validate, KINDS, TERRAIN } from '../../src/online/levelformat.js';
import { readConfig } from '../../src/online/puzzle/config.js';

const data = JSON.parse(readFileSync(new URL('../../data/merged.json', import.meta.url), 'utf8'));
let fails = 0;
const ok = (c, what) => { if (!c) fails++; if (!c || process.argv.includes('-v')) console.log((c ? 'ok   ' : 'FAIL ') + what); };

// (what a map's text means: each tile's ground or item, the items' definitions spelled out,
// and the plans in hand)
function meaning(text) {
  const lines = String(text).split(/\r\n?|\n/);
  let sect = '';
  const rows = [], defs = {}, inv = {};
  for (const raw of lines) {
    const l = raw.trim();
    if (!l || l.startsWith('--')) continue;
    if (l.startsWith('[')) { sect = l.toLowerCase().replace(/\].*/, ']'); continue; }
    const eq = l.indexOf('=');
    if (eq < 0) continue;
    const k = l.slice(0, eq).trim(), v = l.slice(eq + 1);
    if (sect === '[map]' && k.toLowerCase() === 'map') rows.push(v.replace(/\s+$/, '').replace(/--.*$/, ''));
    if (sect === '[mapitems]' && !(k.toLowerCase() in defs)) defs[k.toLowerCase()] = v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (sect === '[inventory]') { const n = parseInt(v, 10); if (n > 0) inv[k.toLowerCase()] = n; }
  }
  const W = Math.max(...rows.map((r) => r.length));
  const norm = (d) => {
    if (!d) return null;
    const t = d[0];
    if (/pile$/.test(t)) {
      const b = {};
      for (let i = 1; i + 1 < d.length; i += 2) b[d[i]] = (b[d[i]] || 0) + parseInt(d[i + 1], 10);
      return t + ':' + Object.keys(b).sort().map((k) => k + '=' + b[k]).join(',');
    }
    if (t === 'goal' || t === 'bonusgoal') return t + ':' + d.slice(1).join(' ').replace(/\s+/g, ' ');
    return d.join(',');
  };
  const tiles = rows.map((r) => [...r.padEnd(W, '@')].map((ch) => (TERRAIN[ch] !== undefined ? 'T' + ch : 'I' + norm(defs[ch.toLowerCase()]))));
  return JSON.stringify({ tiles, inv: Object.keys(inv).sort().map((k) => k + '=' + inv[k]) });
}

let n = 0;
for (const c of data.casts) for (const m of Object.values(c.members)) {
  const mm = /^map(\d)\.(\d+)$/.exec(m.name || '');
  if (!mm || !m.text) continue;
  n++;
  const id = mm[1] + '.' + mm[2];
  const level = parseMap(m.text);
  level.sky = Number(mm[1]);
  const errs = validate(level);
  ok(!errs.length, id + ' reads into a level that passes: ' + errs.slice(0, 3).join('; '));
  if (errs.length) continue;
  const text = toMapText(level);
  ok(meaning(text) === meaning(m.text), id + ' is written back as the game had it');
  // and once more round: the same level
  const again = parseMap(text);
  again.sky = level.sky;
  ok(JSON.stringify(again.rows) === JSON.stringify(level.rows) && again.items.length === level.items.length, id + ' reads back the same');
}
ok(n === 84, 'all 84 campaign maps: ' + n);

// the kinds are the game's
let cfgText = '';
for (const c of data.casts) for (const m of Object.values(c.members)) if (m.name === 'config' && !cfgText) cfgText = m.text;
const cfg = readConfig(cfgText);
for (const cls of ['vehicle', 'building', 'monster']) for (const k of KINDS[cls]) ok(cfg[k] && cfg[k].cls === cls, k + ' is a ' + cls + ' of the game\'s');
// (all but those the game has no pictures for, or no script: on the map they would be unseen, or
// not made at all; no campaign map has them)
const UNSEEN = ['defender2', 'defender3', 'bluebird'];
for (const [k, v] of Object.entries(cfg)) if (['vehicle', 'building', 'monster'].includes(v.cls)) {
  if (UNSEEN.includes(k)) ok(!KINDS[v.cls].includes(k), 'the game\'s ' + v.cls + ' ' + k + ' (no pictures) may not be placed');
  else ok(KINDS[v.cls].includes(k), 'the game\'s ' + v.cls + ' ' + k + ' may be placed');
}
const pictures = new Set();
for (const c of data.casts) for (const m of Object.values(c.members)) if (m.name) pictures.add(m.name.toLowerCase());
for (const k of UNSEEN) ok(![...pictures].some((n) => n.startsWith('vehicle.' + k + '.') && !/description|parent/.test(n)), k + ' has no pictures in the game');

// refused, whole: anything not of the shape
const base = () => ({ v: 1, name: 'Test', sky: 1, rows: ['......', '......', '......', '......'], items: [{ x: 0, y: 0, t: 'unit', cls: 'vehicle', kind: 'buggy' }, { x: 5, y: 3, t: 'goal', want: 'buggy' }, { x: 4, y: 3, t: 'bonus', want: 'anything' }], inventory: {} });
ok(!validate(base()).length, 'a small level passes: ' + validate(base()).join('; '));
const refuse = (what, f) => { const l = base(); f(l); ok(validate(l).length > 0, 'refused: ' + what); };
refuse('a field of its own', (l) => { l.script = 'x'; });
refuse('an item field of its own', (l) => { l.items[0].onclick = 'alert(1)'; });
refuse('a kind not the game\'s', (l) => { l.items[0].kind = "buggy'); DROP TABLE levels;--"; });
refuse('a goal not the game\'s', (l) => { l.items[1].want = 'buggy\r[mapitems]\rz=unit,vehicle,buggy'; });
refuse('ground not the game\'s', (l) => { l.rows[0] = '..<s>.'; });
refuse('a row of another width', (l) => { l.rows[1] = '.......'; });
refuse('a map too big', (l) => { l.rows = Array.from({ length: 40 }, () => '.'.repeat(60)); });
refuse('two items on a tile', (l) => { l.items.push({ x: 0, y: 0, t: 'plan', what: 'duck', n: 1 }); });
refuse('an item off the map', (l) => { l.items[0].x = 99; });
refuse('a pile of too many', (l) => { l.items.push({ x: 1, y: 1, t: 'pile', bricks: { red: 1e9 } }); });
refuse('a pile of something else', (l) => { l.items.push({ x: 1, y: 1, t: 'pile', bricks: { gold: 5 } }); });
refuse('bricks not a whole number', (l) => { l.items.push({ x: 1, y: 1, t: 'pile', bricks: { red: '5' } }); });
refuse('no goal', (l) => { l.items.splice(1, 1); });
refuse('nine goals', (l) => { for (let i = 0; i < 8; i++) l.items.push({ x: i % 6, y: 1 + (i >> 2), t: 'goal', want: 'duck' }); });
refuse('a whirlpool alone', (l) => { l.rows[2] = 'w.....'; l.items.push({ x: 0, y: 2, t: 'whirl', id: 1 }); });
refuse('a unit on a tree', (l) => { l.rows[0] = 'T.....'; });
refuse('a plan in hand of something else', (l) => { l.inventory = { nuke: 1 }; });
refuse('not an object', (l) => { l.items = 'x'; });
refuse('a prototype trick', (l) => { l.items[0] = JSON.parse('{"x":0,"y":0,"t":"unit","cls":"vehicle","kind":"buggy","__proto__":{"t":"x"}}'); l.items[0].extra = 1; });
const named = base(); named.name = 'Hi=1\r[mapitems]\rq=unit';
ok(!/\r\[mapitems\]\rq/.test(toMapText(named).split('\r[mapitems]')[0] + 'x'), 'a name cannot write lines of its own: ' + JSON.stringify(toMapText(named).split('\r')[1]));

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
