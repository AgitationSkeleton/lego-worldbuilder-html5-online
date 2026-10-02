// The score tables: for each mission, the fastest to its goal and the fastest to its bonus
// goal (one row per name, their best), and over all missions, who has done the most.
//
//   POST /scores                  JSON {mission: "6.3", kind: "goal"|"bonus", ms, name}:
//                                 a result, by the game's clock from the mission's start.
//                                 Answers {ok, best, rank, of}: the name's best there, its
//                                 place and how many names the table has.
//   GET  /scores?mission=6.3      {mission, goal: [{name, ms}], bonus: [...]}, the best 10 of
//                                 each (&limit=, up to 50)
//   GET  /scores/overall          [{name, goals, bonuses, ms}]: campaign missions with the goal
//                                 reached, with the bonus, and the best goal times added up; the
//                                 best 50
//
// A generated mission (src/online/random.js) is "R-" and its code, such as R-6DK2Q9: it has
// tables of its own, and is not counted in the overall table.
//
// and the tables' owner, with the ADMIN_KEY secret (Authorization: Bearer ...):
//
//   GET    /admin?mission=6.3     the newest 500 results (all missions without it), with ids
//   DELETE /results/ID            remove one

import { json, sha256Hex, clientIp, cleanName, decentName } from './http.js';
import { censor } from '../../src/online/profanity.js';
import { discord, plain, clock } from './discord.js';

// a campaign mission, "<world>.<mission>", or a generated one, "R-" and its code (src/online/random.js)
const MISSION = /^([1-7]\.([1-9]|1[0-2])|R-[1-7][A-L][0-9A-HJKMNP-TV-Z]{4})$/;
const KINDS = new Set(['goal', 'bonus']);
// No mission is won in under three seconds: the first unit has to move.  (Each mission's own
// least, from the shortest route there, is for later.)
const MIN_MS = 3000;
const MAX_MS = 6 * 3600 * 1000;
// Results one address may send in an hour.
const PER_HOUR = 60;

// The best of each name (however it is capitalised) for a mission's goal or bonus, fastest
// first; a name shown as it was last written.
async function table(env, mission, kind, limit) {
  const { results } = await env.DB.prepare(
    `SELECT name, ms FROM (
       SELECT name, ms, created, ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY ms ASC, created ASC) AS r
       FROM results WHERE mission = ?1 AND kind = ?2)
     WHERE r = 1 ORDER BY ms ASC, created ASC LIMIT ?3`).bind(mission, kind, limit).all();
  return (results || []).map((r) => ({ name: censor(r.name), ms: r.ms }));
}

async function overall(env, limit) {
  const { results } = await env.DB.prepare(
    `WITH best AS (
       SELECT lower(name) AS who, mission, kind, MIN(ms) AS ms FROM results WHERE mission NOT LIKE 'R-%'
       GROUP BY lower(name), mission, kind),
     names AS (
       SELECT lower(name) AS who, name, ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY created DESC) AS r FROM results)
     SELECT n.name AS name,
            SUM(b.kind = 'goal') AS goals,
            SUM(b.kind = 'bonus') AS bonuses,
            SUM(CASE WHEN b.kind = 'goal' THEN b.ms ELSE 0 END) AS ms
     FROM best b JOIN names n ON n.who = b.who AND n.r = 1
     GROUP BY b.who ORDER BY goals DESC, bonuses DESC, ms ASC LIMIT ?1`).bind(limit).all();
  return (results || []).map((r) => ({ name: censor(r.name), goals: r.goals, bonuses: r.bonuses, ms: r.ms }));
}

async function save(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(env, request, { error: 'json' }, 400);
  }
  const mission = String(body && body.mission || '');
  const kind = String(body && body.kind || '');
  const ms = Number(body && body.ms);
  // (profanity starred out, not turned away: the player would lose the time)
  const given = cleanName(body && body.name);
  const name = given && censor(given);
  if (!MISSION.test(mission) || !KINDS.has(kind) || !Number.isInteger(ms)) return json(env, request, { error: 'fields' }, 400);
  if (ms < MIN_MS || ms > MAX_MS) return json(env, request, { error: 'time' }, 400);
  if (!name || !decentName(name)) return json(env, request, { error: 'name' }, 400);
  const ipHash = (await sha256Hex((env.IP_SALT || 'worldbuilder') + '|' + clientIp(request))).slice(0, 32);
  const now = Date.now();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM results WHERE ip_hash = ?1 AND created > ?2').bind(ipHash, now - 3600000).first();
  if (recent && recent.n >= PER_HOUR) return json(env, request, { error: 'later' }, 429);
  const before = await env.DB.prepare('SELECT MIN(ms) AS best FROM results WHERE mission = ?1 AND kind = ?2 AND lower(name) = lower(?3)')
    .bind(mission, kind, name).first();
  await env.DB.prepare('INSERT INTO results (mission, kind, ms, name, created, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(mission, kind, ms, name, now, ipHash).run();
  const best = before && before.best !== null && before.best < ms ? before.best : ms;
  // (the name's own best is not ahead of itself)
  const place = await env.DB.prepare(
    `SELECT SUM(b < ?3) AS ahead, COUNT(*) AS names FROM (
       SELECT MIN(ms) AS b FROM results WHERE mission = ?1 AND kind = ?2 GROUP BY lower(name))`).bind(mission, kind, best).first();
  const rank = (place && place.ahead ? place.ahead : 0) + 1;
  const of = place ? place.names : 1;
  const improved = !before || before.best === null || ms < before.best;
  if (improved) {
    discord(env, ctx, `\u{1F9F1} **${plain(name)}**: mission ${mission} ${kind === 'bonus' ? 'bonus' : 'goal'} in ${clock(ms)}, #${rank} of ${of}`);
  }
  return json(env, request, { ok: true, best, rank, of, improved });
}

export async function handleScores(request, env, url, ctx) {
  const path = url.pathname;
  if (path === '/scores' && request.method === 'POST') return save(request, env, ctx);
  if (path === '/scores' && request.method === 'GET') {
    const mission = url.searchParams.get('mission') || '';
    if (!MISSION.test(mission)) return json(env, request, { error: 'mission' }, 400);
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 10));
    const [goal, bonus] = await Promise.all([table(env, mission, 'goal', limit), table(env, mission, 'bonus', limit)]);
    return json(env, request, { mission, goal, bonus });
  }
  if (path === '/scores/overall' && request.method === 'GET') {
    return json(env, request, { overall: await overall(env, 50) });
  }
  // the tables' owner
  if (path === '/admin' || path.startsWith('/results/')) {
    const auth = request.headers.get('Authorization') || '';
    if (!env.ADMIN_KEY || auth !== 'Bearer ' + env.ADMIN_KEY) return json(env, request, { error: 'unauthorised' }, 401);
    if (path === '/admin' && request.method === 'GET') {
      const mission = url.searchParams.get('mission');
      const q = mission
        ? env.DB.prepare('SELECT id, mission, kind, ms, name, created FROM results WHERE mission = ?1 ORDER BY created DESC LIMIT 500').bind(mission)
        : env.DB.prepare('SELECT id, mission, kind, ms, name, created FROM results ORDER BY created DESC LIMIT 500');
      const { results } = await q.all();
      return json(env, request, { rows: results || [] });
    }
    const id = Number(path.slice('/results/'.length));
    if (request.method === 'DELETE' && Number.isInteger(id)) {
      const r = await env.DB.prepare('DELETE FROM results WHERE id = ?1').bind(id).run();
      return json(env, request, { deleted: r.meta ? r.meta.changes : 0 });
    }
  }
  return null;
}
