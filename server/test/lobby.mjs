// The lobby and the rooms' chat, against a server running locally (npm run dev):
//   node test/lobby.mjs [http://127.0.0.1:8787]
// A public race is listed once someone is in it, with its host's name; one made invite-only
// is not; chat lines reach everyone in the room and are shown to whoever comes later.

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
let failures = 0;
const check = (what, ok, detail) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + what + (detail !== undefined ? ': ' + JSON.stringify(detail) : ''));
  if (!ok) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function player(code, name) {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/races/' + code + '/ws');
  const p = { ws, got: [], name };
  ws.addEventListener('message', (e) => p.got.push(JSON.parse(e.data)));
  p.ready = new Promise((r) => ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'hello', name, token: name + Math.random() }));
    r();
  }));
  p.send = (m) => ws.send(JSON.stringify(m));
  p.last = (type) => [...p.got].reverse().find((m) => m.type === type);
  return p;
}
const lobbies = async () => (await (await fetch(BASE + '/lobbies')).json()).races;
const make = async (access) => (await (await fetch(BASE + '/races', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access }) })).json()).code;

const pub = await make('public');
const inv = await make('invite');
check('races are made', /^[2-9A-Z]{5}$/.test(pub) && /^[2-9A-Z]{5}$/.test(inv), [pub, inv]);
check('an empty race is not listed', !(await lobbies()).some((r) => r.code === pub));

const ann = player(pub, 'Ann');
const cid = player(inv, 'Cid');
await Promise.all([ann.ready, cid.ready]);
await wait(1600);
let list = await lobbies();
const mine = list.find((r) => r.code === pub);
check('a public race is listed, with its host', mine && mine.host === 'Ann' && mine.players === 1 && mine.phase === 'lobby', mine);
check('an invite-only race is not', !list.some((r) => r.code === inv));

ann.send({ type: 'mission', mission: '6.3' });
ann.send({ type: 'chat', text: 'hello   there' });
await wait(400);
const bob = player(pub, 'Bob');
await bob.ready;
await wait(500);
const welcome = bob.got.find((m) => m.type === 'welcome');
check('a newcomer is shown the chat so far', welcome && welcome.chat.some((c) => c.text === 'hello there' && c.name === 'Ann'), welcome && welcome.chat);
check('and everyone hears them come', ann.got.some((m) => m.type === 'chat' && m.system && /Bob joined/.test(m.text)));
bob.send({ type: 'chat', text: 'hi Ann' });
await wait(400);
check('a line reaches everyone', ann.got.some((m) => m.type === 'chat' && m.text === 'hi Ann' && m.name === 'Bob'));
for (let i = 0; i < 7; i++) bob.send({ type: 'chat', text: 'spam ' + i });
await wait(400);
check('too many lines too fast are turned down', bob.got.some((m) => m.type === 'error' && m.reason === 'slow down'));
await wait(1300);
list = await lobbies();
check('the listing follows the room', (list.find((r) => r.code === pub) || {}).players === 2 && (list.find((r) => r.code === pub) || {}).mission === '6.3', list.find((r) => r.code === pub));

ann.send({ type: 'access', access: 'invite' });
await wait(1600);
check('made invite-only, it leaves the list', !(await lobbies()).some((r) => r.code === pub));
ann.send({ type: 'access', access: 'public' });
await wait(1600);
check('made public again, it is back', (await lobbies()).some((r) => r.code === pub));

for (const p of [ann, bob, cid]) p.ws.close();
console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
