// The mission generator (src/online/random.js) over every template: how many seeds make a
// mission, and that each one made keeps its template's items, has a goal, and has its
// items joined up (by land, and by water for what floats).
//
//   node tools/verify/random.mjs [seeds per template, default 40] [code to print]

import { readFileSync } from 'node:fs';
import { generateMission, parseMission, terrainChars, parseCode } from '../../src/online/random.js';

const SEEDS = Number(process.argv[2]) || 40;
const SHOW = process.argv[3];
const data = JSON.parse(readFileSync(new URL('../../data/merged.json', import.meta.url), 'utf8'));
const texts = {};
for (const c of data.casts) for (const m of Object.values(c.members)) if (m.type === 'text' && m.name && !(m.name in texts)) texts[m.name] = m.text;
const terrainmap = texts.terrainmap;
const terrain = terrainChars(terrainmap);
const CH = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

if (SHOW) {
  const c = parseCode(SHOW);
  const g = generateMission(texts[`map${c.world}.${c.mission}`], terrainmap, texts.config, SHOW);
  console.log(g ? g.rows.join('\n') : 'no mission');
  console.log('--- template ' + c.world + '.' + c.mission);
  console.log(parseMission(texts[`map${c.world}.${c.mission}`]).rows.join('\n'));
  process.exit(0);
}

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
function reach(rows, start, open) {
  const seen = new Set([start.join()]);
  const stack = [start];
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (ny < 0 || ny >= rows.length || nx < 0 || nx >= rows[ny].length || seen.has(k) || !open(rows[ny][nx])) continue;
      seen.add(k);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

let made = 0, tried = 0, bad = 0;
const failedTemplates = [];
for (let w = 1; w <= 7; w++) {
  for (let l = 1; l <= 12; l++) {
    if ((w === 1 && l === 1) || (w === 3 && l === 2)) continue;
    const text = texts[`map${w}.${l}`];
    const t = parseMission(text);
    let ok = 0;
    for (let s = 0; s < SEEDS; s++) {
      const code = `${w}${'ABCDEFGHIJKL'[l - 1]}${CH[s % 32]}${CH[(s * 7) % 32]}${CH[(s * 13 + 5) % 32]}${CH[(s * 3 + 1) % 32]}`;
      tried++;
      const g = generateMission(text, terrainmap, texts.config, code);
      if (!g) continue;
      ok++;
      made++;
      // the same items, as many of each
      const count = (rows) => {
        const n = {};
        for (const r of rows) for (const ch of r) if (!terrain.has(ch)) n[ch] = (n[ch] || 0) + 1;
        return JSON.stringify(Object.entries(n).sort());
      };
      const problems = [];
      if (count(g.rows) !== count(t.rows)) problems.push('items differ');
      if (!g.rows.some((r) => /[1-9]/.test(r))) problems.push('no goal');
      if (new Set(g.rows.map((r) => r.length)).size !== 1) problems.push('ragged rows');
      // joined: land items by land, floating ones by water
      const water = (ch) => /^water/.test((t.items[ch] || [])[0] || '') || (t.items[ch] || [])[0] === 'whirlpool' ||
        (/goal/.test((t.items[ch] || [])[0] || '') && /water/.test((t.items[ch] || [])[2] || ''));
      const monster = (ch) => (t.items[ch] || [])[1] === 'monster';
      const land = [], wet = [];
      g.rows.forEach((r, y) => [...r].forEach((ch, x) => {
        const item = !terrain.has(ch) || ch === ':' || ch === '~';
        if (!item || monster(ch)) return;
        (water(ch) ? wet : land).push([x, y]);
      }));
      const landOpen = (ch) => g.ground.includes(ch) || ch === ':' || ch === '~' || (!terrain.has(ch) && !water(ch));
      const waterOpen = (ch) => ch === 'w' || ch === 'x' || (!terrain.has(ch) && water(ch));
      for (const [group, open, what] of [[land, landOpen, 'land'], [wet, waterOpen, 'water']]) {
        if (group.length < 2) continue;
        const seen = reach(g.rows, group[0], open);
        if (!group.every(([x, y]) => seen.has(x + ',' + y))) problems.push(what + ' not joined');
      }
      if (problems.length) {
        bad++;
        console.log(`FAIL ${code}: ${problems.join(', ')}`);
      }
    }
    if (ok < SEEDS * 0.8) failedTemplates.push(`${w}.${l} (${ok}/${SEEDS})`);
  }
}
console.log(`${made} of ${tried} codes made a mission; ${bad} with problems`);
if (failedTemplates.length) console.log('templates that often fail: ' + failedTemplates.join(', '));
process.exit(bad ? 1 : 0);
