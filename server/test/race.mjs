// Races against a running server (npm run dev, then npm test; SERVER=... for another): two
// players make and join a race, the host picks a mission and starts it, both report their
// progress, and the race ends; one who loses their connection comes back as themselves.
const SERVER = process.env.SERVER || 'http://127.0.0.1:8787';
const WS = SERVER.replace(/^http/, 'ws');
let failures = 0;
const ok = (cond, what) => {
  if (!cond) failures++;
  console.log((cond ? 'ok   ' : 'FAIL ') + what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function player(code, name, token = 'token-' + name + '-' + Math.random().toString(36).slice(2)) {
  const ws = new WebSocket(`${WS}/races/${code}/ws`);
  const p = { ws, name, token, got: [], room: null, you: null, start: null, errors: [] };
  p.opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'hello', name, token }));
      resolve();
    });
    ws.addEventListener('error', reject);
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    p.got.push(m);
    if (m.type === 'welcome') { p.you = m.you; p.room = m.room; }
    if (m.type === 'room') p.room = m.room;
    if (m.type === 'start') p.start = m;
    if (m.type === 'error') p.errors.push(m.reason);
  });
  p.send = (m) => ws.send(JSON.stringify(m));
  p.until = async (fn, ms = 3000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (fn()) return true;
      await sleep(20);
    }
    return false;
  };
  p.me = () => p.room && p.room.players.find((x) => x.id === p.you);
  return p;
}

const made = await (await fetch(`${SERVER}/races`, { method: 'POST' })).json();
ok(/^[2-9A-Z]{5}$/.test(made.code), 'a race is made: ' + made.code);
const ann = player(made.code, 'Ann');
await ann.opened;
ok(await ann.until(() => ann.room && ann.room.host === ann.you), 'the first in is the host');
const bob = player(made.code, 'Bob');
await bob.opened;
ok(await ann.until(() => ann.room.players.length === 2), 'a second player joins, and the host hears of it');

bob.send({ type: 'mission', mission: '6.2' });
await sleep(200);
ok(!ann.room.mission, 'only the host picks the mission');
ann.send({ type: 'mission', mission: '9.9' });
ok(await ann.until(() => ann.errors.includes('mission')), 'a mission that does not exist is refused');
ann.send({ type: 'mission', mission: 'R-6DK2Q9' });
ok(await bob.until(() => bob.room.mission === 'R-6DK2Q9'), 'the host picks a generated mission, and everyone sees it');
bob.send({ type: 'ready', ready: true });
ok(await ann.until(() => ann.room.players.find((x) => x.name === 'Bob').ready), 'a player is ready');

ann.send({ type: 'start' });
ok(await bob.until(() => bob.start && bob.start.mission === 'R-6DK2Q9' && bob.start.in > 0), 'the host starts it, for everyone, after a countdown');
ok(await ann.until(() => ann.room.phase === 'racing'), 'the race is on');
const cara = player(made.code, 'Cara');
await cara.opened;
ok(await cara.until(() => cara.errors.includes('running')), 'no one joins a race under way');

ann.send({ type: 'progress', what: 'started' });
bob.send({ type: 'progress', what: 'started' });
bob.send({ type: 'progress', what: 'goal', ms: 61000 });
ok(await ann.until(() => ann.room.players.find((x) => x.name === 'Bob').goal === 61000), 'a goal reached is told to everyone, with its time');
bob.send({ type: 'progress', what: 'goal', ms: 1000 });
await sleep(200);
ok(bob.me().goal === 61000, 'a goal is reached once');

// Ann loses her connection and comes back with the same token
ann.ws.close();
ok(await bob.until(() => bob.room.players.find((x) => x.name === 'Ann') && !bob.room.players.find((x) => x.name === 'Ann').connected), 'one who loses their connection is shown so');
const ann2 = player(made.code, 'Ann', ann.token);
await ann2.opened;
ok(await ann2.until(() => ann2.you === ann.you && ann2.room.host === ann.you), 'and comes back as themselves, still the host');
ann2.send({ type: 'progress', what: 'goal', ms: 75000 });
ok(await bob.until(() => bob.room.phase === 'done'), 'when everyone has reached the goal, the race is over');

ann2.send({ type: 'again' });
ok(await bob.until(() => bob.room.phase === 'lobby' && bob.room.players.every((x) => x.goal === null)), 'the host goes again: times cleared');

const info = await (await fetch(`${SERVER}/races/${made.code}`)).json();
ok(info.exists && info.players === 2, 'the race can be asked about');
const none = await fetch(`${SERVER}/races/22222`);
ok((await none.json()).exists === false, 'a race that was never made does not exist');

for (const p of [ann2, bob, cara]) p.ws.close();
console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
