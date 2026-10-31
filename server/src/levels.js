// Custom levels: made in the game's level editor (src/online/editor.js), uploaded, looked at by the
// moderator in Discord before anyone else sees them, then played, liked and raced by all.
//
//   POST /levels                  multipart: level (JSON, src/online/levelformat.js), name (the
//                                 author's), browser (its id), proof (JSON {goal, bonus}: the times
//                                 the author beat it in), image (a PNG or JPEG of it).
//                                 Answers {ok, id, status}: 'pending', or 'approved' when
//                                 levels are approved by themselves.
//   GET  /levels?sort=new|likes|plays&q=&offset=   the approved ones: [{id, name, author, likes,
//                                 plays, created, w, h, sky}], 30 at a time
//   GET  /levels/ID               one approved level: {id, name, author, level, likes, plays, created}
//   GET  /levels/ID/image         its picture
//   POST /levels/ID/like          JSON {browser, like: true|false}: {likes, liked}
//   GET  /levels/liked?browser=   the ids this browser likes
//   POST /levels/ID/play          counted as played (once an hour an address)
//   GET  /levels/mine?browser=    this browser's uploads, whatever their status
//
// The moderator's, through Alien Commander's buttons (its bot.py forwards a press here with the
// LEVELS_KEY secret; only LEVELS_ADMIN's presses count):
//   POST /levels/admin            JSON {user_id, custom_id}: wbmap:approve|reject|unpublish|ban:ID,
//                                 wbmap:cfg:auto|uploads|day-|day+|author-|author+, wbmap:unban:WHO,
//                                 wbmap:panel.  Answers {update: {embeds, components}} (the message
//                                 pressed, as it now is) or {reply}.
//   POST /levels/panel            the settings panel posted in the channel (LEVELS_KEY)
//
// What is uploaded is a level of the game's own kinds and nothing else (validate, the same checks
// the editor makes); the game is only ever given text the game's own code makes from a level that
// passed (src/online/levelformat.js, toMapText).  The database is only ever given its values as
// bound parameters.  Names are cleaned and their profanity starred out.  A picture must be a PNG
// or JPEG of at most 1 MB.  The level must have been beaten by its author, goal and bonus (the
// times say so: the game sends them only from its Test Play), and uploads are limited by address,
// browser and day.  Then the moderator sees it, unless it is set to approve them by itself.

import { json, sha256Hex, clientIp, cleanName, decentName } from './http.js';
import { censor } from '../../src/online/profanity.js';
import { validate, cleanText, KINDS } from '../../src/online/levelformat.js';

const MAX_LEVEL = 64 * 1024;
const MAX_IMAGE = 1024 * 1024;
const MIN_MS = 3000;
const MAX_MS = 7 * 24 * 3600 * 1000;
const PAGE = 30;
const SKIES = ['World One', 'World Two', 'World Three', 'Ocean World', 'Prehistoric World', 'WB2 World One', 'WB2 World Two'];
const DEFAULTS = { auto: '0', uploads: '1', day: '40', author: '3' };
const BROWSER = /^[A-Za-z0-9_-]{12,64}$/;

// The tables, made the first time they are wanted (the database is only reached through the
// Worker's binding).
let made = false;
async function tables(env) {
  if (made) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS levels (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, author TEXT NOT NULL,
      browser TEXT NOT NULL, ip_hash TEXT NOT NULL, level TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, image BLOB, image_type TEXT,
      status TEXT NOT NULL, created INTEGER NOT NULL, decided INTEGER, likes INTEGER NOT NULL DEFAULT 0, plays INTEGER NOT NULL DEFAULT 0,
      goal_ms INTEGER, bonus_ms INTEGER, w INTEGER, h INTEGER, sky INTEGER, message_id TEXT)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS levels_by_status ON levels (status, created)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS level_likes (level_id INTEGER NOT NULL, browser TEXT NOT NULL, ip_hash TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (level_id, browser))'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS level_plays (level_id INTEGER NOT NULL, ip_hash TEXT NOT NULL, created INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS level_bans (who TEXT PRIMARY KEY, name TEXT, created INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS level_config (k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
  ]);
  made = true;
}

async function config(env) {
  const { results } = await env.DB.prepare('SELECT k, v FROM level_config').all();
  const c = Object.assign({}, DEFAULTS);
  for (const r of results || []) c[r.k] = r.v;
  return c;
}
async function setConfig(env, k, v) {
  await env.DB.prepare('INSERT INTO level_config (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?2').bind(k, String(v)).run();
}

async function ipHashOf(env, request) {
  return (await sha256Hex((env.IP_SALT || 'worldbuilder') + '|' + clientIp(request))).slice(0, 32);
}

function imageType(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ['image/jpeg', 'jpg'];
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return ['image/png', 'png'];
  return null;
}

// What the moderator is shown of a level (no more than the game's own words: its kinds).
function summary(level) {
  const count = (t) => level.items.filter((it) => it.t === t).length;
  const want = (it) => (typeof it.want === 'object' ? it.want.collect + ' ' + it.want.kind : it.want).replace(/_/g, ' ');
  const goal = level.items.find((it) => it.t === 'goal'), bonus = level.items.find((it) => it.t === 'bonus');
  const units = {};
  for (const it of level.items) if (it.t === 'unit') units[it.kind] = (units[it.kind] || 0) + 1;
  const list = (o) => Object.entries(o).map(([k, n]) => k.replace(/_/g, ' ') + (n > 1 ? ' ×' + n : '')).join(', ') || 'none';
  return [
    { name: 'Size', value: level.rows[0].length + ' × ' + level.rows.length, inline: true },
    { name: 'Sky', value: SKIES[level.sky - 1], inline: true },
    { name: 'Goal', value: goal ? want(goal) : '?', inline: true },
    { name: 'Bonus goal', value: bonus ? want(bonus) : 'none', inline: true },
    { name: 'Units, buildings and monsters', value: list(units).slice(0, 1000) },
    { name: 'Plans in hand', value: list(level.inventory).slice(0, 1000), inline: true },
    { name: 'On the map', value: count('pile') + ' piles of bricks, ' + count('plan') + ' plans, ' + count('whirl') + ' whirlpools', inline: true },
  ];
}

const COLORS = { pending: 0xf0b400, approved: 0x33bb22, rejected: 0xcc3333, unpublished: 0x888888 };
// The message about a level, as it stands: its card, and the buttons its status calls for.
function card(row, level, extra) {
  const fields = summary(level);
  fields.push({ name: 'Author', value: row.author.replace(/[\\*_~`|>]/g, '\\$&'), inline: true });
  fields.push({ name: 'Beaten by its author in', value: clockOf(row.goal_ms) + ' (bonus ' + clockOf(row.bonus_ms) + ')', inline: true });
  const embed = {
    title: row.name, color: COLORS[row.status] || 0x888888,
    description: 'Custom level **C-' + row.id + '**: ' + row.status + (extra ? ' · ' + extra : ''),
    fields, image: { url: 'attachment://level.' + (row.image_type === 'image/jpeg' ? 'jpg' : 'png') },
    footer: { text: 'World Builder Online · custom levels' }, timestamp: new Date(row.created).toISOString(),
  };
  const b = (label, style, id) => ({ type: 2, style, label, custom_id: 'wbmap:' + id + ':' + row.id });
  const buttons = row.status === 'pending' ? [b('Approve', 3, 'approve'), b('Reject', 4, 'reject'), b('Ban author', 2, 'ban')]
    : row.status === 'approved' ? [b('Unpublish', 4, 'unpublish'), b('Ban author', 2, 'ban')]
      : [b('Approve', 3, 'approve'), b('Ban author', 2, 'ban')];
  return { embeds: [embed], components: [{ type: 1, components: buttons }] };
}
function clockOf(ms) {
  if (!Number.isFinite(ms)) return '?';
  const t = Math.floor(ms / 1000);
  const s = t % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
  const two = (n) => String(n).padStart(2, '0');
  return h ? h + ':' + two(m) + ':' + two(s) : m + ':' + two(s);
}

// The settings panel: what it is set to, and its buttons.
async function panel(env) {
  const c = await config(env);
  const { results } = await env.DB.prepare('SELECT who, name FROM level_bans ORDER BY created DESC LIMIT 25').all();
  const bans = results || [];
  const on = (v) => (v === '1' ? 'on' : 'off');
  const embed = {
    title: 'Custom levels: settings', color: 0x3399ff,
    fields: [
      { name: 'Approved by themselves', value: on(c.auto), inline: true },
      { name: 'Uploads', value: on(c.uploads), inline: true },
      { name: 'Uploads a day, in all', value: c.day === '0' ? 'no limit' : c.day, inline: true },
      { name: 'A day, one author', value: c.author === '0' ? 'no limit' : c.author, inline: true },
      { name: 'Banned', value: bans.length ? bans.map((x) => (x.name || '?') + ' (' + x.who.split(':')[0] + ')').join(', ').slice(0, 1000) : 'nobody' },
    ],
    footer: { text: 'Only the moderator\'s presses count. A limit of 0 is none.' },
  };
  const b = (label, style, id) => ({ type: 2, style, label, custom_id: 'wbmap:cfg:' + id });
  const rows = [
    { type: 1, components: [b(c.auto === '1' ? 'Stop approving by themselves' : 'Approve by themselves', c.auto === '1' ? 4 : 3, 'auto'),
      b(c.uploads === '1' ? 'Close uploads' : 'Open uploads', c.uploads === '1' ? 4 : 3, 'uploads')] },
    { type: 1, components: [b('A day −', 2, 'day-'), b('A day +', 2, 'day+'), b('One author −', 2, 'author-'), b('One author +', 2, 'author+')] },
  ];
  if (bans.length) {
    rows.push({ type: 1, components: [{ type: 3, custom_id: 'wbmap:unban', placeholder: 'Unban…', options: bans.slice(0, 25).map((x) => ({ label: ((x.name || '?') + ' · ' + x.who.split(':')[0]).slice(0, 100), value: x.who.slice(0, 100) })) }] });
  }
  return { embeds: [embed], components: rows };
}

// ---------- Discord, as Alien Commander ----------

async function discordApi(env, method, path, body, file) {
  if (!env.DISCORD_BOT_TOKEN || !env.LEVELS_CHANNEL) return null;
  const headers = { Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN, 'User-Agent': 'DiscordBot (https://wbonline.viosarcade.xyz, 1)' };
  let payload;
  if (file) {
    payload = new FormData();
    payload.append('payload_json', JSON.stringify(Object.assign({}, body, { attachments: [{ id: 0, filename: file.name }] })));
    payload.append('files[0]', new Blob([file.bytes], { type: file.type }), file.name);
  } else {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const r = await fetch('https://discord.com/api/v10' + path, { method, headers, body: payload });
  if (!r.ok) { console.log('discord ' + method + ' ' + path + ': ' + r.status + ' ' + (await r.text()).slice(0, 300)); return null; }
  return r.status === 204 ? {} : r.json();
}

async function announce(env, row, level) {
  const msg = Object.assign({ allowed_mentions: { parse: [] } }, card(row, level));
  const bytes = row.image ? new Uint8Array(row.image) : null;
  const sent = await discordApi(env, 'POST', '/channels/' + env.LEVELS_CHANNEL + '/messages', msg,
    bytes ? { bytes, type: row.image_type, name: 'level.' + (row.image_type === 'image/jpeg' ? 'jpg' : 'png') } : null);
  if (sent && sent.id) await env.DB.prepare('UPDATE levels SET message_id = ?1 WHERE id = ?2').bind(sent.id, row.id).run();
}

// ---------- uploading ----------

async function upload(request, env, ctx) {
  const c = await config(env);
  if (c.uploads !== '1') return json(env, request, { error: 'closed' }, 403);
  let form;
  try { form = await request.formData(); } catch (e) { return json(env, request, { error: 'form' }, 400); }
  const raw = String(form.get('level') || '');
  if (!raw || raw.length > MAX_LEVEL) return json(env, request, { error: 'level' }, 400);
  let level;
  try { level = JSON.parse(raw); } catch (e) { return json(env, request, { error: 'level' }, 400); }
  const errs = validate(level);
  if (errs.length) return json(env, request, { error: 'level', why: errs.slice(0, 3) }, 400);
  const browser = String(form.get('browser') || '');
  if (!BROWSER.test(browser)) return json(env, request, { error: 'browser' }, 400);
  const given = cleanName(form.get('name'));
  if (!given || !decentName(given)) return json(env, request, { error: 'name' }, 400);
  const author = censor(given);
  let proof;
  try { proof = JSON.parse(String(form.get('proof') || '{}')); } catch (e) { proof = {}; }
  const goalMs = Number(proof && proof.goal), bonusMs = Number(proof && proof.bonus);
  if (!Number.isInteger(goalMs) || !Number.isInteger(bonusMs) || goalMs < MIN_MS || bonusMs < MIN_MS || goalMs > MAX_MS || bonusMs > MAX_MS) return json(env, request, { error: 'beat it first' }, 400);
  const image = form.get('image');
  if (!image || typeof image === 'string' || image.size > MAX_IMAGE || image.size < 200) return json(env, request, { error: 'image' }, 400);
  const bytes = new Uint8Array(await image.arrayBuffer());
  const type = imageType(bytes);
  if (!type) return json(env, request, { error: 'image' }, 400);
  const ip = await ipHashOf(env, request);
  // (banned: by address, browser or name)
  const ban = await env.DB.prepare('SELECT who FROM level_bans WHERE who IN (?1, ?2, ?3)').bind('ip:' + ip, 'browser:' + browser, 'name:' + author.toLowerCase()).first();
  if (ban) return json(env, request, { error: 'banned' }, 403);
  const now = Date.now(), day = now - 86400000;
  const dayLimit = Number(c.day), authorLimit = Number(c.author);
  if (dayLimit > 0) {
    const all = await env.DB.prepare('SELECT COUNT(*) AS n FROM levels WHERE created > ?1').bind(day).first();
    if (all && all.n >= dayLimit) return json(env, request, { error: 'later' }, 429);
  }
  if (authorLimit > 0) {
    const mine = await env.DB.prepare('SELECT COUNT(*) AS n FROM levels WHERE created > ?1 AND (ip_hash = ?2 OR browser = ?3)').bind(day, ip, browser).first();
    if (mine && mine.n >= authorLimit) return json(env, request, { error: 'later' }, 429);
  }
  // (the level as kept: exactly the fields the format has, its name cleaned, nothing else)
  const kept = JSON.stringify({ v: 1, name: cleanText(censor(level.name)), sky: level.sky, rows: level.rows,
    items: level.items, inventory: level.inventory, center: level.center || undefined });
  const hash = await sha256Hex(JSON.stringify({ rows: level.rows, items: level.items, inventory: level.inventory, sky: level.sky }));
  const status = c.auto === '1' ? 'approved' : 'pending';
  let id;
  try {
    const r = await env.DB.prepare(`INSERT INTO levels (name, author, browser, ip_hash, level, hash, image, image_type, status, created, decided, goal_ms, bonus_ms, w, h, sky)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`)
      .bind(cleanText(censor(level.name)), author, browser, ip, kept, hash, bytes, type[0], status, now, status === 'approved' ? now : null,
        goalMs, bonusMs, level.rows[0].length, level.rows.length, level.sky).run();
    id = r.meta && r.meta.last_row_id;
  } catch (e) {
    if (/UNIQUE/.test(String(e && e.message))) return json(env, request, { error: 'already' }, 409);
    throw e;
  }
  const row = await env.DB.prepare('SELECT * FROM levels WHERE id = ?1').bind(id).first();
  const send = announce(env, row, JSON.parse(kept)).catch((e) => console.log('announce: ' + e));
  if (ctx && ctx.waitUntil) ctx.waitUntil(send);
  return json(env, request, { ok: true, id, status });
}

// ---------- the moderator's buttons ----------

async function admin(request, env) {
  if (!env.LEVELS_KEY || request.headers.get('X-Levels-Key') !== env.LEVELS_KEY) return json(env, request, { error: 'unauthorised' }, 401);
  let body;
  try { body = await request.json(); } catch (e) { return json(env, request, { error: 'json' }, 400); }
  if (String(body.user_id) !== String(env.LEVELS_ADMIN)) return json(env, request, { reply: 'Only the moderator can use these buttons.' });
  const id = String(body.custom_id || '');
  const values = Array.isArray(body.values) ? body.values.map(String) : [];
  let m;
  if ((m = /^wbmap:(approve|reject|unpublish|ban):(\d{1,9})$/.exec(id))) {
    const row = await env.DB.prepare('SELECT * FROM levels WHERE id = ?1').bind(Number(m[2])).first();
    if (!row) return json(env, request, { reply: 'No such level.' });
    let note = '';
    if (m[1] === 'ban') {
      const now = Date.now();
      await env.DB.batch(['ip:' + row.ip_hash, 'browser:' + row.browser, 'name:' + row.author.toLowerCase()].map((who) =>
        env.DB.prepare('INSERT OR REPLACE INTO level_bans (who, name, created) VALUES (?1, ?2, ?3)').bind(who, row.author, now)));
      // (and what the banned author has up, taken down)
      await env.DB.prepare("UPDATE levels SET status = 'rejected', decided = ?1 WHERE (browser = ?2 OR ip_hash = ?3) AND status IN ('pending', 'approved')").bind(now, row.browser, row.ip_hash).run();
      note = row.author + ' banned';
    } else {
      const status = { approve: 'approved', reject: 'rejected', unpublish: 'unpublished' }[m[1]];
      await env.DB.prepare('UPDATE levels SET status = ?1, decided = ?2 WHERE id = ?3').bind(status, Date.now(), row.id).run();
    }
    const now = await env.DB.prepare('SELECT * FROM levels WHERE id = ?1').bind(row.id).first();
    return json(env, request, { update: card(now, JSON.parse(now.level), note) });
  }
  if ((m = /^wbmap:cfg:(auto|uploads|day-|day\+|author-|author\+)$/.exec(id))) {
    const c = await config(env);
    const k = m[1];
    if (k === 'auto' || k === 'uploads') await setConfig(env, k, c[k] === '1' ? '0' : '1');
    else {
      const key = k.startsWith('day') ? 'day' : 'author';
      const steps = key === 'day' ? [0, 5, 10, 20, 40, 80, 160, 320] : [0, 1, 2, 3, 5, 10, 20];
      const cur = Number(c[key]);
      let i = steps.findIndex((s) => s >= cur);
      if (i < 0) i = steps.length - 1;
      i = Math.max(0, Math.min(steps.length - 1, i + (k.endsWith('+') ? 1 : -1)));
      await setConfig(env, key, steps[i]);
    }
    return json(env, request, { update: await panel(env) });
  }
  if (id === 'wbmap:unban' && values.length) {
    await env.DB.prepare('DELETE FROM level_bans WHERE who = ?1').bind(values[0]).run();
    return json(env, request, { update: await panel(env) });
  }
  if (id === 'wbmap:panel') return json(env, request, { update: await panel(env) });
  return json(env, request, { reply: 'Not a button of mine.' });
}

// ---------- playing them ----------

async function list(request, env, url) {
  const sort = url.searchParams.get('sort');
  const order = sort === 'likes' ? 'likes DESC, created DESC' : sort === 'plays' ? 'plays DESC, created DESC' : 'created DESC';
  const q = String(url.searchParams.get('q') || '').slice(0, 30).toUpperCase().replace(/[%_\\]/g, '');
  const offset = Math.max(0, Math.min(10000, Number(url.searchParams.get('offset')) || 0));
  const { results } = await env.DB.prepare(`SELECT id, name, author, likes, plays, created, w, h, sky FROM levels
    WHERE status = 'approved' AND (?1 = '' OR upper(name) LIKE '%' || ?1 || '%' OR upper(author) LIKE '%' || ?1 || '%')
    ORDER BY ${order} LIMIT ${PAGE + 1} OFFSET ?2`).bind(q, offset).all();
  const rows = (results || []).map((r) => Object.assign(r, { author: censor(r.author) }));
  return json(env, request, { levels: rows.slice(0, PAGE), more: rows.length > PAGE });
}

async function one(request, env, id) {
  const row = await env.DB.prepare("SELECT id, name, author, level, likes, plays, created FROM levels WHERE id = ?1 AND status = 'approved'").bind(id).first();
  if (!row) return json(env, request, { error: 'not found' }, 404);
  return json(env, request, { id: row.id, name: row.name, author: censor(row.author), level: JSON.parse(row.level), likes: row.likes, plays: row.plays, created: row.created });
}

async function picture(request, env, id) {
  const row = await env.DB.prepare("SELECT image, image_type FROM levels WHERE id = ?1 AND status = 'approved'").bind(id).first();
  if (!row || !row.image) return json(env, request, { error: 'not found' }, 404);
  // (anyone may show it; and read it, always, so that a copy cached from an <img> serves a fetch too)
  const headers = { 'Content-Type': row.image_type, 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' };
  return new Response(new Uint8Array(row.image), { headers });
}

async function like(request, env, id) {
  let body;
  try { body = await request.json(); } catch (e) { return json(env, request, { error: 'json' }, 400); }
  const browser = String(body && body.browser || '');
  if (!BROWSER.test(browser)) return json(env, request, { error: 'browser' }, 400);
  const row = await env.DB.prepare("SELECT id FROM levels WHERE id = ?1 AND status = 'approved'").bind(id).first();
  if (!row) return json(env, request, { error: 'not found' }, 404);
  const ip = await ipHashOf(env, request);
  if (body.like === false) {
    await env.DB.prepare('DELETE FROM level_likes WHERE level_id = ?1 AND browser = ?2').bind(id, browser).run();
  } else {
    // (a few likes a level from one address at most: a household, not a stuffed ballot)
    const from = await env.DB.prepare('SELECT COUNT(*) AS n FROM level_likes WHERE level_id = ?1 AND ip_hash = ?2').bind(id, ip).first();
    if (from && from.n >= 3) return json(env, request, { error: 'later' }, 429);
    await env.DB.prepare('INSERT OR IGNORE INTO level_likes (level_id, browser, ip_hash, created) VALUES (?1, ?2, ?3, ?4)').bind(id, browser, ip, Date.now()).run();
  }
  await env.DB.prepare('UPDATE levels SET likes = (SELECT COUNT(*) FROM level_likes WHERE level_id = ?1) WHERE id = ?1').bind(id).run();
  const now = await env.DB.prepare('SELECT likes FROM levels WHERE id = ?1').bind(id).first();
  const mine = await env.DB.prepare('SELECT 1 AS x FROM level_likes WHERE level_id = ?1 AND browser = ?2').bind(id, browser).first();
  return json(env, request, { likes: now.likes, liked: !!mine });
}

async function liked(request, env, url) {
  const browser = String(url.searchParams.get('browser') || '');
  if (!BROWSER.test(browser)) return json(env, request, { error: 'browser' }, 400);
  const { results } = await env.DB.prepare('SELECT level_id FROM level_likes WHERE browser = ?1 LIMIT 2000').bind(browser).all();
  return json(env, request, { liked: (results || []).map((r) => r.level_id) });
}

async function played(request, env, id) {
  const ip = await ipHashOf(env, request);
  const now = Date.now();
  const recent = await env.DB.prepare('SELECT 1 AS x FROM level_plays WHERE level_id = ?1 AND ip_hash = ?2 AND created > ?3').bind(id, ip, now - 3600000).first();
  if (!recent) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO level_plays (level_id, ip_hash, created) VALUES (?1, ?2, ?3)').bind(id, ip, now),
      env.DB.prepare("UPDATE levels SET plays = plays + 1 WHERE id = ?1 AND status = 'approved'").bind(id),
    ]);
  }
  return json(env, request, { ok: true });
}

async function mine(request, env, url) {
  const browser = String(url.searchParams.get('browser') || '');
  if (!BROWSER.test(browser)) return json(env, request, { error: 'browser' }, 400);
  const { results } = await env.DB.prepare('SELECT id, name, status, likes, plays, created FROM levels WHERE browser = ?1 ORDER BY created DESC LIMIT 100').bind(browser).all();
  return json(env, request, { levels: results || [] });
}

export async function handleLevels(request, env, url, ctx) {
  const path = url.pathname;
  if (!path.startsWith('/levels')) return null;
  await tables(env);
  const method = request.method;
  if (path === '/levels' && method === 'POST') return upload(request, env, ctx);
  if (path === '/levels' && method === 'GET') return list(request, env, url);
  if (path === '/levels/admin' && method === 'POST') return admin(request, env);
  if (path === '/levels/liked' && method === 'GET') return liked(request, env, url);
  if (path === '/levels/mine' && method === 'GET') return mine(request, env, url);
  if (path === '/levels/panel' && method === 'POST') {
    if (!env.LEVELS_KEY || request.headers.get('X-Levels-Key') !== env.LEVELS_KEY) return json(env, request, { error: 'unauthorised' }, 401);
    const sent = await discordApi(env, 'POST', '/channels/' + env.LEVELS_CHANNEL + '/messages', Object.assign({ allowed_mentions: { parse: [] } }, await panel(env)));
    return json(env, request, { ok: !!sent, id: sent && sent.id });
  }
  const m = /^\/levels\/(\d{1,9})(\/(image|like|play))?$/.exec(path);
  if (!m) return null;
  const id = Number(m[1]);
  if (!m[3] && method === 'GET') return one(request, env, id);
  if (m[3] === 'image' && method === 'GET') return picture(request, env, id);
  if (m[3] === 'like' && method === 'POST') return like(request, env, id);
  if (m[3] === 'play' && method === 'POST') return played(request, env, id);
  return null;
}

// (the kinds the level format knows: for the tests)
export const LEVEL_KINDS = KINDS;
