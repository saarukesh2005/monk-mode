# How the focus timer works

MONK MODE never counts seconds to keep time. It saves **when** things happened and works out
everything else from those saved moments. That is why the timer stays correct after you close the
app, restart the computer, put it to sleep or the phone kills the app in the background.

## What is saved

Each focus period or break is one row in the `focus_sessions` table:

| Field | Meaning |
|---|---|
| `started_at` | When the period started (milliseconds since 1970). |
| `planned_ms` | How long it should last. Empty for the stopwatch. |
| `paused_at` | When it was paused, if it is paused now. |
| `paused_total_ms` | Total time spent paused so far. |
| `ended_at`, `focused_ms` | Filled in when it finishes. |
| `status` | `running`, `paused`, `completed`, `interrupted` or `skipped`. |

The table `timer_state` has room for exactly **one** row. It points at the live session. The
database itself refuses a second row, so two timers can never run at once, even if two parts
of the app try to start one at the same moment.

## The maths

```
elapsed   = (ended_at or paused_at or now) − started_at − paused_total_ms
remaining = planned_ms − elapsed            (never below 0)
due at    = started_at + paused_total_ms + planned_ms
```

The same formulas exist in TypeScript (`packages/shared-core/src/focus.ts`), Rust
(`apps/desktop/src-tauri/src/focus.rs`) and Kotlin (Android `core` module). All three are
checked against the same test file: `packages/shared-core/vectors/focus.json`.

## Catching up ("tick")

A background loop calls `tick` about every 1.5 seconds on desktop (and on Android while Monk Guard
runs). It also runs every time the app starts. `tick`:

1. Finds a running period whose due time has passed.
2. Ends it **at the moment it was due**, not at the moment the app noticed.
3. In Pomodoro mode, starts the break **at that same moment**, and repeats if the break is also over.
4. Starts the next focus period automatically only if you turned that on **and** the break ended in
   the last 15 seconds. If you were away, MONK MODE does not invent focus time you never did.

Example: you start a 25-minute Pomodoro at 09:00 and shut the laptop. You open it at 12:00.
MONK MODE records focus 09:00–09:25 and a break 09:25–09:30, and waits for you.

## Modes

| Mode | Default length |
|---|---|
| Pomodoro | Your setting (25 min), then short/long breaks |
| Deep work | 90 min |
| Study | 50 min |
| Reading | 30 min |
| Custom | 45 min, or any 1–600 min |
| Stopwatch | Open-ended (closed automatically after 12 hours) |
| Break | Your short-break setting |

Preset lengths offered: 5, 15, 25, 45, 60, 90 minutes, or type your own.

## Controls

- **Pause / Resume** — paused time is never counted as focus.
- **End** — saves the session. If you stop before the planned time, it is saved as *interrupted*
  (breaks: *skipped*) and only the real time counts.
- **Reset** — throws the session away; nothing is saved.
- **Skip break** — ends the break now.

## Long breaks

After every *N*th focus period in a row (default 4) the break is long. "In a row" means the next
Pomodoro starts within 2 hours of the previous one ending; otherwise the count starts again.

## Notifications

- Desktop: system notification when a period ends (only while MONK MODE or its tray icon runs).
- Android: an ongoing notification shows a live countdown that Android keeps exact by itself,
  plus an alert when a period ends.
