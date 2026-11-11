import { formatDuration } from '@monk/shared-core';

export const fmtMs = (ms: number): string => (ms <= 0 ? '0m' : ms < 60_000 ? '<1m' : formatDuration(ms));

export const fmtTime = (ts: number): string => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const fmtDate = (ts: number | string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string => {
  const d = typeof ts === 'string' ? new Date(`${ts}T12:00:00`) : new Date(ts);
  return d.toLocaleDateString([], opts);
};

export const fmtDateTime = (ts: number): string => `${fmtDate(ts, { month: 'short', day: 'numeric', year: 'numeric' })} · ${fmtTime(ts)}`;

export const fmtPct = (v: number | null): string => (v == null ? '—' : `${Math.round(v * 100)}%`);

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export const MODE_ICONS = {
  pomodoro: 'Timer',
  stopwatch: 'Watch',
  custom: 'SlidersHorizontal',
  deep_work: 'Brain',
  study: 'GraduationCap',
  reading: 'BookOpen',
  break: 'Coffee',
} as const;
