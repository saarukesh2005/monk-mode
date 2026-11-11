-- MONK MODE migration 0002: Mindful pause.
-- A blocklist can either hard-block (mode 'block') or add a deliberate pause before access
-- (mode 'pause'): a breathing countdown and an intention prompt, after which the user may go back
-- or continue for a short allowance. Lists enforced by a strict session always hard-block.
-- Based on the friction intervention evaluated in Grüning, Riedel & Lorenz-Spreen, PNAS 2023.

ALTER TABLE blocklists ADD COLUMN mode TEXT NOT NULL DEFAULT 'block' CHECK (mode IN ('block', 'pause'));
ALTER TABLE blocklists ADD COLUMN pause_seconds INTEGER NOT NULL DEFAULT 10 CHECK (pause_seconds BETWEEN 3 AND 60);
ALTER TABLE blocklists ADD COLUMN pause_allow_min INTEGER NOT NULL DEFAULT 5 CHECK (pause_allow_min BETWEEN 1 AND 30);

-- Outcome of each pause, for "turned back" statistics. 'continued' carries the stated intention.
CREATE TABLE pause_events (
  id         TEXT PRIMARY KEY NOT NULL,
  ts         INTEGER NOT NULL,
  platform   TEXT NOT NULL,
  target     TEXT NOT NULL,
  list_id    TEXT REFERENCES blocklists (id) ON DELETE SET NULL,
  outcome    TEXT NOT NULL CHECK (outcome IN ('turned_back', 'continued')),
  intention  TEXT NOT NULL DEFAULT '' CHECK (length(intention) <= 200)
);
CREATE INDEX ix_pause_events_ts ON pause_events (ts);
