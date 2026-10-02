// Small HTTP helpers: CORS for the game's pages, and replies.  (As CrystAlien Conflict's
// server has them.)

// Is this page allowed?  ALLOWED_ORIGINS is a comma-separated list; an entry ending ":*"
// allows any port of that host (for testing on localhost).
export function allowedOrigin(env, origin) {
  if (!origin) return null;
  for (const entry of String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (entry === '*' || entry === origin) return origin;
    if (entry.endsWith(':*') && (origin === entry.slice(0, -2) || origin.startsWith(entry.slice(0, -1)))) return origin;
  }
  return null;
}

export function cors(env, request, headers = {}) {
  const origin = allowedOrigin(env, request.headers.get('Origin'));
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

export function preflight(env, request) {
  const headers = cors(env, request, {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  });
  return new Response(null, { status: 204, headers });
}

export function json(env, request, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors(env, request, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }) });
}

export function text(env, request, body, status = 200, type = 'text/plain; charset=utf-8') {
  return new Response(body, { status, headers: cors(env, request, { 'Content-Type': type, 'Cache-Control': 'no-store' }) });
}

export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '0.0.0.0';
}

// A player's name as the tables may show it: printable, trimmed, one space at a time, at
// most `max` characters; null if nothing is left.
export function cleanName(v, max = 15) {
  let s = String(v || '').normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f<>&"\\]/g, '').replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max).trim();
  return s || null;
}

// A name that is not a link (profanity is starred out: src/online/profanity.js).
const LINKS = ['http', 'www.', '.com'];
export function decentName(name) {
  const flat = name.toLowerCase().replace(/[^a-z0-9.]/g, '');
  return !LINKS.some((w) => flat.includes(w));
}
