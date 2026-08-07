-- Cloudflare D1: one row per signed-in user holding the sync blob
-- (tickets, budget, jackpots, alerts, theme). Spend/won stay derived
-- from tickets + draw results on the client — same as today.
CREATE TABLE IF NOT EXISTS user_state (
  user_sub TEXT PRIMARY KEY NOT NULL,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
