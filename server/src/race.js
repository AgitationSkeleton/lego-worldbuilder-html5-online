// A race: two to six players play the same mission, each in their own game, and the room
// tells everyone how the others are doing.  Nothing of a game is shared but what happened in
// it (started, goal reached and when, bonus, gave up), so there is nothing to keep in step.
// One Durable Object for each race, named by its code; everyone in it is connected by a
// WebSocket.
//
// Messages are JSON.  From the page:
//   hello {name, token}       first, always; token (the page's secret) lets a player who lost
//                             their connection come back as themselves
//   mission {mission}         the host: "6.3", or a generated mission "R-6DK2Q9"
//   ready {ready}             a player is ready (or not)
//   start {}                  the host: the race starts, for everyone, in a few seconds
//   again {}                  the host, after a race: back to choosing, times cleared
//   progress {what, ms}       what: started, goal, bonus (with the game's clock), quit
//   units {u}                 where the player's units are, a few times a second while
//                             racing, for the others to draw as ghosts: u is a list of
//                             [member, x, y, column, row, flipped] (see src/online/race.js)
//   ping {t}
// From the room:
//   welcome {you, room}  room {room}  start {mission, in}  pong {t}  error {reason}
//   units {from, u}           another player's units, passed on as they came
//
// The room as the pages see it: {code, host, mission, phase, players: [{id, name, connected,
// ready, started, goal, bonus, quit}], version}; phase is lobby, racing or done.

import { DurableObject } from 'cloudflare:workers';
import { json, allowedOrigin, cleanName } from './http.js';
import { censor } from '../../src/online/profanity.js';

const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/;
const MISSION_RE = /^([1-7]\.([1-9]|1[0-2])|R-[1-7][A-L][0-9A-HJKMNP-TV-Z]{4})$/;
const MAX_PLAYERS = 6;
const COUNTDOWN_MS = 4000;      // from the host's start to everyone's
const GRACE_MS = 30000;         // how long a disconnected player's place is kept
const EMPTY_MS = 60000;         // how long a room with nobody in it lasts
const UNITS_MS = 100;           // units are passed on at most this often from one player
const MAX_UNITS = 60;

function newCode() {
  const b = new Uint8Array(5);
  crypto.getRandomValues(b);
  return [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}

function randomId() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}

// The Worker's side: making a race, asking about one, connecting to one.
//   POST /races            {code}
//   GET  /races/CODE       {exists, phase, players}
//   GET  /races/CODE/ws    the race itself, a WebSocket
export async function handleRaces(request, env, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'races') return null;
  if (parts.length === 1 && request.method === 'POST') {
    for (let i = 0; i < 6; i++) {
      const code = newCode();
      const r = await env.RACE.get(env.RACE.idFromName(code)).init(code);
      if (r.ok) return json(env, request, { code });
    }
    return json(env, request, { error: 'busy' }, 503);
  }
  const code = String(parts[1] || '').toUpperCase();
  if (!CODE_RE.test(code)) return json(env, request, { error: 'no such race' }, 404);
  const stub = env.RACE.get(env.RACE.idFromName(code));
  if (parts[2] === 'ws') {
    if (request.headers.get('Upgrade') !== 'websocket') return json(env, request, { error: 'expected a WebSocket' }, 426);
    const origin = request.headers.get('Origin');
    if (origin && !allowedOrigin(env, origin)) return json(env, request, { error: 'origin' }, 403);
    return stub.fetch(request);
  }
  if (parts.length === 2 && request.method === 'GET') return json(env, request, await stub.info());
  return json(env, request, { error: 'not found' }, 404);
}

export class Race extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.race = null;
    this.players = new Map();       // id -> {id, token, name, ws, connected, ready, started, goal, bonus, quit, gone}
    this.timers = {};
  }

  async init(code) {
    if (this.race) return { ok: false };
    this.race = { code, host: null, mission: null, phase: 'lobby', version: 0, created: Date.now() };
    this.expireSoon();
    return { ok: true };
  }

  async info() {
    if (!this.race) return { exists: false };
    return { exists: true, phase: this.race.phase, players: this.present().length };
  }

  present() {
    return [...this.players.values()].filter((p) => !p.gone);
  }

  async fetch(request) {
    if (!this.race) return new Response('no such race', { status: 404 });
    const pair = new WebSocketPair();
    const [client, ws] = Object.values(pair);
    ws.accept();
    const conn = { ws, player: null };
    ws.addEventListener('message', (ev) => {
      let m;
      try {
        m = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data));
      } catch (e) {
        return;
      }
      try {
        this.onMessage(conn, m);
      } catch (e) {
        this.send(ws, { type: 'error', reason: 'server', message: String(e && e.message || e) });
      }
    });
    const closed = () => this.onClose(conn);
    ws.addEventListener('close', closed);
    ws.addEventListener('error', closed);
    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, m) {
    try {
      ws.send(JSON.stringify(m));
    } catch (e) {
      // (gone: its close will come)
    }
  }

  broadcast(m) {
    for (const p of this.players.values()) if (p.connected && p.ws) this.send(p.ws, m);
  }

  view() {
    const r = this.race;
    return {
      code: r.code, host: r.host, mission: r.mission, phase: r.phase, version: r.version,
      players: this.present().map((p) => ({
        id: p.id, name: p.name, connected: p.connected, ready: p.ready,
        started: p.started, goal: p.goal, bonus: p.bonus, quit: p.quit,
      })),
    };
  }

  changed() {
    this.race.version++;
    this.broadcast({ type: 'room', room: this.view() });
  }

  onMessage(conn, m) {
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'ping') return this.send(conn.ws, { type: 'pong', t: m.t });
    if (m.type === 'hello') return this.hello(conn, m);
    const p = conn.player;
    if (!p) return this.send(conn.ws, { type: 'error', reason: 'hello first' });
    const r = this.race;
    const host = r.host === p.id;
    switch (m.type) {
      case 'mission':
        if (!host || r.phase !== 'lobby') return;
        if (!MISSION_RE.test(String(m.mission || ''))) return this.send(conn.ws, { type: 'error', reason: 'mission' });
        r.mission = String(m.mission);
        for (const q of this.players.values()) q.ready = false;
        return this.changed();
      case 'ready':
        if (r.phase !== 'lobby') return;
        p.ready = !!m.ready;
        return this.changed();
      case 'start':
        if (!host || r.phase !== 'lobby' || !r.mission) return;
        r.phase = 'racing';
        for (const q of this.players.values()) Object.assign(q, { started: false, goal: null, bonus: null, quit: false });
        this.broadcast({ type: 'start', mission: r.mission, in: COUNTDOWN_MS });
        return this.changed();
      case 'again':
        if (!host || r.phase === 'lobby') return;
        r.phase = 'lobby';
        for (const q of this.players.values()) Object.assign(q, { ready: false, started: false, goal: null, bonus: null, quit: false });
        return this.changed();
      case 'units': {
        if (r.phase !== 'racing' || !p.started || !Array.isArray(m.u) || m.u.length > MAX_UNITS) return;
        const now = Date.now();
        if (now - (p.unitsAt || 0) < UNITS_MS) return;
        p.unitsAt = now;
        const u = m.u.filter((x) => Array.isArray(x) && x.length === 6 && typeof x[0] === 'string' && x[0].length <= 48 &&
          x.slice(1, 5).every(Number.isFinite)).map((x) => [x[0], Math.round(x[1]), Math.round(x[2]), Math.round(x[3]), Math.round(x[4]), x[5] ? 1 : 0]);
        const out = JSON.stringify({ type: 'units', from: p.id, u });
        for (const q of this.players.values()) {
          if (q !== p && q.connected && q.ws) try { q.ws.send(out); } catch (e) { /* gone */ }
        }
        return;
      }
      case 'progress': {
        if (r.phase !== 'racing') return;
        const ms = Number(m.ms);
        if (m.what === 'started') p.started = true;
        else if (m.what === 'goal' && p.goal === null && Number.isInteger(ms) && ms > 0) p.goal = ms;
        else if (m.what === 'bonus' && p.bonus === null && Number.isInteger(ms) && ms > 0) p.bonus = ms;
        else if (m.what === 'quit' && p.goal === null) p.quit = true;
        else return;
        this.checkDone();
        return this.changed();
      }
      default:
    }
  }

  hello(conn, m) {
    const token = String(m.token || '').slice(0, 64);
    const name = censor(cleanName(m.name) || 'Player');
    // the same page back after losing its connection
    let p = [...this.players.values()].find((q) => q.token === token && token && !q.gone);
    if (p) {
      if (p.ws && p.ws !== conn.ws) try { p.ws.close(1000, 'replaced'); } catch (e) { /* gone */ }
      clearTimeout(this.timers['grace:' + p.id]);
    } else {
      if (this.present().length >= MAX_PLAYERS) return this.send(conn.ws, { type: 'error', reason: 'full' });
      if (this.race.phase !== 'lobby') return this.send(conn.ws, { type: 'error', reason: 'running' });
      p = { id: randomId(), token, ready: false, started: false, goal: null, bonus: null, quit: false, gone: false };
      this.players.set(p.id, p);
    }
    Object.assign(p, { name, ws: conn.ws, connected: true });
    conn.player = p;
    if (!this.race.host || !this.players.get(this.race.host) || this.players.get(this.race.host).gone) this.race.host = p.id;
    clearTimeout(this.timers.empty);
    this.send(conn.ws, { type: 'welcome', you: p.id, room: this.view() });
    this.changed();
  }

  onClose(conn) {
    const p = conn.player;
    if (!p || p.ws !== conn.ws) return;
    p.connected = false;
    p.ws = null;
    this.timers['grace:' + p.id] = setTimeout(() => this.leave(p), GRACE_MS);
    if (!this.present().some((q) => q.connected)) this.expireSoon();
    this.changed();
  }

  // A player gone for good: their place freed, the host passed on.
  leave(p) {
    p.gone = true;
    if (this.race.phase === 'racing' && p.goal === null) p.quit = true;
    if (this.race.host === p.id) {
      const next = this.present().find((q) => q.connected) || this.present()[0];
      this.race.host = next ? next.id : null;
    }
    this.checkDone();
    this.changed();
  }

  // The race is over when everyone still in it has reached the goal or given up.
  checkDone() {
    if (this.race.phase !== 'racing') return;
    const left = this.present().filter((q) => q.goal === null && !q.quit);
    if (!left.length) this.race.phase = 'done';
  }

  expireSoon() {
    clearTimeout(this.timers.empty);
    this.timers.empty = setTimeout(() => {
      if (this.present().some((q) => q.connected)) return;
      this.race = null;
      this.players.clear();
    }, EMPTY_MS);
  }
}
