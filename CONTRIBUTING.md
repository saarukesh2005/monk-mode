# Contributing to MONK MODE

## Ground rules

- **Local only.** No network calls, accounts, telemetry or third-party analytics. A change that
  needs the internet will not be accepted.
- **Honest enforcement.** Never describe a block as stronger than it is. Update
  `packages/shared-core/src/capabilities.ts` and docs/PLATFORM_LIMITATIONS.md when a capability
  changes.
- **No unsafe system changes.** Never disable security software, install drivers, or change
  system files without explicit, per-change user consent and a way back.

## Shared behaviour first

Logic that exists on several platforms (schedules, URL matching, timer maths, strict policies,
backup format) has test vectors in `packages/shared-core/vectors/`. When you change behaviour:

1. Update the vector JSON.
2. Update TypeScript (`packages/shared-core`), Rust (`apps/desktop/src-tauri`) and Kotlin
   (`apps/android/core`).
3. Run all three test suites.

## Checks before a pull request

```bash
npm run typecheck
npm test
npm run test:rust
(cd apps/android && ./gradlew test assembleDebug)
```

CI (`.github/workflows/`) runs the same checks on macOS, Windows and Linux.

## Style

- TypeScript: strict mode, no `any`, immutable updates, small focused components.
- Rust: `cargo fmt`, no `unwrap()` outside tests, user-facing error messages.
- Kotlin: official style, no `!!` in new code, database work off the main thread.
- Commits: `type: description` (feat, fix, refactor, docs, test, chore, perf, ci).

## Database changes

Never edit an existing migration. Add `packages/database/migrations/000N_name.sql` and register it
(see docs/DATABASE.md).
