// The game installed (the web app manifest, manifest.webmanifest) and played offline: a
// service worker that keeps the game's files (src/online/offline.js tells it which).
//
// - The page itself (index.html, whatever its ?random= or ?race=) comes from the network
//   first, so that a visit online always has the newest version; offline, or the network too
//   slow, the copy kept from the last visit.
// - Everything else of the site is named by its contents (?v=, tools/stamp.py): kept once
//   fetched, and never asked for again.  The page sends the list of its version's files when
//   it starts; those not yet kept are fetched then (the game plays offline from the first
//   visit on), and those of older versions are let go.
// - Other sites (the score server, GitHub) are not touched.

const CACHE = 'wbonline-v1';
const SCOPE = self.registration.scope;
const PAGE = SCOPE;                    // the page, under one name whatever its query
const SLOW = 4000;                     // how long the page waits for the network, in ms

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'keep' && Array.isArray(e.data.files)) e.waitUntil(keep(e.data.files));
});

// This version's files kept, and the rest let go.
async function keep(files) {
  const cache = await caches.open(CACHE);
  const want = new Set(files.map((f) => new URL(f, SCOPE).href));
  want.add(PAGE);
  for (const req of await cache.keys()) if (!want.has(req.url)) await cache.delete(req);
  for (const url of want) {
    if (url === PAGE || await cache.match(url)) continue;
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (r.ok) await cache.put(url, r);
    } catch (err) {
      // (offline: kept when next fetched)
    }
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(SCOPE)) return;
  if (req.mode === 'navigate') e.respondWith(page(req));
  else e.respondWith(file(req));
});

// The page: from the network if it answers in time (and kept), else the copy kept.
async function page(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then((r) => {
    if (r.ok) cache.put(PAGE, r.clone());
    return r;
  });
  const late = new Promise((resolve) => setTimeout(resolve, SLOW, null));
  try {
    const r = await Promise.race([net, late]);
    if (r) return r;
  } catch (err) {
    // (offline)
  }
  const kept = await cache.match(PAGE);
  return kept || net;
}

// A file: the copy kept, or fetched and kept.
async function file(req) {
  const cache = await caches.open(CACHE);
  const kept = await cache.match(req);
  if (kept) return kept;
  const r = await fetch(req);
  if (r.ok && r.type === 'basic') cache.put(req, r.clone());
  return r;
}
