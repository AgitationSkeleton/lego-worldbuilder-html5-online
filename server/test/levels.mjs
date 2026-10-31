// Custom levels against a running server started with a test key:
//   npx wrangler dev --local --port 8788 --var LEVELS_KEY:test-levels-key
//   SERVER=http://127.0.0.1:8788 node test/levels.mjs
// Uploads levels made for the run (a random name each), turns away what is not a level, and
// presses the moderator's buttons as the bot forwards them.
import { readFileSync } from 'node:fs';

const SERVER = process.env.SERVER || 'http://127.0.0.1:8788';
const KEY = process.env.LEVELS_KEY || 'test-levels-key';
const ADMIN = '748343958190555217';
const ORIGIN = 'http://127.0.0.1:8766';
let failures = 0;
const ok = (cond, what) => {
  if (!cond) failures++;
  console.log((cond ? 'ok   ' : 'FAIL ') + what);
};
const tag = Math.random().toString(36).slice(2, 8);
const browser = 'test' + tag + 'abcdefgh';
const PNG = new Uint8Array(400); PNG.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function level(extra) {
  const rows = [];
  for (let y = 0; y < 10; y++) rows.push('.'.repeat(12));
  // (a different map each run, so it is not "already" up)
  const n = parseInt(tag, 36);
  for (let k = 0; k < 6; k++) { const v = Math.floor(n / 12 ** k) % 12; rows[k % 2 === 0 ? 0 : 1] = rows[k % 2 === 0 ? 0 : 1].slice(0, v) + 'w' + rows[k % 2 === 0 ? 0 : 1].slice(v + 1); }
  rows[9] = 'T'.repeat(1 + (n % 11)) + '.'.repeat(11 - (n % 11));
  return Object.assign({ v: 1, name: 'Test ' + tag, sky: 2, rows, inventory: { house: 2 },
    items: [
      { x: 2, y: 2, t: 'unit', cls: 'vehicle', kind: 'buggy' },
      { x: 5, y: 5, t: 'pile', bricks: { red: 20 } },
      { x: 9, y: 8, t: 'goal', want: 'house' },
      { x: 10, y: 8, t: 'bonus', want: 'house' },
    ] }, extra || {});
}

async function upload(fields, opts = {}) {
  const f = new FormData();
  const all = Object.assign({ level: JSON.stringify(level()), name: 'Maker' + tag, browser, proof: JSON.stringify({ goal: 60000, bonus: 90000 }) }, fields);
  for (const [k, v] of Object.entries(all)) if (v !== undefined) f.append(k, v);
  if (opts.image !== null) f.append('image', new Blob([opts.image || PNG], { type: 'image/png' }), 'level.png');
  const r = await fetch(SERVER + '/levels', { method: 'POST', headers: { Origin: ORIGIN, 'CF-Connecting-IP': opts.ip || '10.9.' + (parseInt(tag, 36) % 250) + '.1' }, body: f });
  return { status: r.status, body: await r.json() };
}
async function press(custom_id, user_id = ADMIN, key = KEY, values) {
  const r = await fetch(SERVER + '/levels/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Levels-Key': key }, body: JSON.stringify({ custom_id, user_id, values }) });
  return { status: r.status, body: await r.json() };
}
const get = async (path) => { const r = await fetch(SERVER + path, { headers: { Origin: ORIGIN } }); return { status: r.status, body: r.headers.get('Content-Type').includes('json') ? await r.json() : await r.arrayBuffer() }; };

// the settings, as the test wants them (and put back after)
let p = await press('wbmap:panel');
const fieldOf = (b, n) => b.update.embeds[0].fields.find((x) => x.name === n).value;
ok(p.status === 200 && p.body.update, 'the moderator opens the settings panel');
if (fieldOf(p.body, 'Approved by themselves') === 'on') await press('wbmap:cfg:auto');
if (fieldOf(p.body, 'Uploads') === 'off') await press('wbmap:cfg:uploads');
for (let i = 0; i < 8; i++) await press('wbmap:cfg:author+');
for (let i = 0; i < 8; i++) await press('wbmap:cfg:day+');

// what is not a level
let r = await upload({ level: '{"v":1,"name":"x"' });
ok(r.status === 400 && r.body.error === 'level', 'broken JSON is turned away');
r = await upload({ level: JSON.stringify(level({ rows: ["'); DROP TABLE levels; --", '.'] })) });
ok(r.status === 400 && r.body.error === 'level', 'SQL in the rows is not a level: ' + JSON.stringify(r.body.why));
r = await upload({ level: JSON.stringify(level({ items: [{ x: 1, y: 1, t: 'unit', cls: 'vehicle', kind: 'constructor' }] })) });
ok(r.status === 400, 'a kind the game has not is turned away');
r = await upload({ level: JSON.stringify(Object.assign(level(), { script: 'alert(1)' })) });
ok(r.status === 400, 'a field the format has not is turned away');
r = await upload({ level: JSON.stringify(level()).replace('"inventory":{', '"inventory":{"__proto__":1,') });
ok(r.status === 400, 'a prototype key in the inventory is turned away: ' + r.status);
r = await upload({ level: JSON.stringify(level({ name: 'x'.repeat(200) })) });
ok(r.status === 400, 'a name too long is turned away');
r = await upload({ level: 'x'.repeat(70000) });
ok(r.status === 400, 'a level too big is turned away');
r = await upload({ proof: '{}' });
ok(r.status === 400 && r.body.error === 'beat it first', 'without the author\'s times it is turned away');
r = await upload({ proof: JSON.stringify({ goal: 10, bonus: 10 }) });
ok(r.status === 400, 'times no one could make');
r = await upload({}, { image: null });
ok(r.status === 400 && r.body.error === 'image', 'without a picture');
r = await upload({}, { image: new TextEncoder().encode('<svg onload=alert(1)>'.padEnd(400, ' ')) });
ok(r.status === 400 && r.body.error === 'image', 'a picture that is not a PNG or JPEG');
r = await upload({ browser: '../../etc' });
ok(r.status === 400 && r.body.error === 'browser', 'a browser id of the wrong shape');
r = await upload({ name: '' });
ok(r.status === 400 && r.body.error === 'name', 'without a name');

// a good one
r = await upload({ name: 'Fuck' + tag });
ok(r.status === 200 && r.body.status === 'pending', 'a level is uploaded, waiting for the moderator: ' + JSON.stringify(r.body));
const id = r.body.id;
r = await upload({ name: 'Other' + tag }, { ip: '10.200.1.' + (parseInt(tag, 36) % 250) });
ok(r.status === 409 && r.body.error === 'already', 'the same map again is already up');
r = await get('/levels/' + id);
ok(r.status === 404, 'not to be seen until it is approved');
r = await get('/levels/mine?browser=' + browser);
ok(r.body.levels && r.body.levels[0].id === id && r.body.levels[0].status === 'pending', 'its author sees it waiting');
r = await fetch(SERVER + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ mission: 'C-' + id, kind: 'goal', ms: 60000, name: 'Maker' + tag }) });
ok(r.status === 400, 'no times are taken for it while it waits');

// the buttons
r = await press('wbmap:approve:' + id, '123456789012345678');
ok(r.body.reply && !r.body.update, 'anyone else\'s press does nothing');
r = await press('wbmap:approve:' + id, ADMIN, 'wrong');
ok(r.status === 401, 'without the bot\'s key, nothing');
r = await press('wbmap:approve:' + id);
ok(r.body.update && /approved/.test(r.body.update.embeds[0].description) && r.body.update.components[0].components[0].label === 'Unpublish', 'Approve: the message shows it out, with Unpublish');
ok(!/fuck/i.test(JSON.stringify(r.body.update)), 'the author\'s name starred out on the card');
r = await get('/levels/' + id);
ok(r.status === 200 && r.body.level.rows.length === 10 && !/fuck/i.test(r.body.author), 'now anyone can have it, its author\'s name clean: ' + r.body.author);
r = await get('/levels?sort=new');
ok(r.body.levels.some((x) => x.id === id), 'it is in the list');
r = await get('/levels?q=' + encodeURIComponent("test " + tag + "%' OR 1=1 --"));
ok(r.status === 200 && Array.isArray(r.body.levels), 'a search with SQL in it is only a search');
r = await get('/levels/' + id + '/image');
ok(r.status === 200 && new Uint8Array(r.body)[0] === 0x89, 'its picture');
r = await fetch(SERVER + '/levels/' + id + '/like', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ browser }) });
let b = await r.json();
ok(b.likes === 1 && b.liked, 'liked');
r = await fetch(SERVER + '/levels/' + id + '/like', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ browser }) });
b = await r.json();
ok(b.likes === 1, 'liked twice is liked once');
r = await get('/levels/liked?browser=' + browser);
ok(r.body.liked.includes(id), 'this browser\'s likes');
r = await fetch(SERVER + '/levels/' + id + '/like', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ browser, like: false }) });
b = await r.json();
ok(b.likes === 0 && !b.liked, 'and unliked (no dislikes)');
await fetch(SERVER + '/levels/' + id + '/play', { method: 'POST', headers: { Origin: ORIGIN } });
await fetch(SERVER + '/levels/' + id + '/play', { method: 'POST', headers: { Origin: ORIGIN } });
r = await get('/levels/' + id);
ok(r.body.plays === 1, 'played twice in an hour from one address counts once');
r = await fetch(SERVER + '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ mission: 'C-' + id, kind: 'goal', ms: 61000, name: 'Maker' + tag }) });
ok(r.status === 200, 'times are taken for it now');
r = await get('/scores?mission=C-' + id);
ok(r.body.goal.length === 1, 'and its own table');
r = await press('wbmap:unpublish:' + id);
ok(/unpublished/.test(r.body.update.embeds[0].description), 'Unpublish takes it down');
r = await get('/levels/' + id);
ok(r.status === 404, 'and it cannot be had');

// limits, auto-approve, closing, banning
for (let i = 0; i < 8; i++) await press('wbmap:cfg:author-');
p = await press('wbmap:cfg:author+');
ok(fieldOf(p.body, 'A day, one author') === '1', 'one author\'s limit set to 1 a day');
r = await upload({ level: JSON.stringify(level({ name: 'Second ' + tag, rows: level().rows.map((x, i) => i === 3 ? 'T' + x.slice(1) : x) })) });
ok(r.status === 429, 'a second upload the same day is turned away');
for (let i = 0; i < 8; i++) await press('wbmap:cfg:author+');
p = await press('wbmap:cfg:auto');
ok(fieldOf(p.body, 'Approved by themselves') === 'on', 'set to approve them by themselves');
r = await upload({ level: JSON.stringify(level({ name: 'Third ' + tag, rows: level().rows.map((x, i) => i === 4 ? 'T' + x.slice(1) : x) })) });
ok(r.status === 200 && r.body.status === 'approved', 'and one is out at once');
const third = r.body.id;
await press('wbmap:cfg:auto');
p = await press('wbmap:cfg:uploads');
ok(fieldOf(p.body, 'Uploads') === 'off', 'uploads closed');
r = await upload({ level: JSON.stringify(level({ name: 'Fourth ' + tag, rows: level().rows.map((x, i) => i === 5 ? 'T' + x.slice(1) : x) })) });
ok(r.status === 403 && r.body.error === 'closed', 'and turned away');
await press('wbmap:cfg:uploads');
r = await press('wbmap:ban:' + third);
ok(/banned/.test(r.body.update.embeds[0].description), 'Ban author');
r = await get('/levels/' + third);
ok(r.status === 404, 'what the banned author had up is taken down');
r = await upload({ level: JSON.stringify(level({ name: 'Fifth ' + tag, rows: level().rows.map((x, i) => i === 6 ? 'T' + x.slice(1) : x) })) });
ok(r.status === 403 && r.body.error === 'banned', 'and they upload no more');
p = await press('wbmap:panel');
const unban = p.body.update.components.find((row) => row.components[0].type === 3);
ok(unban && unban.components[0].options.length >= 1, 'the panel lists the banned');
for (const o of unban.components[0].options) if (o.label.includes(tag)) await press('wbmap:unban', ADMIN, KEY, [o.value]);
p = await press('wbmap:panel');
ok(!JSON.stringify(p.body).includes(tag), 'and unbans them');
r = await press('wbmap:approve:1 OR 1=1');
ok(r.body.reply, 'a button id of the wrong shape is nothing');

console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
