# Blocking guide (Monk Guard)

## The idea

You make **lists**. A list switches on when something **triggers** it. While it is on, Monk Guard
blocks what is on it.

| Trigger | What switches the list on |
|---|---|
| Focus | A focus period is running and the list has "Block during focus" turned on. |
| Schedule | A recurring time window (Schedules page) is active. |
| Quick block | You pressed **Block now** for a set time. |
| Strict | A strict commitment includes the list. |
| Daily limit | You have used an app or site for your daily allowance today. |

**Allowlists** win over blocklists: anything on an enabled allowlist is never blocked.
**Temporary exceptions** ("allow for 5 minutes", up to 60 on desktop, 30 in the browser and on
Android) also win, except during a strict commitment.

## Rule types

| Type | Example | Where it works |
|---|---|---|
| Website | `reddit.com` — also blocks `old.reddit.com`, `www.reddit.com` | Browser extension; hosts file (optional) |
| URL pattern | `youtube.com/shorts*` — `*` matches anything | Browser extension only |
| Category | "Short-form feeds", "Social media", … | Browser extension (hosts file uses its domains) |
| App | `Discord` (macOS), `steam.exe` (Windows), `com.instagram.android` (Android) | Desktop app / Android app |

You can type a full address such as `https://www.Reddit.com/r/x`; it is cleaned to `reddit.com`.

## Short-video feeds

The built-in **Short-form feeds** category blocks only the feed pages, so the rest of each site
keeps working:

- `youtube.com/shorts*`, `m.youtube.com/shorts*`
- `instagram.com/reels*`, `instagram.com/reel/*`
- `facebook.com/reel*`, `facebook.com/watch*`
- `snapchat.com/spotlight*`
- all of `tiktok.com`

**Reddit feeds only** blocks the front page, Popular and All but keeps individual threads.

This works in browsers with the MONK MODE extension. The extension also catches in-page
navigation (for example tapping a Short from the YouTube home page), not only typed addresses.

Inside the native Instagram, YouTube or TikTok **apps**, nothing can remove just the feed —
there is no supported way to edit another app's screens. Block the whole app instead.

## Desktop: apps

- Every ~1.5 s Monk Guard lists running apps that belong to you and compares them with active rules.
- A blocked app is asked to quit. If it is still running 3 seconds later, it is closed.
- System processes (Finder, Dock, Explorer, …) and MONK MODE itself are never touched.
- Each block is recorded in History → Blocks, at most once per 30 seconds per app.

macOS rules match the app's name as shown in the Dock (e.g. `Discord`, `Slack`). Windows rules
match the program file name (e.g. `steam.exe`, `Discord.exe`). Use **Choose…** to pick from
running and installed apps.

## Desktop: websites (browser extension)

1. Build or download the extension (`artifacts/monk-mode-chromium-*.zip` or
   `monk-mode-firefox-*.zip`, or run `npm run extensions:build`).
2. **Chrome / Edge / Brave:** open `chrome://extensions` (or `edge://extensions`), turn on
   **Developer mode**, choose **Load unpacked** and select
   `extensions/browser-chromium/dist`.
   **Firefox:** open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → choose
   `extensions/browser-firefox/dist/manifest.json`. (Temporary add-ons are removed when Firefox
   closes; a permanent install needs the add-on to be signed by Mozilla, see BUILD_GUIDE.md.)
3. The extension's settings page opens. In MONK MODE go to **Settings → Blocker → Browser
   extension**, copy the pairing code and paste it there. Press **Save & test connection**.
4. Firefox only: press **Allow site access** — Firefox asks you to approve it.

How it talks to the app: only over `http://127.0.0.1:47613` on the same computer, with the pairing
code. Web pages cannot read the bridge (no CORS for web origins). Nothing goes to the internet.

If MONK MODE is closed, the extension keeps enforcing your **schedules** and any running
focus/strict session until its end time, using the last copy it received. Quick blocks and daily
limits need the app running.

Website time (active tab only, idle time excluded) is measured by the extension and shown in
Analytics. You can turn this off in the extension settings.

## Desktop: system-wide website blocking (hosts file) — optional

Off by default. When used, MONK MODE adds a clearly marked section to the hosts file:

```
# >>> MONK MODE BEGIN (managed by MONK MODE; remove via the app) >>>
0.0.0.0 reddit.com
:: reddit.com
0.0.0.0 www.reddit.com
...
# <<< MONK MODE END <<<
```

- Your operating system asks for an administrator password **every time** (macOS password
  dialog, Windows UAC prompt). MONK MODE does not keep administrator rights.
- Before every change it saves a copy of the old file in the app's data folder (`hosts-backups/`)
  and records the change in its database.
- It only ever adds or removes its own section; every other line stays exactly as it was.
- Works per domain only (no URL patterns). Browsers using secure DNS (DNS-over-HTTPS) may skip it.
- Apply it manually from Blocker → System-wide blocking, or tick "Use automatically in strict
  sessions" so it is added when a Strict or Maximum session starts and removed when it ends.

To remove it by hand: open the hosts file as administrator (`/etc/hosts` on macOS,
`C:\Windows\System32\drivers\etc\hosts` on Windows), delete the lines from `>>> MONK MODE BEGIN`
to `<<< MONK MODE END <<<`, save.

## Android

Android blocks **apps**, not websites. See INSTALLATION_ANDROID.md for the permissions and
PLATFORM_LIMITATIONS.md for exactly what is and is not possible.

## Schedules

- Pick days, a start time and an end time.
- An end time earlier than the start runs overnight (e.g. 22:30–06:30; the early-morning part
  belongs to the day it started).
- The same start and end time means all day.
- A **strict schedule** refuses temporary exceptions while it is active and cannot be edited or
  deleted while a strict commitment is running.

## Daily limits

Blocker → Daily limits: for example "Slack, 30 minutes a day". Once the measured time on this
device reaches the limit, the app or site is blocked until midnight. Measured time comes from the
desktop app (apps, while it runs), the extension (sites) or Android usage statistics (apps).
