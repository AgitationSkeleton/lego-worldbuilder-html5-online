-- The score tables (D1).  `npm run db:init` makes them on Cloudflare; `npm run db:init:local`
-- for `wrangler dev`.
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission TEXT NOT NULL,       -- "<world>.<mission>", worlds 1 to 7 as the merged game numbers them
  kind TEXT NOT NULL,          -- 'goal', or 'bonus' (the bonus goal, which opens after the goal)
  ms INTEGER NOT NULL,         -- the time from the mission's start, by the game's clock
  name TEXT NOT NULL,          -- as the player typed it, profanity starred out
  created INTEGER NOT NULL,    -- milliseconds since 1970
  ip_hash TEXT NOT NULL        -- for rate limiting; not the address itself
);
CREATE INDEX IF NOT EXISTS results_by_mission ON results (mission, kind, ms);
CREATE INDEX IF NOT EXISTS results_by_name ON results (name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS results_by_ip ON results (ip_hash, created);

-- The generated missions posted to the log (src/random.js): each code once.
CREATE TABLE IF NOT EXISTS random_posts (
  code TEXT PRIMARY KEY,       -- "2C-K2Q9" without its dash
  name TEXT NOT NULL,          -- who played it first, profanity starred out; empty if not given
  created INTEGER NOT NULL,    -- milliseconds since 1970
  ip_hash TEXT NOT NULL        -- for rate limiting; not the address itself
);
CREATE INDEX IF NOT EXISTS random_posts_by_ip ON random_posts (ip_hash, created);
