// A custom level as a file, to keep or pass on (the level editor's Export and Import, the custom
// levels' Export): {format, version, level, author, from}, as JSON; the level as
// src/online/levelformat.js has it.  Read back from such a file, from a level on its own, or from
// a map's text as the game's own maps are written ([map] ... [mapitems] ...).
//
// What is read is only ever taken as a level's plain fields, each of the shape it must be: the
// rest is left out, and a level that is not one (rows not the game's ground, items not on the
// map) is turned down.  One not yet playable (no goal, say) is taken, for the editor to finish.

import { TERRAIN, LIMITS, parseMap, cleanText, validate } from './levelformat.js';

export const FORMAT = 'lego-world-builder-online-level';
const MAX_TEXT = 512 * 1024;
const ITEM_TYPES = ['pile', 'plan', 'unit', 'goal', 'bonus', 'whirl'];

// The file's text for a level.
export function toFile(level, info = {}) {
  const out = { format: FORMAT, version: 1, level };
  if (info.author) out.author = String(info.author).slice(0, 30);
  if (info.from) out.from = String(info.from).slice(0, 40);
  return JSON.stringify(out, null, 1);
}

// A name for the file: the level's, plainly.
export function fileName(level) {
  return (cleanText(level.name) || 'level').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.wblevel.json';
}

// The level in a file's text: {level, problems (what keeps it from being played yet), author,
// from}; an Error, said for the player, if it is not one.
export function fromText(text) {
  text = String(text || '');
  if (!text.trim()) throw new Error('That is empty.');
  if (text.length > MAX_TEXT) throw new Error('That is far too big to be a level.');
  let raw, author = '', from = '';
  if (/^\s*[[{]/.test(text) && !/^\s*\[map\]/i.test(text)) {
    let doc;
    try { doc = JSON.parse(text); } catch (e) { throw new Error('That is not a level file.'); }
    if (doc && typeof doc === 'object' && doc.format === FORMAT) {
      raw = doc.level;
      author = typeof doc.author === 'string' ? doc.author.slice(0, 30) : '';
      from = typeof doc.from === 'string' ? doc.from.slice(0, 40) : '';
    } else raw = doc;
  } else if (/\[map\]/i.test(text)) {
    raw = parseMap(text);
    if (!raw.sky) raw.sky = 1;
  } else throw new Error('That is not a level file.');
  const level = clean(raw);
  return { level, problems: validate(level), author, from };
}

// The level's fields, each as it must be, and nothing else.
function clean(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('That is not a level.');
  const rows = raw.rows;
  if (!Array.isArray(rows) || rows.length < LIMITS.minH || rows.length > LIMITS.maxH) throw new Error('Its map is not ' + LIMITS.minH + ' to ' + LIMITS.maxH + ' tiles high.');
  const W = typeof rows[0] === 'string' ? rows[0].length : 0;
  if (W < LIMITS.minW || W > LIMITS.maxW) throw new Error('Its map is not ' + LIMITS.minW + ' to ' + LIMITS.maxW + ' tiles wide.');
  for (const r of rows) {
    if (typeof r !== 'string' || r.length !== W) throw new Error('Its map’s rows are not all as wide.');
    for (const ch of r) if (TERRAIN[ch] === undefined) throw new Error('Its map has ground the game has not.');
  }
  const items = [];
  const taken = new Set();
  for (const it of Array.isArray(raw.items) ? raw.items : []) {
    if (!it || typeof it !== 'object' || !ITEM_TYPES.includes(it.t)) continue;
    if (!Number.isInteger(it.x) || !Number.isInteger(it.y) || it.x < 0 || it.y < 0 || it.x >= W || it.y >= rows.length) continue;
    const k = it.x + ',' + it.y;
    if (taken.has(k)) continue;
    taken.add(k);
    // (the fields of its kind, copied: validate says if they are right)
    const keep = { pile: ['bricks'], plan: ['what', 'n'], unit: ['cls', 'kind'], goal: ['want'], bonus: ['want'], whirl: ['id'] }[it.t];
    const out = { x: it.x, y: it.y, t: it.t };
    for (const f of keep) if (it[f] !== undefined) out[f] = plain(it[f]);
    items.push(out);
  }
  const inventory = {};
  if (raw.inventory && typeof raw.inventory === 'object' && !Array.isArray(raw.inventory)) {
    for (const [k, n] of Object.entries(raw.inventory)) if (/^[a-z_0-9]{1,30}$/.test(k) && Number.isInteger(n) && n > 0) inventory[k] = Math.min(n, LIMITS.inHand);
  }
  const sky = Number.isInteger(raw.sky) && raw.sky >= 1 && raw.sky <= 7 ? raw.sky : 1;
  const center = Array.isArray(raw.center) && raw.center.length === 2 && raw.center.every(Number.isInteger) && raw.center[0] >= 0 && raw.center[1] >= 0 && raw.center[0] < W && raw.center[1] < rows.length ? raw.center.slice() : undefined;
  return { v: 1, name: cleanText(typeof raw.name === 'string' ? raw.name : '') || 'IMPORTED LEVEL', sky, rows: rows.slice(), items, inventory, center };
}

// (a field's value as plain data: strings, numbers, and objects of them, no deeper than a goal's)
function plain(v, depth = 0) {
  if (typeof v === 'string') return v.slice(0, 40);
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v && typeof v === 'object' && !Array.isArray(v) && depth < 1) {
    const o = {};
    for (const [k, x] of Object.entries(v).slice(0, 12)) if (/^[a-z_0-9]{1,30}$/i.test(k)) o[k] = plain(x, depth + 1);
    return o;
  }
  return null;
}

// The file given to the player: downloaded in a browser (the desktop app asks where); on a phone
// that cannot, shared (to Files, a chat, ...); else its text copied.  Answers what was done.
export async function saveFile(text, name) {
  const android = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (android && navigator.canShare) {
    try {
      const file = new File([text], name, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return 'shared'; }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  if (!android) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return 'downloaded';
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}

// A file chosen by the player, its text: null if none was.
export function chooseFile() {
  return new Promise((done) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.txt,.wblevel,application/json,text/plain';
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      if (!f) { done(null); return; }
      if (f.size > MAX_TEXT) { done(''); return; }
      try { done(await f.text()); } catch (e) { done(null); }
    });
    input.click();
  });
}
