import type { FocusMode, FocusPhase, FocusSession, PomodoroConfig, TimerSnapshot } from '@monk/shared-types';
import { HOUR_MS, MINUTE_MS } from './time';

/** Stopwatch sessions are force-closed after this long to avoid forgotten timers inflating statistics. */
export const STOPWATCH_MAX_MS = 12 * HOUR_MS;
export const MIN_DURATION_MIN = 1;
export const MAX_DURATION_MIN = 600;
export const PRESET_DURATIONS_MIN = [5, 15, 25, 45, 60, 90] as const;

export const DEFAULT_POMODORO: PomodoroConfig = {
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  longBreakEvery: 4,
  autoStartBreaks: true,
  autoStartFocus: false,
};

export const MODE_LABELS: Record<FocusMode, string> = {
  pomodoro: 'Pomodoro',
  stopwatch: 'Stopwatch',
  custom: 'Custom',
  deep_work: 'Deep Work',
  study: 'Study',
  reading: 'Reading',
  break: 'Break',
};

export const MODE_DEFAULT_MIN: Record<FocusMode, number | null> = {
  pomodoro: 25,
  stopwatch: null,
  custom: 45,
  deep_work: 90,
  study: 50,
  reading: 30,
  break: 5,
};

/** Planned duration in ms for a new focus phase, or null for open-ended stopwatch sessions. */
export function plannedMsFor(mode: FocusMode, durationMin: number | undefined, pomodoro: PomodoroConfig): number | null {
  if (mode === 'stopwatch') return null;
  const fallback = mode === 'pomodoro' ? pomodoro.focusMin : MODE_DEFAULT_MIN[mode] ?? 25;
  const min = Math.round(durationMin ?? fallback);
  if (min < MIN_DURATION_MIN || min > MAX_DURATION_MIN) throw new Error(`Duration must be ${MIN_DURATION_MIN}–${MAX_DURATION_MIN} minutes`);
  return min * MINUTE_MS;
}

type TimingFields = Pick<FocusSession, 'startedAt' | 'pausedAt' | 'pausedTotalMs' | 'plannedMs' | 'status' | 'endedAt'>;

/** Effective (unpaused) elapsed time derived purely from persisted instants. */
export function elapsedMs(s: TimingFields, now: number): number {
  const end = s.endedAt ?? s.pausedAt ?? now;
  return Math.max(0, end - s.startedAt - s.pausedTotalMs);
}

export function remainingMs(s: TimingFields, now: number): number | null {
  if (s.plannedMs == null) return null;
  return Math.max(0, s.plannedMs - elapsedMs(s, now));
}

/** The instant a running countdown reaches zero (accounts for pauses), or null. */
export function dueAt(s: TimingFields): number | null {
  if (s.plannedMs == null || s.status !== 'running') return null;
  return s.startedAt + s.pausedTotalMs + s.plannedMs;
}

export function snapshot(session: FocusSession | null, now: number): TimerSnapshot {
  if (!session) return { session: null, now, elapsedMs: 0, remainingMs: null };
  return { session, now, elapsedMs: elapsedMs(session, now), remainingMs: remainingMs(session, now) };
}

/** Which break follows a completed focus phase. `completedFocusCount` includes the one just finished. */
export function breakAfter(completedFocusCount: number, cfg: PomodoroConfig): { phase: FocusPhase; minutes: number } {
  const every = Math.max(1, cfg.longBreakEvery);
  return completedFocusCount > 0 && completedFocusCount % every === 0
    ? { phase: 'long_break', minutes: cfg.longBreakMin }
    : { phase: 'short_break', minutes: cfg.shortBreakMin };
}

export function progress(s: TimingFields, now: number): number {
  if (s.plannedMs == null || s.plannedMs <= 0) return 0;
  return Math.min(1, elapsedMs(s, now) / s.plannedMs);
}
