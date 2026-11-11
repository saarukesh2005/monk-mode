# MONK MODE user guide

*Discipline is a system.* MONK MODE helps you focus, blocks what distracts you and plans your
days — all on your own device.

## First run

A short introduction explains what the app does and what it needs. You can change everything
later in Settings.

## Desktop pages

Keyboard: ⌘/Ctrl + 1 … 9 jumps to each page in order.

| # | Page | What you do there |
|---|---|---|
| 1 | **Overview** | Today's focus, target progress, streak, this week, intention, next tasks, blocking status. |
| 2 | **Focus** | Start a timer. Space = start / pause. ⌘/Ctrl + Enter = end. |
| 3 | **Blocker** | Lists, quick block, strict mode, exceptions, daily limits, hosts file, capability report. |
| 4 | **Tasks** | Tasks with subtasks, priority, due dates, repeats, categories, tags, search and filters. |
| 5 | **Planner** | Daily plan (morning + evening review), calendar (day/week/month), study planner. |
| 6 | **Analytics** | Focus, screen time, websites, time-of-day, weekdays, trends, heatmap, CSV/JSON export. |
| 7 | **Schedules** | Recurring windows that switch a blocklist on. |
| 8 | **History** | Sessions, blocks, strict-mode events, notifications. |
| 9 | **Settings** | General, appearance, focus, blocker, privacy & data, about. |

Closing the window keeps MONK MODE running in the menu bar / system tray so timers, schedules and
blocks keep working (Settings → General to change this). The tray menu can start a 25-minute
focus or end the current session.

## A typical day

1. **Morning** — Planner → Daily plan: write an intention, three priorities and a focus target.
2. **Work** — Focus: choose Pomodoro, Deep work, Study… Pick a task or subject so the time is
   counted for it. Distraction lists with "Block during focus" switch on automatically.
3. **Breaks** — Pomodoro breaks start by themselves (can be turned off). Skip a break if you are
   in flow.
4. **Evening** — Planner → Daily plan → End-of-day review, then **Close the day**.

## Tasks

- Type in the box at the top and press Enter. Tasks added in *Today* are due today.
- Click a task to edit: due date, repeats (daily, weekdays, weekly, monthly), priority, category,
  subject, notes, tags and subtasks.
- Completing a repeating task creates the next one automatically.
- Search looks in titles, notes and tags.

## Study planner

- Add subjects with a weekly goal. Focus sessions tagged with a subject count toward it.
- Break subjects into topics. Mark a topic *Learned* to schedule its first revision; **Mark
  reviewed** pushes the next revision further out (1, 3, 7, 14, 30, 60 days).
- Topics due for revision appear at the top.

## Calendar

Local only — no Google/Outlook account is needed or used. Day, week and month views show your
events (including repeating ones), task deadlines and the focus time you actually recorded each
day. Click a day header to add an event; types are *Event*, *Focus block* and *Study*.

## Blocking

Read BLOCKING_GUIDE.md. In short: build lists, choose when they switch on, install the browser
extension for websites.

## Strict mode

Read STRICT_MODE.md. In short: a timed commitment with an emergency exit that gets more
deliberate at higher levels.

## Analytics

Every number is labelled:

- **Recorded** — from focus sessions you recorded.
- **Measured** — observed on this device (app use while MONK MODE runs; website time from the
  extension; Android usage statistics).
- **No data** — nothing collected yet. MONK MODE never fills gaps with estimates.

Export sessions as CSV or everything as JSON from the top of the page.

## Themes

Settings → Appearance: System/Dark/Light, five palettes (Graphite, Obsidian, Midnight, Paper,
Sandstone), six accent colours, system/serif/mono type, four text sizes, and which cards appear on
Overview. Sounds (singing bowl, soft chime, wood block) and volume are in Settings → Focus.

## Backup and moving to another device

Settings → Privacy & data → **Create encrypted backup**. On the other device: **Restore from
backup**, same passphrase. Works between macOS, Windows and Android. See PRIVACY.md.

## Recovery

| Problem | What to do |
|---|---|
| The timer looks wrong after sleep/restart | Nothing — it corrects itself within 2 seconds of the app running. |
| A rule blocks something you urgently need | Blocker → Temporary exceptions, or the emergency exit in a strict session. |
| Hosts-file blocking is stuck | Blocker → System-wide blocking → Remove, or edit the hosts file by hand (BLOCKING_GUIDE.md). |
| The extension says "Desktop app offline" | Open MONK MODE; check the pairing code in Settings → Blocker. |
| Data looks damaged | Settings → Privacy & data → Check database integrity; restore a backup. |
| You deleted data by mistake | A copy is in `safety-snapshots/` inside the data folder (see PRIVACY.md). |
