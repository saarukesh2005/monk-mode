# Platform capabilities and limitations

MONK MODE always tells you how strong a block really is. The same list is shown inside the app
(Settings → About → Platform capability report, and at the bottom of the Blocker page). The
source is `packages/shared-core/src/capabilities.ts`.

Status meanings:

| Status | Meaning |
|---|---|
| SUPPORTED | Works in this build with no extra steps. |
| REQUIRES_PERMISSION | Works after you grant a permission the operating system asks you about. |
| REQUIRES_ENTITLEMENT | Needs special approval from the platform owner (for example Apple). Not in this build. |
| EXPERIMENTAL | Works but has not been tested widely. |
| UNSUPPORTED | Not possible, or deliberately not used. An alternative is offered. |

## Summary matrix

| Capability | macOS | Windows | Android |
|---|---|---|---|
| Focus timer, survives restart | SUPPORTED | SUPPORTED | SUPPORTED |
| Detect running / foreground app | SUPPORTED | SUPPORTED | REQUIRES_PERMISSION (Usage access) |
| Block apps | SUPPORTED (closes the app) | SUPPORTED (closes the app) | REQUIRES_PERMISSION (shield screen) |
| Block websites in browsers | SUPPORTED (extension) | SUPPORTED (extension) | UNSUPPORTED |
| Block URL patterns (Shorts, Reels) | SUPPORTED (extension) | SUPPORTED (extension) | UNSUPPORTED |
| System-wide domain blocking | REQUIRES_PERMISSION (hosts file, admin) | REQUIRES_PERMISSION (hosts file, admin) | UNSUPPORTED |
| Screen Time / FamilyControls | REQUIRES_ENTITLEMENT | — | — |
| AppLocker / WDAC | — | UNSUPPORTED (deliberately) | — |
| Accessibility-service blocking | — | — | UNSUPPORTED (deliberately) |
| Feed blocking inside native apps | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED |
| App usage statistics | SUPPORTED (while app runs) | SUPPORTED (while app runs) | REQUIRES_PERMISSION |
| Mindful pause | Websites only (extension) | Websites only (extension) | Apps (shield screen) |
| Start at login / after reboot | SUPPORTED | SUPPORTED | SUPPORTED |

## macOS

- **App blocking is ordinary process termination.** Monk Guard asks a blocked app to quit, then
  force-closes it after 3 seconds. It only affects apps run by your own user account. A blocked app
  can appear for up to ~1.5 seconds before it is closed. You can always quit MONK MODE itself
  (except from the tray during a Strict/Maximum session; Activity Monitor still works).
- **Screen Time APIs (FamilyControls, ManagedSettings, DeviceActivity).** These are Apple's
  official way to "shield" apps and websites. On macOS they require:
  1. the `com.apple.developer.family-controls` entitlement, which Apple grants on request
     (developer.apple.com → Account → request "Family Controls (Distribution)");
  2. a paid Apple Developer Program membership;
  3. a native Swift app or extension signed with that entitlement and distributed through the Mac
     App Store or with a Developer ID and a provisioning profile.
  This build is unsigned and has no entitlement, so it does **not** use these APIs. The stronger
  Screen Time shield is a possible future addition once an entitlement is available.
- **Safari** is not covered by the website extension (a Safari Web Extension needs Xcode and
  signing). Use the hosts file or block Safari as an app.
- **Usage statistics** are measured only while MONK MODE is running. There is no import from
  Apple's Screen Time history (no public API for it).
- **Notifications** need permission the first time (System Settings → Notifications → MONK MODE).

## Windows

- **App blocking is ordinary process termination** (TerminateProcess) for programs run by your
  user. Programs started "as administrator" cannot be closed by a normal app. You can always end
  MONK MODE in Task Manager.
- **AppLocker and Windows Defender Application Control** are not used. AppLocker needs Windows
  Enterprise or Education and administrative policy management; WDAC changes machine-wide code
  integrity rules. Both are far too invasive for a personal focus tool.
- **No drivers, services or firewall rules** are installed. Windows Defender and other security
  software are never changed.
- **Hosts file:** some antivirus products warn when the hosts file changes. That warning is
  expected; MONK MODE only touches its own marked section.
- Usage statistics are measured only while MONK MODE is running.
- **Verification status:** the Windows build is compiled and unit-tested by GitHub Actions on
  `windows-latest` (passed), and its installers are built there; it has not yet been tested by
  hand on a real Windows PC. See TEST_REPORT.md.

## Browser extension

- Covers Chromium browsers (Chrome, Edge, Brave, Opera, Vivaldi; Chrome 116+) and Firefox 128+.
- Only blocks in browsers where it is installed and enabled. Private/incognito windows need you
  to allow the extension there.
- The extension can be removed by the user at any time; MONK MODE cannot prevent that.
- Without the desktop app running it keeps applying schedules and any running focus/strict session
  from the last sync, but not quick blocks or daily limits.

## Android

- **App blocking** uses usage statistics to see which app is in front, then shows a full-screen
  MONK MODE shield over it. Needs **Usage access** and **Display over other apps**. Detection runs
  about every 0.8 s while a block is active, so a blocked app can be visible for up to about one
  second.
- **Accessibility services are deliberately not used**, to follow Google Play's policy that
  accessibility is for helping users with disabilities.
- **Websites cannot be blocked** in Android browsers: Chrome on Android does not support
  extensions. Block the browser app during focus, or use Firefox for Android with an extension.
- **Feeds inside apps** (Reels, Shorts, TikTok's For You) cannot be removed selectively; block the
  whole app instead.
- **Battery savers** on some phones (Xiaomi, Oppo, Vivo, Samsung and others) can stop background
  apps. The timer stays correct (it is timestamp-based) but notifications or shields may be
  delayed until you allow MONK MODE to run unrestricted.
- **After a restart**, Monk Guard starts again once the phone has been unlocked.
- Force-stopping MONK MODE in Settings → Apps stops enforcement until it is opened again.
