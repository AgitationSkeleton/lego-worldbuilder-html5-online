// The puzzle generator (src/online/puzzle.js) over many codes: how many make a mission
// (one whose solution plays through the model of the rules), and why the others did not.
//
//   node tools/verify/puzzle.mjs [codes per difficulty and look, default 50] [code to print]

import { readFileSync } from 'node:fs';
import { generatePuzzle, parseCode } from '../../src/online/puzzle.js';

const N = Number(process.argv[2]) || 50;
const SHOW = process.argv[3];
const data = JSON.parse(readFileSync(new URL('../../data/merged.json', import.meta.url), 'utf8'));
let config = '';
for (const c of data.casts) for (const m of Object.values(c.members)) if (m.name === 'config' && !config) config = m.text;

if (SHOW) {
  const why = [];
  const p = generatePuzzle(config, SHOW, why);
  if (!p) { console.log('no mission:', why.slice(0, 5)); process.exit(1); }
  console.log(p.rows.join('\n'));
  console.log(p.text.split('\r').filter((l) => /=|\[/.test(l) && !l.startsWith(' map=')).join('\n'));
  for (const s of p.solution) console.log(JSON.stringify(s));
  console.log('bonus', JSON.stringify(p.bonus));
  process.exit(0);
}

const CH = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const reasons = {};
let made = 0, tried = 0;
for (const d of [1, 2, 3]) {
  for (const look of 'ABCD') {
    let ok = 0;
    for (let s = 0; s < N; s++) {
      const code = `${d}${look}${CH[s % 32]}${CH[(s * 7 + 3) % 32]}${CH[(s * 13 + 5) % 32]}${CH[(s * 5 + 1) % 32]}`;
      const why = [];
      tried++;
      if (generatePuzzle(config, code, why)) { ok++; made++; }
      else for (const w of why) reasons[w] = (reasons[w] || 0) + 1;
    }
    console.log(`difficulty ${d}, look ${look}: ${ok} of ${N}`);
  }
}
console.log(`${made} of ${tried} codes made a mission`);
console.log('attempts turned down:', Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 12));
