# Installing MONK MODE on Android

Requirements: Android 8.0 (API 26) or newer.

> Status: the APK is built and its unit tests pass, but it has **not yet been run on a real phone
> or emulator** (none was connected when it was built). Please report anything that differs from
> this guide.

## Which file

From the [latest release](https://github.com/saarukesh2005/monk-mode/releases/latest):

| File | Use it for |
|---|---|
| `MONK-MODE-<version>-Android.apk` | **Install this on your phone.** Debug-signed (package `app.monkmode.android.debug`); later releases install over it. |
| `MONK-MODE-<version>-Android-release-unsigned.apk` | Smaller, optimised build. Android refuses unsigned APKs; sign it first (BUILD_GUIDE.md). |
| `MONK-MODE-<version>-Android.aab` | App Bundle for Google Play (must be signed by you). |

## Install on your phone

**With a USB cable (recommended):**

1. On the phone: Settings → About phone → tap **Build number** seven times to enable Developer
   options. Then Settings → System → Developer options → turn on **USB debugging**.
2. Connect the phone, accept the "Allow USB debugging?" prompt.
3. On the Mac:
   ```bash
   ~/Library/Android/sdk/platform-tools/adb install -r MONK-MODE-v1.1.0-Android.apk
   ```

**Without a cable (easiest):** open the release page in the phone's browser, download the APK,
tap it, and allow "Install unknown apps" for your browser when Android asks.

## First run and permissions

MONK MODE explains every permission in plain words before opening the system screen. You decide
each one; nothing is turned on silently. All are optional — without them MONK MODE still works
as a timer and planner.

| Permission | Where Android asks | What it is for |
|---|---|---|
| Notifications | Pop-up (Android 13+) | Session-end alerts and the running timer. |
| Usage access | Settings → Usage access → MONK MODE | See which app is open (for blocking) and your own screen time. |
| Display over other apps | Settings → Display over other apps → MONK MODE | Show the block screen over a blocked app. Without it you only get a notification. |
| Unrestricted battery | Settings → Battery → MONK MODE → Unrestricted | Keeps Monk Guard alive on phones with aggressive battery savers. |

MONK MODE does **not** ask for internet access, accessibility services, device administrator,
contacts, location, camera or microphone.

On Xiaomi, Oppo, Vivo, Realme, OnePlus, Huawei and Samsung phones, also allow **Autostart** /
"Allow background activity" for MONK MODE in the phone's own battery or security app.

## Using it

- **Today** — focus so far, streak, week chart, intention, next tasks.
- **Focus** — choose a mode and length, start. A notification shows the live countdown.
- **Guard** — permissions checklist, lists of apps to block, quick block, schedules, strict mode,
  recently blocked apps. Tap **+ App** to pick from installed apps.
- **Plan** — tasks (with subtasks, priorities, due dates, repeats), daily plan and review, study
  subjects and topics with revision dates.
- **Insights** — focus statistics, measured screen time per app, blocked attempts, history.
- **Settings** (gear icon) — theme and accent, Pomodoro lengths, daily target, Monk Guard,
  encrypted backup and restore, delete data, capability report.

Lists set to **Mindful pause** show a breathing countdown and ask what you want to do; you can
go back or continue for a few minutes. When a hard-blocked app opens, the MONK MODE shield covers it. **Back to what matters** returns to the
home screen. **Allow 5 min** gives a short exception (not available during strict commitments).

## Moving data from the Mac or PC

Create an encrypted backup on the computer (Settings → Privacy & data), copy the `.monkbak` file
to the phone, then Settings → Backup & transfer → enter the same passphrase → **Restore**.
Website rules come along but only apply in desktop browsers.

## Update

Install the newer APK over the old one (`adb install -r …`). Data is kept. A debug build and a
release build are different apps (different package names) and do not share data — use a backup
to move between them.

## Uninstall

Settings → Apps → MONK MODE → Uninstall. This removes all of its data from the phone.
If you want to keep your history, create an encrypted backup first.
