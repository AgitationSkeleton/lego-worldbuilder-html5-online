// The server's log for its owner: a message to a Discord channel's webhook for each new best
// time, and for each generated mission played for the first time, with a picture of it
// (random.js).  The webhook is the DISCORD_WEBHOOK secret (`wrangler secret put
// DISCORD_WEBHOOK`), never in the repository, which is public: whoever has it can post to
// the channel.  Without it nothing is sent.  A message that fails is let go: the game never
// waits on it.

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
    body: JSON.stringify(message(text)),
  }).then(failed, failed);
  if (ctx && ctx.waitUntil) ctx.waitUntil(send);
}

// One message with a picture under it.
export function discordFile(env, ctx, text, bytes, filename, type) {
  if (!env || !env.DISCORD_WEBHOOK) return;
  const form = new FormData();
  form.append('payload_json', JSON.stringify(Object.assign(message(text), { attachments: [{ id: 0, filename }] })));
  form.append('files[0]', new Blob([bytes], { type }), filename);
  const send = fetch(env.DISCORD_WEBHOOK, { method: 'POST', body: form }).then(failed, failed);
  if (ctx && ctx.waitUntil) ctx.waitUntil(send);
}

// (said in the Worker's log, for its owner: a message Discord did not take)
function failed(r) {
  if (r instanceof Response) {
    if (!r.ok) return r.text().then((t) => console.log('discord: ' + r.status + ' ' + t.slice(0, 300)), () => {});
    return;
  }
  console.log('discord: ' + (r && r.message || r));
}

function message(text) {
  return { username: 'World Builder server', content: String(text).slice(0, 1900), allowed_mentions: { parse: [] } };
}
