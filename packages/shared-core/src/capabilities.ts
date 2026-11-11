import type { Capability, Platform } from '@monk/shared-types';

// Honest description of what each platform build can enforce. Shown in-app (Settings → About)
// and mirrored in docs/PLATFORM_LIMITATIONS.md. Never overstate enforcement strength.

export const CAPABILITIES: Record<Exclude<Platform, 'browser'>, Capability[]> = {
  macos: [
    { id: 'focus', label: 'Focus timer & restart recovery', status: 'SUPPORTED', mechanism: 'Rust engine with persisted timestamps in SQLite', limitation: 'Phase-end notifications only fire while the app (or its tray icon) is running.' },
    { id: 'app-monitor', label: 'Detect running apps', status: 'SUPPORTED', mechanism: 'Process list (sysinfo) + NSWorkspace frontmost app', limitation: 'Polling every 1.5 s; a blocked app can show briefly before it is closed.' },
    { id: 'app-block', label: 'Close blocked apps', status: 'SUPPORTED', mechanism: 'SIGTERM, then SIGKILL after a grace period, for apps owned by the current user', limitation: 'Ordinary process termination. Users can quit MONK MODE itself, and apps run by other users or as root are not touched.' },
    { id: 'web-extension', label: 'Website blocking (browser extension)', status: 'SUPPORTED', mechanism: 'Chromium/Firefox extension synced over a loopback-only bridge', limitation: 'Only covers browsers with the extension installed. Safari is not covered.' },
    { id: 'web-hosts', label: 'System-wide website blocking (hosts file)', status: 'REQUIRES_PERMISSION', mechanism: 'Marked section in /etc/hosts written with your administrator approval', limitation: 'Domain level only (no URL paths). Browsers using DNS-over-HTTPS may bypass it. Requires admin password on each change.' },
    { id: 'screen-time', label: 'Screen Time / FamilyControls shielding', status: 'REQUIRES_ENTITLEMENT', mechanism: 'Apple FamilyControls + ManagedSettings', limitation: 'Requires the com.apple.developer.family-controls entitlement granted by Apple, a paid developer account and a native Swift extension. Not included in this build.' },
    { id: 'usage', label: 'App usage tracking', status: 'SUPPORTED', mechanism: 'Frontmost application sampling while MONK MODE runs', limitation: 'Usage is only measured while the app is running; no historical import from Screen Time.' },
    { id: 'autostart', label: 'Start at login', status: 'SUPPORTED', mechanism: 'LaunchAgent via tauri-plugin-autostart', limitation: 'Users can remove it in System Settings → General → Login Items.' },
  ],
  windows: [
    { id: 'focus', label: 'Focus timer & restart recovery', status: 'SUPPORTED', mechanism: 'Rust engine with persisted timestamps in SQLite', limitation: 'Phase-end notifications only fire while the app (or its tray icon) is running.' },
    { id: 'app-monitor', label: 'Detect running apps', status: 'SUPPORTED', mechanism: 'Process list (sysinfo) + GetForegroundWindow', limitation: 'Polling every 1.5 s.' },
    { id: 'app-block', label: 'Close blocked apps', status: 'SUPPORTED', mechanism: 'TerminateProcess for processes owned by the current user', limitation: 'Elevated (administrator) processes cannot be closed from a standard-user app. Users can end MONK MODE in Task Manager.' },
    { id: 'web-extension', label: 'Website blocking (browser extension)', status: 'SUPPORTED', mechanism: 'Chromium/Firefox extension synced over a loopback-only bridge', limitation: 'Only covers browsers with the extension installed.' },
    { id: 'web-hosts', label: 'System-wide website blocking (hosts file)', status: 'REQUIRES_PERMISSION', mechanism: 'Marked section in C:\\Windows\\System32\\drivers\\etc\\hosts written through a UAC-elevated helper', limitation: 'Domain level only. Some antivirus products flag hosts edits; DNS-over-HTTPS may bypass it.' },
    { id: 'applocker', label: 'AppLocker / WDAC policies', status: 'UNSUPPORTED', mechanism: 'Not used', limitation: 'AppLocker needs Enterprise/Education editions and administrative policy management; WDAC is machine-wide. Too invasive for a personal focus tool.' },
    { id: 'usage', label: 'App usage tracking', status: 'SUPPORTED', mechanism: 'Foreground window sampling while MONK MODE runs', limitation: 'Usage is only measured while the app is running.' },
    { id: 'autostart', label: 'Start at login', status: 'SUPPORTED', mechanism: 'HKCU Run key via tauri-plugin-autostart', limitation: 'Users can disable it in Task Manager → Startup apps.' },
  ],
  android: [
    { id: 'focus', label: 'Focus timer & restart recovery', status: 'SUPPORTED', mechanism: 'Persisted timestamps + foreground service + boot receiver', limitation: 'Aggressive OEM battery savers can delay notifications; the timer itself stays accurate.' },
    { id: 'usage', label: 'App usage statistics', status: 'REQUIRES_PERMISSION', mechanism: 'UsageStatsManager (Usage access)', limitation: 'You must enable Usage access in system settings.' },
    { id: 'app-block', label: 'Block apps with a shield screen', status: 'REQUIRES_PERMISSION', mechanism: 'Foreground-app detection via UsageStats + full-screen block activity', limitation: 'Needs Usage access and "Display over other apps". Detection runs every second while a block is active; the blocked app may be visible for up to ~1 s.' },
    { id: 'accessibility', label: 'Accessibility-service blocking', status: 'UNSUPPORTED', mechanism: 'Not used', limitation: 'Deliberately not used to respect Google Play accessibility policy.' },
    { id: 'web', label: 'Website blocking', status: 'UNSUPPORTED', mechanism: 'Not available in this build', limitation: 'Android browsers do not support extensions (except Firefox). Block the browser app or use Firefox with the MONK MODE extension.' },
    { id: 'feeds', label: 'In-app feed blocking (Reels/Shorts inside native apps)', status: 'UNSUPPORTED', mechanism: 'App-level blocking offered instead', limitation: 'There is no supported API to remove content inside third-party apps.' },
    { id: 'boot', label: 'Restore after reboot', status: 'SUPPORTED', mechanism: 'BOOT_COMPLETED receiver', limitation: 'Runs after the device is unlocked once.' },
  ],
};
