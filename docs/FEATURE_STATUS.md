# Feature status

Version 1.0.0 · 11 November 2026.

**Status words:** **Done** = implemented and covered by automated tests or a real-app check.
**Built** = implemented and compiles, but not yet exercised on that platform's real device.
**Partial** = some of the feature exists (details given). **Not done** = missing.
A screen existing is never counted as "Done" on its own.

## Platforms

| Platform | Status |
|---|---|
| macOS app (Apple Silicon) | **Done** — built `.app`/`.dmg`, launched, bridge and quit behaviour checked, running your real session |
| macOS app (Intel) | **Built** in CI workflow only (not yet run) |
| Windows app | **Code complete, not yet compiled** — the CI workflow builds and tests it on Windows once the repository is on GitHub, or build it on the PC (BUILD_GUIDE.md) |
| Android app | **Built** — debug/release APK and AAB; not yet run on a device |
| Chromium / Firefox extension | **Built** — packaged and unit-tested; not yet loaded in a browser |

## Features

| Feature | macOS / Windows | Android | Notes |
|---|---|---|---|
| Focus modes (Pomodoro, deep work, study, reading, custom, stopwatch, break) | Done | Built | |
| Start / pause / resume / end / reset / skip break | Done | Built | |
| Preset and custom durations | Done | Built | |
| Short / long breaks, auto transitions | Done | Built | Same engine logic, Rust tests |
| Restart / sleep recovery, no duplicate sessions | Done | Built | Verified with a real session on macOS |
| Session categories, notes, subject, task link | Done | Partial | Android: subject + intention only |
| Daily / weekly targets, streaks, completion rate | Done | Built | |
| Notifications | Done | Built | |
| App blocking | Done | Built | Desktop closes apps; Android shows a shield |
| Website / URL-pattern / category blocking | Done (extension) | Not possible | See PLATFORM_LIMITATIONS.md |
| Short-feed blocking (Shorts, Reels, TikTok) in browsers | Done (extension) | Not possible | App-level blocking offered instead |
| Blocklists, allowlists, categories | Done | Built | Android: app rules only |
| Schedules (recurring, overnight, strict) | Done | Built | |
| Quick block | Done | Built | |
| Daily usage limits | Done | Partial | Android enforces limits but has no screen to create them yet (restore from desktop backup) |
| Temporary exceptions | Done | Built | Android: "Allow 5 min" on the shield |
| Strict mode (3 levels, cool-down, phrase, tamper log, daily limit) | Done | Built | |
| Hosts-file system-wide blocking | Built | — | Needs your admin password; not exercised in the real app |
| Screen Time / FamilyControls | Not done | — | Needs Apple entitlement |
| Capability status shown in app | Done | Done | |
| Permission onboarding | Done | Built | |
| Tasks (subtasks, priority, due, repeat, tags, categories, search, filters) | Done | Partial | Android: no tags, categories or search |
| Study planner (subjects, goals, topics, revision) | Done | Built | |
| Calendar (day / week / month, recurring events) | Done | Not done | Desktop only |
| Daily planner + end-of-day review | Done | Built | |
| Analytics (focus, screen time, websites, hour-of-day, weekdays, heatmap, trends) | Done | Partial | Android: focus stats, week chart, screen time, blocks |
| CSV / JSON export | Done | Not done | Android uses the encrypted backup |
| Measured vs recorded vs unavailable labels | Done | Done | |
| Themes (5 palettes, 6 accents, type, size, widgets) | Done | Partial | Android: system/dark/light + accents |
| Sounds | Done | Not done | Android uses system notification sound |
| Start at login / after reboot | Done | Built | |
| Encrypted backup / restore (cross-platform) | Done | Built | Format verified across Rust, Kotlin, Node |
| Delete local data | Done | Built | |
| Database integrity check | Done | Not done | Android: runs foreign-key check on restore only |
| Keyboard shortcuts | Done | — | |
| Language-ready architecture | Partial | Partial | English only; strings not yet in resource files |

## Acceptance checklist

| Requirement | Status |
|---|---|
| Complete macOS application exists | Yes |
| Complete Windows application exists | Code complete; installer produced by CI, not yet run |
| Complete Android application exists | Yes (built), see partial items above; not yet run on a device |
| Consistent identity | Yes — same logo, palette, names |
| Local databases work | Yes (desktop verified; Android built) |
| Focus engine works / survives restarts | Yes (tests + real-session check on macOS) |
| Task manager, study planner, scheduling work | Desktop yes; Android built |
| Analytics use real data only | Yes |
| Blocking engines have actual implementations | Yes |
| Permission onboarding | Yes |
| Strict mode within limits | Yes |
| Browser extensions built | Yes |
| Backup and restore | Yes |
| No cloud or login dependency | Yes |
| Automated tests pass where executable | Yes — 120 TS, 45 Rust, 16 Kotlin |
| Installable artifacts | macOS dmg, Android APK/AAB, extension zips; Windows via CI |
| CI workflows | Yes — `.github/workflows/` (not yet run: repository not on GitHub) |
| Documentation | Yes — `docs/` |
| Known limitations documented | Yes — PLATFORM_LIMITATIONS.md, KNOWN_ISSUES.md |
