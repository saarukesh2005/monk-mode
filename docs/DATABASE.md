# Database

- Engine: SQLite (bundled `rusqlite` on desktop, Android's built-in SQLite on Android).
- One schema for every platform: `packages/database/migrations/*.sql`. The desktop app embeds
  the files at compile time; the Android build copies them into the APK. The SQL is kept
  compatible with SQLite 3.22 (Android 8.0).
- Version tracking: `PRAGMA user_version` = number of migrations applied. Each migration runs in
  its own transaction.
- Connection settings: `foreign_keys = ON`, `journal_mode = WAL` (crash-safe writes),
  `synchronous = NORMAL`, 5-second busy timeout.
- IDs are random UUIDs (so backups from different devices never collide). Instants are
  milliseconds since 1970 (UTC); calendar dates are `YYYY-MM-DD` in local time.

## Tables

| Table | Purpose |
|---|---|
| `focus_sessions` | Every focus period and break with saved instants. |
| `timer_state` | At most one row (`singleton = 1`) pointing at the live session. |
| `categories`, `subjects`, `topics` | Labels, study subjects with weekly goals, topics with revision dates. |
| `tasks`, `tags`, `task_tags` | Tasks (with subtasks via `parent_id`), tags. |
| `events`, `daily_plans` | Calendar events (with recurrence) and daily plans / reviews. |
| `blocklists`, `block_rules` | Lists (`block` or `allow`; `mode` = `block` or `pause` with `pause_seconds`, `pause_allow_min`) and their rules (`app`, `domain`, `url_pattern`, `category`). |
| `schedules`, `quick_blocks`, `usage_limits`, `exceptions` | What switches lists on, daily limits, short allowances. |
| `strict_sessions`, `strict_session_lists`, `strict_events` | Commitments, the lists they lock, and their history. |
| `block_events` | Every block (app closed, site redirected, shield shown). |
| `pause_events` | Mindful-pause outcomes (`turned_back` / `continued`) with the stated intention. |
| `app_usage`, `web_usage` | Measured usage intervals. |
| `notifications` | Notification history. |
| `settings` | Preferences as JSON values. |
| `system_changes` | Ledger of hosts-file changes and their backup files. |

Foreign keys cascade where a child cannot exist without its parent (rules of a list, subtasks,
topics of a subject) and set to `NULL` where history should survive (a deleted category does not
delete sessions).

## Integrity and recovery

- Startup runs `PRAGMA integrity_check` and `PRAGMA foreign_key_check` and logs any problem.
  Settings → Privacy & data → **Check database integrity** runs them on demand.
- Restore and "Delete all data" first save a copy of the current database
  (`safety-snapshots/pre-change-<time>.sqlite`) using `VACUUM INTO`.
- A failed restore rolls back completely.

## Backup file format (`.monkbak`)

```
"MONKBAK1" (8 bytes) | header length (4 bytes, big-endian) | header (JSON) | ciphertext + 16-byte tag
header = {"magic":"MONKBAK1","kdf":"PBKDF2-HMAC-SHA256","iterations":600000,
          "salt":"<base64 16 bytes>","nonce":"<base64 12 bytes>","cipher":"AES-256-GCM"}
key    = PBKDF2-HMAC-SHA256(UTF-8 passphrase, salt, iterations) → 32 bytes
AAD    = the exact header bytes
```

The decrypted content is JSON: `{"format":"monk-mode-backup","formatVersion":1,"schemaVersion":…,
"exportedAt":…,"platform":…,"appVersion":…,"tables":{"<table>":[{<column>: <value>}]}}`.
Rust, Kotlin and an independent Node.js script (`scripts/make-backup-vector.mjs`) are tested
against the shared files in `packages/shared-core/vectors/`.

## Adding a migration

1. Add `packages/database/migrations/0002_<name>.sql` (never edit an existing one).
2. Add it to `MIGRATIONS` in `packages/database/src/index.ts` and `apps/desktop/src-tauri/src/db.rs`.
   Android picks up every `.sql` file in order automatically.
3. Run `npm test` and `cargo test --lib`.
