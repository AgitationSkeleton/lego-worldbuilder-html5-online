# World Builder Online server

A Cloudflare Worker with a D1 (SQLite) database, holding the score tables: for each of the
84 missions, the fastest to its goal and to its bonus goal, and an overall table. The game
(`src/online/scores.js`) times each mission by its own clock and, if the player chooses,
sends the time here.

Its address is **https://wbserver.viosarcade.xyz** (`?server=URL` on the game's page points
it at another). **It is not deployed yet.** Until it is, the game keeps the player's best
times in the browser and says the server could not be reached.

## Deploying it (once)

You need the Cloudflare account that has the `viosarcade.xyz` zone, and Node.js 20 or newer.

```
cd server
npm install
npx wrangler login                       # opens the browser to sign in to Cloudflare
npx wrangler d1 create worldbuilder      # prints a database_id
```

Put that `database_id` into `wrangler.jsonc` in place of the zeros (if wrangler offers to
add it for you, it adds a second binding instead: keep the one called `DB`), then:

```
npm run db:init                          # makes the results table in the database
npx wrangler secret put ADMIN_KEY        # the NAME is ADMIN_KEY; it then asks for the password
npx wrangler secret put IP_SALT          # any long random text: rate limiting stores only a hash of the address with it
npx wrangler secret put DISCORD_WEBHOOK  # optional: a Discord channel's webhook, for the log below
npm run deploy
```

`deploy` makes the Worker and the address `wbserver.viosarcade.xyz` with its certificate (it
can take a few minutes the first time). Check it at https://wbserver.viosarcade.xyz/health,
which answers `{"ok":true,...}`. Later changes are `npm run deploy` again.

With `DISCORD_WEBHOOK` set, the server posts each new best time to that channel
(`src/discord.js`). The webhook is a secret, never in this repository. Without it nothing is
sent.

It fits Cloudflare's free plan: a result is one small row.

## The tables

- `POST /scores` with JSON `{mission: "6.3", kind: "goal" | "bonus", ms, name}`: a result.
  Answers `{ok, best, rank, of, improved}`.
- `GET /scores?mission=6.3`: the best 10 of each name for the goal and for the bonus
  (`&limit=` up to 50).
- `GET /scores/overall`: the best 50 players: missions with the goal reached, with the
  bonus, and their best goal times added up.

What the server checks: the mission exists (worlds 1–7, missions 1–12), the time is whole
milliseconds between 3 seconds and 6 hours, the name is 1–15 printable characters and not a
link (profanity is starred out, with CrystAlien Conflict's filter), and at most 60 results
an hour come from one address. A time is not otherwise proven: a determined player could
send a false one. Checking each mission's least possible time, and then replays (the game's
test mode replays a run's input to the same result), are next; until then the owner removes
junk by hand:

```
curl -H "Authorization: Bearer YOUR_ADMIN_KEY" "https://wbserver.viosarcade.xyz/admin?mission=6.3"
curl -X DELETE -H "Authorization: Bearer YOUR_ADMIN_KEY" https://wbserver.viosarcade.xyz/results/ID
```

## Running it locally

```
npm install
npm run db:init:local
npm run dev                              # http://127.0.0.1:8787
npm test                                 # the tables, against it
```

Open the game with `?server=http://127.0.0.1:8787` to use it; `tools/verify/scores.py` in
this repository plays the game's side through it (a mission timed, its goal and bonus sent,
the tables read back).

## Changing the address

Change `routes` in `wrangler.jsonc` and the default server in `src/online/scores.js`.
`ALLOWED_ORIGINS` lists the pages that may use it.
