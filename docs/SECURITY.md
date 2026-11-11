# Security

## Principles

- No accounts, no servers, no remote code. Nothing is downloaded or executed at run time.
- Least privilege: MONK MODE runs as a normal user. Administrator rights are only requested for
  one optional action (editing the hosts file), every time, through the operating system's own
  prompt.
- MONK MODE never disables, bypasses or changes antivirus, Windows Defender, Gatekeeper, SIP or
  other security features, and never hides itself.

## Desktop app (Tauri 2 + Rust)

| Area | Protection |
|---|---|
| Database access from the UI | Only through named commands. Table and column names come from a fixed allowlist in Rust (`repo.rs`); every value is a bound SQL parameter. Engine-owned tables (sessions, strict state, usage, events) are read-only from the UI. |
| Input validation | Validated in the UI (`packages/validation`) **and** again in Rust and by SQLite `CHECK` / foreign-key constraints. |
| Webview | Strict Content-Security-Policy (`default-src 'self'`; scripts only from the app bundle). The window has only core and notification permissions; file access goes through the app's own save/open dialogs. |
| Extension bridge | Binds to 127.0.0.1 only. All data endpoints need a 192-bit random pairing code, compared in constant time. CORS headers only for `chrome-extension://` / `moz-extension://` origins. Request bodies capped at 256 KB; all incoming data validated and size-limited. |
| Hosts file | Writes only a marked section. Backup before every change, verification after, ledger in the database. Paths with quotes are refused before calling the system prompt. |
| Process control | Only processes owned by the current user; a built-in list of system processes and MONK MODE itself are never terminated. |
| Backups | AES-256-GCM, PBKDF2-HMAC-SHA256 (600k), header authenticated as associated data, restore inside a single transaction with integrity and foreign-key checks; a failed restore changes nothing. A safety snapshot is taken first. |
| Logging | Logs contain no personal data (no titles, notes, URLs or app lists). |

## Android

- No `INTERNET` permission, no accessibility service, no device-admin, no `QUERY_ALL_PACKAGES`.
- Every special permission is explained before the system screen is opened; nothing is granted
  silently.
- `allowBackup=false` and data-extraction rules exclude all app data from cloud backup and
  device transfer.
- Exported components: only the launcher activity and the boot receiver (system broadcasts only).

## Browser extension

- Manifest V3, `script-src 'self'`, no remote code, no `eval`.
- Talks only to `http://127.0.0.1` on the configured port.
- Reads tab addresses, never page contents.

## Dependencies

- Rust dependencies are pinned in `Cargo.lock`; JavaScript in `package-lock.json`.
- Recommended checks before a release: `cargo audit` (install with `cargo install cargo-audit`)
  and `npm audit --omit=dev`. Neither is wired into CI yet.

## Reporting a problem

This is a local, offline application. If you find a security issue, open a private issue with
steps to reproduce. Do not include your database or backup files.
