// The score tables against a running server (npm run dev, then npm test; SERVER=... for
// another).  Uses mission 7.12 and names made for the run, so it can run against a database
// that already has results.
const SERVER = process.env.SERVER || 'http://127.0.0.1:8787';
const ORIGIN = 'http://127.0.0.1:8766';
let failures = 0;
const ok = (cond, what) => {
  if (!cond) failures++;
  console.log((cond ? 'ok   ' : 'FAIL ') + what);
};

const tag = Math.random().toString(36).slice(2, 7);
const mission = '7.12';

async function post(body) {
  const r = await fetch(`${SERVER}/scores`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json(), cors: r.headers.get('Access-Control-Allow-Origin') };
}

const health = await (await fetch(`${SERVER}/health`)).json();
ok(health.ok, 'the server is up');

const ann = 'Ann' + tag, bob = 'Bob' + tag;
const before = await (await fetch(`${SERVER}/scores?mission=${mission}&limit=50`)).json();
const others = before.goal.length;

let r = await post({ mission, kind: 'goal', ms: 95000, name: ann });
ok(r.status === 200 && r.body.ok && r.body.best === 95000, 'a goal time is saved: ' + JSON.stringify(r.body));
ok(r.cors === ORIGIN, 'the game\'s page may read the answer');
r = await post({ mission, kind: 'goal', ms: 80000, name: bob });
ok(r.body.ok && r.body.best === 80000, 'a second name');
r = await post({ mission, kind: 'goal', ms: 120000, name: ann.toUpperCase() });
ok(r.body.ok && r.body.best === 95000 && !r.body.improved, 'a slower time keeps the best (names ignore case): ' + JSON.stringify(r.body));
r = await post({ mission, kind: 'goal', ms: 70000, name: ann });
ok(r.body.ok && r.body.best === 70000 && r.body.improved, 'a faster one is the new best');
r = await post({ mission, kind: 'bonus', ms: 150000, name: ann });
ok(r.body.ok && r.body.rank >= 1, 'a bonus time is saved');

const t = await (await fetch(`${SERVER}/scores?mission=${mission}&limit=50`)).json();
const annRow = t.goal.find((x) => x.name.toLowerCase() === ann.toLowerCase());
const bobRow = t.goal.find((x) => x.name.toLowerCase() === bob.toLowerCase());
ok(annRow && annRow.ms === 70000 && bobRow && bobRow.ms === 80000, 'the table has each name once, at its best');
ok(t.goal.indexOf(annRow) < t.goal.indexOf(bobRow), 'fastest first');
ok(t.goal.length === others + 2, 'two more names than before');
ok(t.bonus.some((x) => x.name.toLowerCase() === ann.toLowerCase() && x.ms === 150000), 'the bonus table');

const o = await (await fetch(`${SERVER}/scores/overall`)).json();
const annAll = o.overall.find((x) => x.name.toLowerCase() === ann.toLowerCase());
ok(annAll && annAll.goals === 1 && annAll.bonuses === 1 && annAll.ms === 70000, 'the overall table: ' + JSON.stringify(annAll));

// what is turned away
ok((await post({ mission: '8.1', kind: 'goal', ms: 50000, name: ann })).status === 400, 'no world 8');
ok((await post({ mission: '1.13', kind: 'goal', ms: 50000, name: ann })).status === 400, 'no mission 13');
ok((await post({ mission, kind: 'win', ms: 50000, name: ann })).status === 400, 'only goal and bonus');
ok((await post({ mission, kind: 'goal', ms: 1200, name: ann })).status === 400, 'not too fast');
ok((await post({ mission, kind: 'goal', ms: 50000.5, name: ann })).status === 400, 'whole milliseconds');
ok((await post({ mission, kind: 'goal', ms: 50000, name: '   ' })).status === 400, 'a name is needed');
ok((await post({ mission, kind: 'goal', ms: 50000, name: 'www.example.com' })).status === 400, 'no links for names');
r = await post({ mission, kind: 'goal', ms: 99000, name: '<b>Cy' + tag + '</b>' });
ok(r.status === 200, 'markup is taken out of a name');
const t2 = await (await fetch(`${SERVER}/scores?mission=${mission}&limit=50`)).json();
ok(t2.goal.some((x) => x.name === 'bCy' + tag + '/b'), 'and the name kept is plain');

ok((await fetch(`${SERVER}/admin`)).status === 401, 'the owner\'s list needs the key');

console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);
