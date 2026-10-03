// The game's tuning, from its "config" text member: each unit's, building's and
// monster's numbers, as the game reads them (parseParams, then each #name=[...] line's
// value as a Lingo list).

// A Lingo list literal: [#a: 1, #b: [#c, #d], #e: "x"] -> {a: 1, b: ['c', 'd'], e: 'x'}.
function parseList(src) {
  let i = 0;
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const value = () => {
    ws();
    const c = src[i];
    if (c === '[') return list();
    if (c === '"') { const j = src.indexOf('"', i + 1); const v = src.slice(i + 1, j); i = j + 1; return v; }
    if (c === '#') { i++; const m = /^\w+/.exec(src.slice(i)); i += m[0].length; return m[0].toLowerCase(); }
    const m = /^-?[\d.]+/.exec(src.slice(i));
    if (m) { i += m[0].length; return Number(m[0]); }
    const w = /^\w+/.exec(src.slice(i));
    i += w ? w[0].length : 1;
    return w ? w[0] : null;
  };
  const list = () => {
    i++;   // [
    ws();
    if (src[i] === ':') { i++; ws(); i++; return {}; }   // [:]
    const arr = [], obj = {};
    let isProp = false;
    while (i < src.length) {
      ws();
      if (src[i] === ']') { i++; break; }
      const v = value();
      ws();
      if (src[i] === ':') { i++; isProp = true; obj[v] = value(); } else arr.push(v);
      ws();
      if (src[i] === ',') i++;
    }
    return isProp ? obj : arr;
  };
  return value();
}

// {kind: {cls, kind, name, terrain, recipe, carries, speed, energy, dig, transplant, push,
// attack, shield, recharges, freezeRange, freezable, makeHowManyBricks}}
export function readConfig(text) {
  const out = {};
  let section = '';
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const sec = /^\[(\w+)\]$/.exec(line);
    if (sec) { section = sec[1].toLowerCase(); continue; }
    const m = /^#(\w+)\s*=\s*(\[.*\])\s*$/.exec(line);
    if (!m || !['building', 'vehicle', 'monster'].includes(section)) continue;
    let v;
    try { v = parseList(m[2]); } catch (e) { continue; }
    if (!v || Array.isArray(v)) continue;
    const name = m[1].toLowerCase();
    out[name] = {
      cls: section,
      kind: v.kind || section,
      name: v.name || name,
      plural: v.plural,
      terrain: (v.terrain || []).map(String),
      recipe: v.recipe && !Array.isArray(v.recipe) ? v.recipe : {},
      carries: v.carries || 0,
      speed: v.speed || 0,
      energy: v.energy && !Array.isArray(v.energy) ? v.energy : {},
      dig: v.dig === 'yes',
      transplant: v.transplant === 'yes',
      push: v.push === 'yes',
      attack: v.attack && !Array.isArray(v.attack) ? v.attack : null,
      attackRange: v.attack_search_range || 0,
      shield: v.shield,
      recharges: v.recharges || [],
      freezeRange: v.freeze_range,
      freezable: section === 'monster' && name !== 'boulder',
      makeHowManyBricks: v.makehowmanybricks,
    };
  }
  return out;
}
