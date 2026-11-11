# Test report

Date: 11 November 2026 · Version 1.0.0 · Machine: MacBook Air M4, macOS 26.7.1

Only tests that were actually run are listed. Nothing here is estimated.

## Automated tests (all run locally on the Mac)

| Suite | Command | Result |
|---|---|---|
| Shared TypeScript packages, extension engine | `npx vitest run` | **120 passed**, 0 failed (8 files) |
| Typecheck: shared packages, desktop UI, extension | `npx tsc -p …` ×3 | **0 errors** |
| Desktop core (Rust) | `cargo test --lib` in `apps/desktop/src-tauri` | **45 passed**, 0 failed, 1 ignored (fixture generator) |
| Android core (Kotlin, JVM) | `./gradlew test` in `apps/android` | **16 passed**, 0 failed |

### What the automated tests cover

- **Cross-platform agreement:** the same JSON vectors in `packages/shared-core/vectors/` (schedule
  windows incl. overnight and all-day, URL decisions, domain clean-up, focus timing, break order,
  strict-mode policies) are checked by TypeScript, Rust and Kotlin.
- **Backups across platforms:** Rust and Kotlin both decrypt a backup produced by an independent
  Node.js implementation (`backup-v1.monkbak`); Rust and Kotlin both decrypt a backup produced by Rust
  (`backup-fixture.monkbak`); wrong passphrases and tampered files are rejected; PBKDF2 matches
  the RFC 7914 test vector.
- **Database:** schema applies on SQLite (Node's `node:sqlite` and rusqlite), integrity and
  foreign-key checks pass, only one live timer is possible, CHECK constraints reject bad data,
  cascades work, updating a list never deletes its rules, a failed restore leaves data untouched,
  device-only secrets are not exported.
- **Focus engine (Rust):** pause/resume, exact completion at the due time, catch-up after 3 hours
  of downtime without inventing focus, long break after the 4th round, interrupted vs completed,
  stopwatch cap, duplicate-session prevention, invalid input.
- **Strict mode:** every transition, cool-downs, reason length, typed phrase, pause rules, daily
  limit, tamper events, locked edits that still allow adding rules.
- **Blocking rules:** focus/schedule/quick-block/strict/limit triggers, allowlists, exceptions
  ignored in strict sessions, platform filtering, categories, system-process protection.
- **Hosts file:** our section is added/replaced/removed while every other byte (including CRLF
  line endings) is preserved.
- **Extension bridge:** input validation, exception cap, refusal during strict sessions,
  constant-time token check.
- **Analytics:** cross-midnight splitting, streaks, comparisons, heatmap ranges, CSV escaping
  (including formula injection); no completion rate is shown without data.
- **Design tokens:** every theme and accent meets WCAG AA contrast.

## Builds

| Artifact | Built on | Result |
|---|---|---|
| macOS `MONK MODE.app` + `MONK MODE_1.0.0_aarch64.dmg` | This Mac | Built, no warnings |
| Chromium + Firefox extension zips | This Mac | Built |
| Android debug APK, unsigned release APK (R8-minified), release AAB | This Mac | Built |
| Windows `.exe` / `.msi`, macOS Intel `.dmg` | GitHub Actions (`Desktop builds`) | **Not yet run** — workflow written, needs a push to GitHub |

## Manual checks done on the real macOS app

| Check | Result |
|---|---|
| App launches, creates its database and first-run data | Pass |
| Local bridge answers on 127.0.0.1:47613 | Pass |
| Bridge refuses requests without the pairing code (HTTP 401) | Pass |
| Bridge sends no CORS header to a normal web origin | Pass |
| Paired request receives the live block set (focus session active) | Pass |
| Posted block event is stored in the database | Pass (test row removed afterwards) |
| ⌘Q / "Quit" exits when no strict session is active | Pass (after a fix in this session) |
| Timer continuity: app quit and relaunched during a real 50-min session | Pass — remaining time was exact after relaunch |
| Built Android APK declares no INTERNET permission | Pass (`aapt2 dump permissions`) |

## Not tested yet (needs your hardware or accounts)

- **Windows:** nothing run by hand on a Windows PC. CI compiles and runs the Rust tests on
  `windows-latest` once the repository is pushed to GitHub.
- **Android:** not installed on a phone or emulator. Permission screens, the shield, the
  foreground service, boot restore and usage import have not been exercised on a device.
- **Browser extensions:** built and unit-tested, not yet loaded into a real browser.
- **macOS UI:** not visually inspected by the automated session (the terminal lacks Screen
  Recording permission). Strict sessions and hosts-file editing were not exercised in the real
  app (they would have interrupted your session or asked for your password).
- **Intel Mac:** no Intel machine available.
