// The puzzle generator (src/online/puzzle.js) over many codes: how many make a mission
// (one whose solution plays through the model of the rules), and why the others did not.
//
//   node tools/verify/puzzle.mjs [codes per difficulty and look, default 50]
//   node tools/verify/puzzle.mjs 0 2C-K2Q9          print one mission
//   node tools/verify/puzzle.mjs 50 --report        and count what the missions have

import { readFileSync } from 'node:fs';
import { generatePuzzle, readConfig } from '../../src/online/puzzle.js';

const args = process.argv.slice(2);
const N = Number(args[0]) || 50;
const SHOW = args.find((a, i) => i > 0 && !a.startsWith('--'));
const REPORT = args.includes('--report');
const data = JSON.parse(readFileSync(new URL('../../data/merged.json', import.meta.url), 'utf8'));
let text = '';
for (const c of data.casts) for (const m of Object.values(c.members)) if (m.name === 'config' && !text) text = m.text;
const config = readConfig(text);

if (SHOW) {
  const why = [];
  const p = generatePuzzle(config, SHOW, why);
  if (!p) { console.log('no mission:', why.slice(0, 10)); process.exit(1); }
  console.log(p.rows.join('\n'));
  console.log(p.text.split('\r').filter((l) => /=|\[/.test(l) && !l.startsWith(' map=')).join('\n'));
  for (const s of p.solution) console.log(JSON.stringify(s));
  console.log('-- bonus');
  for (const s of p.bonus) console.log(JSON.stringify(s));
  console.log('goal', p.goal, '/ bonus', p.bonusGoal);
  console.log(p.tags.join(' | '));
  console.log('attempts turned down:', why.length, why.slice(0, 8));
  process.exit(0);
}

const CH = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const reasons = {};
const counts = {};
let made = 0, tried = 0, ms = 0, worst = 0;
for (const d of [1, 2, 3]) {
  for (const look of 'ABCD') {
    let ok = 0;
    for (let s = 0; s < N; s++) {
      const code = `${d}${look}${CH[s % 32]}${CH[(s * 7 + 3) % 32]}${CH[(s * 13 + 5) % 32]}${CH[(s * 5 + 1) % 32]}`;
      const why = [];
      tried++;
      const t0 = performance.now();
      const p = generatePuzzle(config, code, why);
      const t = performance.now() - t0;
      ms += t; worst = Math.max(worst, t);
      if (p) {
        ok++; made++;
        if (!p.bonus.length) reasons['NO BONUS ' + code] = 1;
        for (const tag of p.tags) counts[tag] = (counts[tag] || 0) + 1;
      } else for (const w of why) reasons[w] = (reasons[w] || 0) + 1;
      for (const w of why) reasons['(turned down) ' + w.replace(/[\d,]+/g, '#')] = (reasons['(turned down) ' + w.replace(/[\d,]+/g, '#')] || 0) + 1;
    }
    console.log(`difficulty ${d}, look ${look}: ${ok} of ${N}`);
  }
}
console.log(`${made} of ${tried} codes made a mission, ${(ms / tried).toFixed(1)} ms each on average, ${worst.toFixed(0)} ms at most`);
console.log('attempts turned down:', Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 25));
if (REPORT) {
  const groups = {};
  for (const [tag, n] of Object.entries(counts)) {
    const g = /^(\w+)/.exec(tag)[1];
    (groups[g] = groups[g] || []).push([tag, n]);
  }
  for (const [g, list] of Object.entries(groups).sort()) {
    console.log('\n' + g + ':');
    for (const [tag, n] of list.sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${tag}`);
  }
}
