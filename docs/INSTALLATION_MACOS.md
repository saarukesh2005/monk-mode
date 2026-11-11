# Installing MONK MODE on macOS

Requirements: macOS 11 Big Sur or newer. Apple Silicon (M1–M4) build is produced locally;
an Intel build is produced by GitHub Actions (`Desktop builds` workflow).

## Install

1. Download from the [latest release](https://github.com/saarukesh2005/monk-mode/releases/latest):
   `…-macOS-AppleSilicon.dmg` for M1–M4 Macs (Apple menu → About This Mac → "Chip: Apple"),
   or `…-macOS-Intel.dmg` for Intel Macs. Open it.
2. Drag **MONK MODE** onto **Applications**.
3. Eject the disk image.

### First launch (unsigned build)

The build is not signed with an Apple Developer ID, so macOS blocks the first launch:

1. Open **Applications**, **right-click** MONK MODE → **Open** → **Open**.
   On macOS 15 and newer: try to open it once, then go to **System Settings → Privacy & Security**,
   scroll down and press **Open Anyway**.
2. You only need to do this once.

## Permissions

| Permission | When it is asked | Why |
|---|---|---|
| Notifications | First notification | Session-end and block notifications. |
| Administrator password | Only if you use system-wide (hosts file) blocking | To edit `/etc/hosts`. Asked every time. |

No Accessibility, Screen Recording or Full Disk Access permission is needed.

## Browser extension

See BLOCKING_GUIDE.md → "Desktop: websites (browser extension)".

## Start at login

Settings → General → **Open at login**. MONK MODE starts hidden in the menu bar. You can also
remove it in System Settings → General → Login Items.

## Update

Quit MONK MODE (menu-bar icon → Quit), install the new version over the old one. Your data is
kept (it lives in `~/Library/Application Support/app.monkmode.desktop/`).

## Uninstall

1. Quit MONK MODE. If hosts-file blocking is active, first press Blocker → System-wide blocking →
   **Remove**.
2. Drag `/Applications/MONK MODE.app` to the Bin.
3. Optional — delete your data: `~/Library/Application Support/app.monkmode.desktop/`
   and logs in `~/Library/Logs/app.monkmode.desktop/`.
4. If you enabled start at login, remove it in System Settings → General → Login Items.

## Run from source

```bash
npm install
npm run desktop:dev        # development window with hot reload
npm run desktop:build      # .app and .dmg in apps/desktop/src-tauri/target/release/bundle/
```
