// World Builder Online's server: one Cloudflare Worker.
//
//   /scores...          the score tables (scores.js)
//   /admin, /results/   the tables' owner's (scores.js)
//   /races...           races: the same mission for two to six players (race.js)
//   /lobbies            the races open to anyone (lobby.js)
//   /random             the log of generated missions, with pictures (random.js)
//   /health             that the server is up

import { preflight, json, text } from './http.js';
import { handleScores } from './scores.js';
import { handleRaces } from './race.js';
import { handleLobby } from './lobby.js';
import { handleRandom } from './random.js';

export { Race } from './race.js';
export { Lobby } from './lobby.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return preflight(env, request);
    try {
      const scores = await handleScores(request, env, url, ctx);
      if (scores) return scores;
      const races = await handleRaces(request, env, url);
      if (races) return races;
      const lobbies = await handleLobby(request, env, url);
      if (lobbies) return lobbies;
      const random = await handleRandom(request, env, url, ctx);
      if (random) return random;
      if (url.pathname === '/health') return json(env, request, { ok: true, time: Date.now() });
      if (url.pathname === '/') return text(env, request, 'World Builder Online server. The game is at https://wbonline.viosarcade.xyz/\n');
      return json(env, request, { error: 'not found' }, 404);
    } catch (e) {
      return json(env, request, { error: 'server', message: String(e && e.message || e) }, 500);
    }
  },
};
