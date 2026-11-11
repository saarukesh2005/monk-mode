# Changelog

## 1.1.0 — 2026-11-11

### Added
- Mindful pause mode for blocklists (browser extension and Android): breathing countdown,
  intention prompt, "turned back" / "continued" outcomes stored in the new `pause_events` table and
  shown in Analytics / Insights. Strict-enforced lists always hard-block.
- Desktop setting "Require the browser extension during strict sessions": closes browsers whose
  extension has not synced for 90 s during Strict/Maximum commitments; logged as a tamper event.
- Android: Plan (tasks, daily plan, study), Insights, Settings (themes, Pomodoro, backup/restore,
  delete data, capability report) and onboarding screens.
- GitHub Release publishing for desktop installers and browser extensions on version tags.
- Database migration `0002_mindful_pause.sql`.

### Changed
- Android live blocker delegates to the tested core resolver (system apps are never shielded).
- Android compiles against API 37 (targets API 35).

### Fixed
- ⌘Q / system quit now works outside strict sessions.
- Android CI no longer depends on the failing `setup-android` action.

## 1.0.0 — 2026-11-11

First release: focus engine, Monk Guard (desktop + Android), browser extensions, strict mode,
tasks, planner, calendar, analytics, encrypted cross-platform backups.
