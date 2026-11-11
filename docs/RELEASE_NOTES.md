## MONK MODE — Discipline is a system.

Offline focus timer, distraction blocker and planner for **macOS, Windows and Android**.
No accounts, no cloud, no ads, no tracking.

### Download

| Device | File |
|---|---|
| Mac with Apple Silicon (M1–M4) | `MONK-MODE-<version>-macOS-AppleSilicon.dmg` |
| Mac with Intel | `MONK-MODE-<version>-macOS-Intel.dmg` |
| Windows 10/11 | `MONK-MODE-<version>-Windows-Setup.exe` (or `.msi`, or `-Portable.exe`) |
| Android 8+ | `MONK-MODE-<version>-Android.apk` |
| Chrome / Edge / Brave | `monk-mode-chromium-<version>.zip` |
| Firefox | `monk-mode-firefox-<version>.zip` |

Builds are **unsigned**: macOS asks you to confirm in System Settings → Privacy & Security →
**Open Anyway**; Windows SmartScreen needs **More info → Run anyway**; Android needs
"Install unknown apps". Step-by-step guides: `docs/INSTALLATION_MACOS.md`,
`docs/INSTALLATION_WINDOWS.md`, `docs/INSTALLATION_ANDROID.md`.

### New in 1.1.0

- **Mindful pause** — any blocklist can now add a breathing pause and an intention prompt
  instead of a hard block. Turn back, or continue for a few minutes. Works for websites (browser
  extension) and Android apps, and Analytics shows how often you turned back. The design follows
  a friction intervention that cut app opening by about 57% in a 2023 *PNAS* study.
- **Require the browser extension in strict commitments** (desktop, opt-in) — browsers whose
  MONK MODE extension is switched off or missing are closed during Strict and Maximum sessions.
- Android app completed: Plan, Insights, Settings and first-run screens; the live blocker now uses
  the same unit-tested resolver as the tests, which never shields system apps.
- Windows build verified by CI: compiled and unit-tested on Windows runners.

### Honest limits

Blocking on desktop is ordinary app closing; Android cannot filter websites in browsers; feeds
inside native apps can only be blocked by blocking the app. See `docs/PLATFORM_LIMITATIONS.md`.
