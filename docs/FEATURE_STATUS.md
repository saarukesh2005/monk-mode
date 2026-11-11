# Feature status

Version 1.1.0 · 11 November 2026.

**Status words:** **Done** = implemented and covered by automated tests or a real-app check.
**Built** = implemented and compiles, but not yet exercised on that platform's real device.
**Partial** = some of the feature exists (details given). **Not done** = missing.
A screen existing is never counted as "Done" on its own.

## Platforms

| Platform | Status |
|---|---|
| macOS app (Apple Silicon) | **Done** — built `.app`/`.dmg`, launched, bridge and quit behaviour checked, running your real session |
| macOS app (Intel) | **Built** on GitHub's macOS runners; not yet run on an Intel Mac |
| Windows app | **Built** — compiled, unit-tested and packaged (.exe, .msi, portable) on GitHub's Windows runners; not yet run by hand on a PC |
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
| Mindful pause (breathing pause + intention, outcome stats) | Built (extension) | Built | Desktop apps cannot be paused; unit-tested in TS, Rust, Kotlin |
| Require extension during strict sessions | Built | — | Opt-in; unit-tested decision logic |
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
| Complete Windows application exists | Yes — built and unit-tested on Windows by CI; not yet run by hand |
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
| Automated tests pass where executable | Yes — 123 TS, 48 Rust, 17 Kotlin (local); TS + Rust on macOS and Windows in CI |
| Installable artifacts | GitHub Release: macOS (Apple Silicon + Intel) dmg, Windows exe/msi/portable, Android APK, extension zips |
| CI workflows | Yes — CI and Desktop builds passed on GitHub |
| Documentation | Yes — `docs/` |
| Known limitations documented | Yes — PLATFORM_LIMITATIONS.md, KNOWN_ISSUES.md |
