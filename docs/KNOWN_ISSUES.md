# Known issues

Last updated: 10 November 2026, version 1.0.0.

## All platforms

- **Builds are unsigned.** macOS shows "cannot be opened because the developer cannot be
  verified"; Windows SmartScreen shows "Windows protected your PC". See the installation guides
  for how to open them anyway, and BUILD_GUIDE.md for signing.
- **Interface language** is English only. Text is not yet extracted into translation files.

## macOS

- A blocked app may be visible for up to ~1.5 s before Monk Guard closes it.
- Phase-end notifications only appear while MONK MODE (or its menu-bar icon) is running. If the
  app is fully quit, the timer still finishes at the right moment and is recorded the next time
  it starts, but no notification is shown at that moment.
- Apple Silicon build only from local builds; the Intel (x86_64) build is produced by GitHub
  Actions and has not been tested on an Intel Mac.
- Safari is not covered by the website extension.

## Windows

- Not yet tested by hand on a real Windows PC (only compiled and unit-tested in CI).
- Apps started "as administrator" cannot be closed by Monk Guard.
- Some antivirus software warns when the hosts file is changed.

## Browser extension

- Firefox: loading from `about:debugging` is temporary and removed when Firefox closes. A
  permanent install needs a Mozilla-signed build.
- Chromium "Load unpacked" shows a "Developer mode" reminder. Publishing to the Chrome Web Store
  removes it.
- If a URL-pattern page is opened by a single-page app without a navigation event the extension
  can see, blocking happens on the next navigation.

## Android

- Website blocking is not possible in Android browsers (see PLATFORM_LIMITATIONS.md).
- A blocked app can be visible for up to about one second before the shield appears.
- Aggressive battery savers can delay shields and notifications.
