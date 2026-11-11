# Privacy

**Short version:** MONK MODE has no accounts, no servers, no analytics, no ads and no tracking.
Everything stays on your device.

## What MONK MODE stores

All of it is stored in one SQLite file on your device:

- focus sessions, notes, categories, subjects and study topics;
- tasks, calendar events and daily plans;
- your blocklists, schedules, limits and strict-mode history;
- which apps you used and for how long (desktop: while MONK MODE runs; Android: from the
  system's usage statistics, after you grant Usage access);
- which websites you spent time on (only if you install and pair the browser extension; active
  tab only; you can turn this off in the extension settings);
- a log of what was blocked;
- your settings.

It does **not** store page contents, keystrokes, screenshots, messages or anything typed into
other apps. The browser extension reads only the address (URL) of the active tab.

| Platform | Database location |
|---|---|
| macOS | `~/Library/Application Support/app.monkmode.desktop/monk-mode.sqlite` |
| Windows | `%APPDATA%\app.monkmode.desktop\monk-mode.sqlite` |
| Android | App-private storage (`/data/data/app.monkmode.android/databases/`), not readable by other apps |

## Network

- The desktop app and the Android app make **no internet connections**. The Android app does
  not even request the internet permission.
- The desktop app listens on `127.0.0.1:47613` (your own computer only) so the browser extension
  can fetch your rules. Other computers cannot reach it. Requests need a random pairing code
  generated on your device, and ordinary web pages are not allowed to read the responses.
- Android cloud backup and device-to-device transfer are switched off for MONK MODE's data.

## Moving data between devices

There is no sync. Use **Settings → Privacy & data → Create encrypted backup** and restore the
file on the other device (macOS, Windows and Android can all read each other's backups).

- Encryption: AES-256-GCM. The key is derived from your passphrase with PBKDF2-HMAC-SHA256,
  600,000 rounds, random salt.
- **Your passphrase is the key.** It is never saved, not in the backup file and not in the app.
  Keep it in a password manager. If you lose it, nobody can open the backup — including us.
- Treat backup files like a diary: anyone with the file *and* the passphrase can read it.
- These device-only settings never travel in a backup: the extension pairing code, hosts-file
  consent, start-at-login and Android guard settings.

## Exports

Analytics → CSV / JSON export writes unencrypted files to a place you choose. Keep them private.
CSV cells starting with `=`, `+`, `-` or `@` are escaped so spreadsheets do not run them as
formulas.

## Deleting your data

- **Settings → Privacy & data → Delete all data** removes everything. A safety copy is kept in
  the app folder (`safety-snapshots/`) in case you change your mind; delete that folder to remove
  it permanently.
- Uninstalling the desktop app does not remove the data folder above; delete it by hand.
  Uninstalling the Android app removes its data.
