// World Builder Online's server: one Cloudflare Worker.
//
//   /scores...          the score tables (scores.js)
//   /admin, /results/   the tables' owner's (scores.js)
//   /health             that the server is up

import { preflight, json, text } from './http.js';
import { handleScores } from './scores.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return preflight(env, request);
    try {
      const scores = await handleScores(request, env, url, ctx);
      if (scores) return scores;
      if (url.pathname === '/health') return json(env, request, { ok: true, time: Date.now() });
      if (url.pathname === '/') return text(env, request, 'World Builder Online server. The game is at https://wbonline.viosarcade.xyz/\n');
      return json(env, request, { error: 'not found' }, 404);
    } catch (e) {
      return json(env, request, { error: 'server', message: String(e && e.message || e) }, 500);
    }
  },
};
