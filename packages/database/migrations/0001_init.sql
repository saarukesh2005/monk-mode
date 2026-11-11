-- MONK MODE canonical schema, migration 0001.
-- Shared verbatim by the desktop app (Rust/rusqlite) and the Android app (SQLiteOpenHelper).
-- Keep SQL compatible with SQLite 3.22 (Android API 26): no UPSERT, no RETURNING, no STRICT tables.
-- Conventions: TEXT UUID primary keys (portable across devices for backup/restore),
-- INTEGER epoch milliseconds for instants, TEXT 'YYYY-MM-DD' for local calendar dates.

CREATE TABLE categories (
  id          TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  color       TEXT NOT NULL DEFAULT '#8A8F98',
  kind        TEXT NOT NULL CHECK (kind IN ('session', 'task', 'block')),
  created_at  INTEGER NOT NULL
);

CREATE TABLE subjects (
  id               TEXT PRIMARY KEY NOT NULL,
  name             TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  color            TEXT NOT NULL DEFAULT '#8A8F98',
  weekly_goal_min  INTEGER NOT NULL DEFAULT 0 CHECK (weekly_goal_min >= 0),
  archived         INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE topics (
  id             TEXT PRIMARY KEY NOT NULL,
  subject_id     TEXT NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  title          TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  status         TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'learning', 'done')),
  last_reviewed  TEXT,
  next_review    TEXT,
  review_count   INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX ix_topics_subject ON topics (subject_id);
CREATE INDEX ix_topics_next_review ON topics (next_review);

CREATE TABLE tasks (
  id            TEXT PRIMARY KEY NOT NULL,
  parent_id     TEXT REFERENCES tasks (id) ON DELETE CASCADE,
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  notes         TEXT NOT NULL DEFAULT '',
  priority      INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  status        TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'done')),
  due_date      TEXT,
  recurrence    TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekdays', 'weekly', 'monthly')),
  category_id   TEXT REFERENCES categories (id) ON DELETE SET NULL,
  subject_id    TEXT REFERENCES subjects (id) ON DELETE SET NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  completed_at  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX ix_tasks_parent ON tasks (parent_id);
CREATE INDEX ix_tasks_due ON tasks (due_date);
CREATE INDEX ix_tasks_status ON tasks (status);

CREATE TABLE tags (
  id    TEXT PRIMARY KEY NOT NULL,
  name  TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 40)
);

CREATE TABLE task_tags (
  task_id  TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

-- Every focus or break phase is one row. Instants are authoritative; the UI derives remaining time from them.
CREATE TABLE focus_sessions (
  id               TEXT PRIMARY KEY NOT NULL,
  mode             TEXT NOT NULL CHECK (mode IN ('pomodoro', 'stopwatch', 'custom', 'deep_work', 'study', 'reading', 'break')),
  phase            TEXT NOT NULL CHECK (phase IN ('focus', 'short_break', 'long_break')),
  status           TEXT NOT NULL CHECK (status IN ('running', 'paused', 'completed', 'interrupted', 'skipped')),
  planned_ms       INTEGER CHECK (planned_ms IS NULL OR planned_ms > 0),
  started_at       INTEGER NOT NULL,
  paused_at        INTEGER,
  paused_total_ms  INTEGER NOT NULL DEFAULT 0 CHECK (paused_total_ms >= 0),
  ended_at         INTEGER,
  focused_ms       INTEGER NOT NULL DEFAULT 0 CHECK (focused_ms >= 0),
  cycle_index      INTEGER NOT NULL DEFAULT 0,
  category_id      TEXT REFERENCES categories (id) ON DELETE SET NULL,
  subject_id       TEXT REFERENCES subjects (id) ON DELETE SET NULL,
  task_id          TEXT REFERENCES tasks (id) ON DELETE SET NULL,
  note             TEXT NOT NULL DEFAULT '',
  strict           INTEGER NOT NULL DEFAULT 0 CHECK (strict IN (0, 1)),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX ix_sessions_started ON focus_sessions (started_at);
CREATE INDEX ix_sessions_status ON focus_sessions (status);

-- Singleton row: at most one live timer can exist. Prevents duplicate active sessions structurally.
CREATE TABLE timer_state (
  singleton    INTEGER PRIMARY KEY CHECK (singleton = 1),
  session_id   TEXT NOT NULL REFERENCES focus_sessions (id) ON DELETE CASCADE,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE blocklists (
  id                 TEXT PRIMARY KEY NOT NULL,
  name               TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  kind               TEXT NOT NULL DEFAULT 'block' CHECK (kind IN ('block', 'allow')),
  enabled            INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  block_during_focus INTEGER NOT NULL DEFAULT 1 CHECK (block_during_focus IN (0, 1)),
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE block_rules (
  id          TEXT PRIMARY KEY NOT NULL,
  list_id     TEXT NOT NULL REFERENCES blocklists (id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('app', 'domain', 'url_pattern', 'category')),
  value       TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 500),
  label       TEXT NOT NULL DEFAULT '',
  platform    TEXT NOT NULL DEFAULT 'all' CHECK (platform IN ('all', 'macos', 'windows', 'android')),
  created_at  INTEGER NOT NULL,
  UNIQUE (list_id, type, value, platform)
);
CREATE INDEX ix_rules_list ON block_rules (list_id);

-- Recurring restriction windows. days_mask bit 0 = Monday ... bit 6 = Sunday.
-- start_minute > end_minute means the window wraps past midnight; equal means all day.
CREATE TABLE schedules (
  id            TEXT PRIMARY KEY NOT NULL,
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  list_id       TEXT NOT NULL REFERENCES blocklists (id) ON DELETE CASCADE,
  days_mask     INTEGER NOT NULL CHECK (days_mask BETWEEN 1 AND 127),
  start_minute  INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute    INTEGER NOT NULL CHECK (end_minute BETWEEN 0 AND 1439),
  strict        INTEGER NOT NULL DEFAULT 0 CHECK (strict IN (0, 1)),
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Manual "block now for N minutes" windows.
CREATE TABLE quick_blocks (
  id          TEXT PRIMARY KEY NOT NULL,
  list_id     TEXT NOT NULL REFERENCES blocklists (id) ON DELETE CASCADE,
  started_at  INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL,
  ended_at    INTEGER,
  CHECK (ends_at > started_at)
);

CREATE TABLE usage_limits (
  id               TEXT PRIMARY KEY NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('app', 'domain')),
  value            TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 500),
  label            TEXT NOT NULL DEFAULT '',
  minutes_per_day  INTEGER NOT NULL CHECK (minutes_per_day BETWEEN 1 AND 1440),
  platform         TEXT NOT NULL DEFAULT 'all' CHECK (platform IN ('all', 'macos', 'windows', 'android')),
  enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at       INTEGER NOT NULL
);

-- Short-lived allowances ("let me use this for 5 minutes"). Never granted during strict sessions.
CREATE TABLE exceptions (
  id          TEXT PRIMARY KEY NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('app', 'domain')),
  value       TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  until_at    INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX ix_exceptions_until ON exceptions (until_at);

CREATE TABLE strict_sessions (
  id           TEXT PRIMARY KEY NOT NULL,
  level        TEXT NOT NULL CHECK (level IN ('normal', 'strict', 'maximum')),
  state        TEXT NOT NULL CHECK (state IN ('PREPARING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'EMERGENCY_EXIT')),
  started_at   INTEGER NOT NULL,
  ends_at      INTEGER NOT NULL,
  paused_at    INTEGER,
  ended_at     INTEGER,
  exit_reason  TEXT NOT NULL DEFAULT '',
  exit_requested_at INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  CHECK (ends_at > started_at)
);
CREATE INDEX ix_strict_state ON strict_sessions (state);

CREATE TABLE strict_session_lists (
  session_id  TEXT NOT NULL REFERENCES strict_sessions (id) ON DELETE CASCADE,
  list_id     TEXT NOT NULL REFERENCES blocklists (id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, list_id)
);

CREATE TABLE strict_events (
  id          TEXT PRIMARY KEY NOT NULL,
  session_id  TEXT REFERENCES strict_sessions (id) ON DELETE SET NULL,
  ts          INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX ix_strict_events_ts ON strict_events (ts);

CREATE TABLE block_events (
  id        TEXT PRIMARY KEY NOT NULL,
  ts        INTEGER NOT NULL,
  platform  TEXT NOT NULL,
  source    TEXT NOT NULL CHECK (source IN ('app', 'web', 'hosts')),
  target    TEXT NOT NULL,
  list_id   TEXT REFERENCES blocklists (id) ON DELETE SET NULL,
  action    TEXT NOT NULL,
  trigger   TEXT NOT NULL CHECK (trigger IN ('focus', 'schedule', 'strict', 'manual', 'limit'))
);
CREATE INDEX ix_block_events_ts ON block_events (ts);

-- Measured foreground-application intervals (desktop foreground sampler, Android UsageStats).
CREATE TABLE app_usage (
  id           TEXT PRIMARY KEY NOT NULL,
  app_id       TEXT NOT NULL,
  app_name     TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL CHECK (duration_ms >= 0),
  platform     TEXT NOT NULL,
  source       TEXT NOT NULL,
  CHECK (ended_at >= started_at)
);
CREATE INDEX ix_app_usage_started ON app_usage (started_at);
CREATE INDEX ix_app_usage_app ON app_usage (app_id);

-- Measured active-tab time reported by the browser extension.
CREATE TABLE web_usage (
  id           TEXT PRIMARY KEY NOT NULL,
  domain       TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL CHECK (duration_ms >= 0),
  browser      TEXT NOT NULL DEFAULT '',
  CHECK (ended_at >= started_at)
);
CREATE INDEX ix_web_usage_started ON web_usage (started_at);

CREATE TABLE events (
  id          TEXT PRIMARY KEY NOT NULL,
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  kind        TEXT NOT NULL DEFAULT 'event' CHECK (kind IN ('event', 'focus_block', 'study')),
  start_at    INTEGER NOT NULL,
  end_at      INTEGER NOT NULL,
  all_day     INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  recurrence  TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekdays', 'weekly', 'monthly')),
  subject_id  TEXT REFERENCES subjects (id) ON DELETE SET NULL,
  notes       TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  CHECK (end_at >= start_at)
);
CREATE INDEX ix_events_start ON events (start_at);

CREATE TABLE daily_plans (
  date              TEXT PRIMARY KEY NOT NULL,
  intention         TEXT NOT NULL DEFAULT '',
  priorities        TEXT NOT NULL DEFAULT '[]',
  focus_target_min  INTEGER NOT NULL DEFAULT 0 CHECK (focus_target_min >= 0),
  review            TEXT NOT NULL DEFAULT '',
  mood              INTEGER CHECK (mood IS NULL OR mood BETWEEN 1 AND 5),
  reviewed_at       INTEGER,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE notifications (
  id     TEXT PRIMARY KEY NOT NULL,
  ts     INTEGER NOT NULL,
  kind   TEXT NOT NULL,
  title  TEXT NOT NULL,
  body   TEXT NOT NULL DEFAULT '',
  read   INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1))
);
CREATE INDEX ix_notifications_ts ON notifications (ts);

-- Preferences and custom themes, stored as JSON values.
CREATE TABLE settings (
  key         TEXT PRIMARY KEY NOT NULL,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Ledger of system changes made by the app (hosts file edits) so only our own changes are reverted.
CREATE TABLE system_changes (
  id           TEXT PRIMARY KEY NOT NULL,
  kind         TEXT NOT NULL,
  target       TEXT NOT NULL,
  backup_path  TEXT NOT NULL DEFAULT '',
  applied_at   INTEGER NOT NULL,
  reverted_at  INTEGER
);
