# Installing MONK MODE on Windows 10 / 11

> Status: the Windows build is compiled and unit-tested on GitHub's Windows runners. It has not
> yet been tested by hand on a real PC. Please report anything that behaves differently from
> this guide.

## Get the installer

Choose one:

- **GitHub Actions:** run the *Desktop builds* workflow (Actions tab → Desktop builds → Run
  workflow). Download the `monk-mode-x86_64-pc-windows-msvc` artifact. It contains:
  - `MONK MODE_1.0.0_x64-setup.exe` — installer for your user account (no admin needed),
  - `MONK MODE_1.0.0_x64_en-US.msi` — MSI installer,
  - `MONK MODE portable.exe` — runs without installing (needs the WebView2 runtime, which is
    built into Windows 11 and current Windows 10).
- **Build it yourself on the PC** — see BUILD_GUIDE.md → Windows.

## Install

1. Run `MONK MODE_1.0.0_x64-setup.exe`.
2. The build is unsigned, so SmartScreen may say *"Windows protected your PC"*. Click
   **More info → Run anyway**.
3. Follow the installer. MONK MODE installs for your user only and does not need administrator
   rights.

## Permissions

| Permission | When | Why |
|---|---|---|
| Notifications | Automatic | Session-end and block notifications (Settings → System → Notifications). |
| Administrator (UAC) | Only for system-wide hosts-file blocking | To edit `C:\Windows\System32\drivers\etc\hosts`. Asked every time. |

Some antivirus programs show a warning when the hosts file changes. That is expected when you
choose hosts-file blocking. MONK MODE never disables or changes your antivirus.

## Browser extension

See BLOCKING_GUIDE.md. On Windows rules for apps use the program file name, e.g. `steam.exe`.

## Start at login

Settings → General → **Open at login**. You can also manage it in Task Manager → Startup apps.

## Update

Quit MONK MODE (tray icon → Quit) and run the new installer. Your data is kept in
`%APPDATA%\app.monkmode.desktop\`.

## Uninstall

1. If hosts-file blocking is active, press Blocker → System-wide blocking → **Remove** first.
2. Settings → Apps → Installed apps → MONK MODE → Uninstall.
3. Optional — delete your data folder `%APPDATA%\app.monkmode.desktop\` and logs in
   `%LOCALAPPDATA%\app.monkmode.desktop\logs\`.
