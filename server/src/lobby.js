// The lobby: the races open to anyone, as the race page lists them. One Durable Object for
// the whole server (named "global"). Each race tells it how it stands when that changes,
// and every quarter of a minute while anyone is in it (server/src/race.js); a race not
// heard from for a while is dropped, so the list mends itself if the lobby is ever reset.
//
//   GET /lobbies    {races: [{code, host, mission, phase, players, max, created}]}

import { DurableObject } from 'cloudflare:workers';
import { json } from './http.js';

const STALE_MS = 45000;

export async function handleLobby(request, env, url) {
  if (url.pathname !== '/lobbies' || request.method !== 'GET') return null;
  const races = await lobby(env).list();
  return json(env, request, { races });
}

export function lobby(env) {
  return env.LOBBY.get(env.LOBBY.idFromName('global'));
}

export class Lobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.races = new Map();
  }

  async report(race) {
    if (!race || typeof race.code !== 'string') return;
    this.races.set(race.code, Object.assign({}, race, { seen: Date.now() }));
  }

  async remove(code) {
    this.races.delete(code);
  }

  async list() {
    const now = Date.now();
    for (const [code, r] of this.races) if (now - r.seen > STALE_MS) this.races.delete(code);
    return [...this.races.values()]
      .sort((a, b) => (a.phase === 'lobby' ? 0 : 1) - (b.phase === 'lobby' ? 0 : 1) || b.created - a.created)
      .map(({ seen, ...r }) => r);
  }
}
