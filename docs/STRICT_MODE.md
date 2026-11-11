# Strict mode

Strict mode is a **commitment device**. You choose, ahead of time, to be held to a block for a fixed
time. It is designed to make giving up slower and more deliberate, not impossible.

> MONK MODE is **not** an unbreakable lock. Anyone who owns the device can force-quit the app,
> uninstall it, revoke its permissions or restart the device. MONK MODE never hides itself, never
> disables security software and never stops you using your own device in an emergency.

## States

```
IDLE → PREPARING → ACTIVE ⇄ PAUSED (Normal level only)
                     │
                     ├─ time runs out ───────────→ COMPLETED → IDLE
                     └─ emergency exit (+cool-down) → EMERGENCY_EXIT → IDLE
```

The same state machine exists in TypeScript (`packages/shared-core/src/strict.ts`, unit tested),
Rust (`apps/desktop/src-tauri/src/strict.rs`) and Kotlin (Android). Their rules are checked
against `packages/shared-core/vectors/strict.json`.

## Levels

| | Normal | Strict | Maximum |
|---|---|---|---|
| Pause | Yes | No | No |
| Remove rules / turn off a list in the session | Yes | No | No |
| Temporary exceptions ("allow 5 minutes") | Yes | No | No |
| Emergency exit: reason required | No | 10+ characters | 25+ characters |
| Emergency exit: wait | None | 30 seconds | 60–1800 s (default 300) |
| Emergency exit: typed phrase | No | No | "I choose to end this commitment early" |
| Quit the desktop app from the tray / ⌘Q | Yes | No (window is shown instead) | No |
| Hosts-file blocking (if you enabled it) | No | Yes | Yes |

During the cool-down you can press **Stay committed** to cancel the exit.

## Starting a session

1. Blocker → Strict mode → **Start commitment**.
2. Choose the level, the length (5 minutes to 12 hours) and the blocklists to enforce.
3. Tick the confirmation box. The session starts only after you confirm.

A **daily limit** (default 8 hours, Settings → Blocker) stops you from committing to more strict
time in one day than you meant to.

## Require the browser extension (desktop, optional)

Settings → Blocker → **Require the browser extension**. During Strict and Maximum commitments,
MONK MODE closes any browser whose MONK MODE extension has not synced in the last 90 seconds
(switched off, removed, or a private window without the extension allowed). There is a 90-second
grace period after the commitment starts. Safari cannot carry the extension, so it is closed too.
Chrome, Brave, Vivaldi, Opera and Arc share one check: if the extension is active in one of them,
the others are treated as protected. The setting cannot be changed during a strict commitment.

## What is recorded (tamper events)

Everything below is saved to History → Strict mode, on this device only:

- session started, paused, resumed, completed;
- emergency exit requested, cancelled or completed (with your reason);
- a locked change refused (for example trying to delete a rule);
- a refused exception or pause;
- **monitor gap** — MONK MODE was not running for a while during a session (force-quit, crash or
  restart);
- **clock changed** — the system clock moved backwards during a session;
- **extension missing** — a browser was closed because its MONK MODE extension was not active.

## Safe recovery

- If MONK MODE crashes or the device restarts, the session continues from the saved end time.
  The timer is not reset and is not extended.
- If a session ends while you were away, it is marked completed the next time MONK MODE runs.
- Restoring a backup never brings back an active strict session; any session that was active is
  marked completed.
- If a rule causes a real problem (for example it blocks an app you urgently need), use the
  emergency exit. If MONK MODE itself is broken, you can always quit it with Activity Monitor
  (macOS), Task Manager (Windows) or Settings → Apps → Force stop (Android). That is recorded as a
  monitor gap, nothing more.
- Hosts-file blocking added for a session is removed when the session ends. If that removal fails
  (for example you cancel the password prompt), MONK MODE tells you, and Blocker → System-wide
  blocking → **Remove** takes it out.
