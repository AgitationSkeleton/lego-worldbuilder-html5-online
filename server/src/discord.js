// The server's log for its owner: a message to a Discord channel's webhook for each new best
// time.  The webhook is the DISCORD_WEBHOOK secret (`wrangler secret put DISCORD_WEBHOOK`),
// never in the repository, which is public: whoever has it can post to the channel.  Without
// it nothing is sent.  A message that fails is let go: the game never waits on it.

// Players' names as they are, not as Discord's formatting would take them.
export function plain(s) {
  return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/[\\*_~`|>#[\]()<:@-]/g, '\\$&').slice(0, 100);
}

// A time as the game's clock shows it: "3:07", "1:02:45".
export function clock(ms) {
  const t = Math.floor(ms / 1000);
  const s = t % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
  const two = (n) => String(n).padStart(2, '0');
  return h ? h + ':' + two(m) + ':' + two(s) : m + ':' + two(s);
}

// One message.  ctx: whatever can keep the Worker running until it is sent (its waitUntil).
export function discord(env, ctx, text) {
  if (!env || !env.DISCORD_WEBHOOK) return;
  const send = fetch(env.DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // (no one is pinged, whatever a name says)
    body: JSON.stringify({ username: 'World Builder server', content: String(text).slice(0, 1900), allowed_mentions: { parse: [] } }),
  }).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(send);
}
