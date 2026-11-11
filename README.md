# MONK MODE

**Discipline is a system.**

A focus timer, distraction blocker and planner for **macOS, Windows and Android** — with no
accounts, no cloud, no subscriptions, no ads and no tracking. Everything stays on your device.

- **Focus engine** — Pomodoro, deep work, study, reading, custom and stopwatch sessions that stay
  exact through restarts and sleep.
- **Monk Guard** — closes distracting apps (desktop), shields them (Android), and blocks websites
  and short-video feeds like YouTube Shorts and Instagram Reels (browser extension).
- **Mindful pause** — instead of a hard block, a breathing pause and an intention prompt before a
  distracting site or app opens; Analytics shows how often you turned back.
- **Strict mode** — timed commitments with an always-available, deliberately slow emergency exit.
- **Planning** — tasks, daily plan and review, calendar, study planner with spaced revision.
- **Analytics** — real, local data only, every number labelled measured / recorded / no data.
- **Encrypted backups** that move between all three platforms.

## Download

**[⬇ Latest release](https://github.com/saarukesh2005/monk-mode/releases/latest)** — pick the file for your device:

| Device | File | Guide |
|---|---|---|
| Mac (M1–M4, Apple Silicon) | `MONK-MODE-v1.1.0-macOS-AppleSilicon.dmg` | [Install on macOS](docs/INSTALLATION_MACOS.md) |
| Mac (Intel) | `MONK-MODE-v1.1.0-macOS-Intel.dmg` | [Install on macOS](docs/INSTALLATION_MACOS.md) |
| Windows 10/11 | `MONK-MODE-v1.1.0-Windows-Setup.exe` · `.msi` · `-Portable.exe` | [Install on Windows](docs/INSTALLATION_WINDOWS.md) |
| Android 8+ | `MONK-MODE-v1.1.0-Android.apk` | [Install on Android](docs/INSTALLATION_ANDROID.md) |
| Chrome / Edge / Brave | `monk-mode-chromium-1.1.0.zip` | [Browser extension](docs/BLOCKING_GUIDE.md) |
| Firefox | `monk-mode-firefox-1.1.0.zip` | [Browser extension](docs/BLOCKING_GUIDE.md) |

Builds are unsigned (no certificates are included), so your system asks you to confirm the first
launch — the guides show how. Checksums are attached to the release (`SHA256SUMS-*.txt`).

## Run from source

```bash
npm install
npm run desktop:dev          # desktop app in development mode
npm run desktop:build        # installable desktop app for this OS
npm run extensions:build     # browser extensions
cd apps/android && ./gradlew assembleDebug   # Android APK (JDK 17 + Android SDK)
```

Tests: `npm test`, `npm run typecheck`, `npm run test:rust`, `cd apps/android && ./gradlew test`.
Full instructions: [docs/BUILD_GUIDE.md](docs/BUILD_GUIDE.md).

## Honest limits

No consumer app can make blocking unbreakable, and MONK MODE never pretends to. Desktop app
blocking is ordinary process termination; Android cannot filter websites in browsers; feeds inside
native apps can only be blocked by blocking the whole app. Read
[docs/PLATFORM_LIMITATIONS.md](docs/PLATFORM_LIMITATIONS.md) before relying on it.

## Documentation

[User guide](docs/USER_GUIDE.md) ·
[Focus engine](docs/FOCUS_ENGINE.md) ·
[Blocking](docs/BLOCKING_GUIDE.md) ·
[Strict mode](docs/STRICT_MODE.md) ·
[Privacy](docs/PRIVACY.md) ·
[Security](docs/SECURITY.md) ·
[Database](docs/DATABASE.md) ·
[Platform limitations](docs/PLATFORM_LIMITATIONS.md) ·
[Build guide](docs/BUILD_GUIDE.md) ·
[Test report](docs/TEST_REPORT.md) ·
[Known issues](docs/KNOWN_ISSUES.md) ·
[Feature status](docs/FEATURE_STATUS.md)

## Architecture

```
apps/desktop      Tauri 2 · React + TypeScript + Tailwind UI · Rust core (SQLite, focus/strict
                  engines, process monitor, hosts manager, encrypted backup, loopback bridge)
apps/android      Kotlin · Jetpack Compose · SQLite · foreground Monk Guard service
extensions/       Manifest V3 extension for Chromium and Firefox
packages/         shared types, core rules, analytics, validation, design tokens, SQL schema,
                  cross-language test vectors
```

One SQL schema, one backup format and one set of test vectors are shared by TypeScript, Rust and
Kotlin, so all platforms behave the same way.

## Licence

MIT — see [LICENSE](LICENSE).
