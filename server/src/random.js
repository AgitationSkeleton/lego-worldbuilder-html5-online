// The log of generated missions (src/online/puzzle.js): the first time a code is played, a
// picture of its map goes to the owner's Discord channel (discord.js), with who played it,
// its code and what it is.
//
//   POST /random   multipart: code ("2C-K2Q9"), name (may be empty), info (JSON: {goal,
//                  bonus, size: [columns, rows], units, monsters, links}), image (a JPEG or
//                  PNG of the map, src/online/snapshot.js). Answers {ok, posted}: posted
//                  false if the code had been posted already.
//
// What the page says the mission is cannot be worked out here (making a mission takes
// longer than a free Worker may run), so it is held to words of the game's kind: lower-case
// letters, digits, spaces, a few of them each, profanity starred out. The picture has to be
// a JPEG or a PNG of at most 3 MB, and one address may post 20 an hour.

import { json, sha256Hex, clientIp, cleanName, decentName } from './http.js';
import { censor } from '../../src/online/profanity.js';
import { discordFile, plain } from './discord.js';

// (Rando v1's codes have a seed of four characters, Rando v2's of five: src/online/puzzle.js)
const CODE = /^([1-3])([A-E])([0-9A-HJKMNP-TV-Z]{4,5})$/;
const WORD = /^[a-z0-9_ ]{1,32}$/;
const MAX_IMAGE = 3 * 1024 * 1024;
const PER_HOUR = 20;
const DIFFICULTY = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const LOOK = { A: 'Grassland', B: 'Prehistoric', C: 'Jungle', D: 'City', E: 'Ocean' };
const GAME = 'https://wbonline.viosarcade.xyz/';

function word(v) {
  const s = String(v == null ? '' : v).toLowerCase().trim();
  return WORD.test(s) ? censor(s).replace(/_/g, ' ') : '';
}

function words(v, max) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(word).filter(Boolean))].slice(0, max);
}

function imageType(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ['image/jpeg', 'jpg'];
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return ['image/png', 'png'];
  return null;
}

async function post(request, env, ctx) {
  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return json(env, request, { error: 'form' }, 400);
  }
  const m = CODE.exec(String(form.get('code') || '').toUpperCase().replace(/[^0-9A-Z]/g, ''));
  if (!m) return json(env, request, { error: 'code' }, 400);
  const code = m[0];
  const image = form.get('image');
  if (!image || typeof image === 'string' || image.size > MAX_IMAGE || image.size < 1000) return json(env, request, { error: 'image' }, 400);
  const bytes = new Uint8Array(await image.arrayBuffer());
  const type = imageType(bytes);
  if (!type) return json(env, request, { error: 'image' }, 400);
  let info = {};
  try {
    info = JSON.parse(String(form.get('info') || '{}')) || {};
  } catch (e) {
    info = {};
  }
  const given = cleanName(form.get('name'));
  const name = given && decentName(given) ? censor(given) : '';
  const ipHash = (await sha256Hex((env.IP_SALT || 'worldbuilder') + '|' + clientIp(request))).slice(0, 32);
  const now = Date.now();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM random_posts WHERE ip_hash = ?1 AND created > ?2').bind(ipHash, now - 3600000).first();
  if (recent && recent.n >= PER_HOUR) return json(env, request, { error: 'later' }, 429);
  // (the first to play a code posts it)
  const r = await env.DB.prepare('INSERT OR IGNORE INTO random_posts (code, name, created, ip_hash) VALUES (?1, ?2, ?3, ?4)')
    .bind(code, name, now, ipHash).run();
  if (!r.meta || !r.meta.changes) return json(env, request, { ok: true, posted: false });

  const shown = m[1] + m[2] + '-' + m[3];
  const size = Array.isArray(info.size) && info.size.every((n) => Number.isInteger(n) && n > 0 && n < 200) ? info.size.slice(0, 2) : null;
  const goal = word(info.goal), bonus = word(info.bonus);
  const units = words(info.units, 12), monsters = words(info.monsters, 8), links = words(info.links, 8);
  const lines = [
    `\u{1F3B2} **${name ? plain(name) : 'Someone'}** generated random mission **${shown}** (${DIFFICULTY[m[1]]}, ${LOOK[m[2]]}${m[3].length === 4 ? ', Rando v1' : ''}${size ? ', ' + size[0] + '×' + size[1] : ''})`,
  ];
  if (goal || bonus) lines.push([goal ? 'Goal: ' + goal : '', bonus ? 'Bonus: ' + bonus : ''].filter(Boolean).join(' · '));
  const parts = [];
  if (units.length) parts.push('Units: ' + units.join(', '));
  if (monsters.length) parts.push('Monsters: ' + monsters.join(', '));
  if (links.length) parts.push('In the way: ' + links.join(', '));
  if (parts.length) lines.push(parts.join(' · '));
  lines.push('<' + GAME + '?random=' + shown + '>');
  discordFile(env, ctx, lines.join('\n'), bytes, 'mission-' + shown + '.' + type[1], type[0]);
  return json(env, request, { ok: true, posted: true });
}

export async function handleRandom(request, env, url, ctx) {
  if (url.pathname === '/random' && request.method === 'POST') return post(request, env, ctx);
  return null;
}
