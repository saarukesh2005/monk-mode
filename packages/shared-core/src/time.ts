import type { EpochMs, LocalDate } from '@monk/shared-types';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Local calendar date key for an instant, e.g. '2026-11-10'. */
export function localDateKey(ts: EpochMs): LocalDate {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseLocalDate(date: LocalDate): Date {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${date}`);
  return new Date(y, m - 1, d);
}

export function startOfLocalDay(ts: EpochMs): EpochMs {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Calendar-aware day arithmetic (safe across DST transitions). */
export function addDays(date: LocalDate, days: number): LocalDate {
  const d = parseLocalDate(date);
  return localDateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime());
}

export function addMonths(date: LocalDate, months: number): LocalDate {
  const d = parseLocalDate(date);
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return localDateKey(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), lastDay)).getTime());
}

/** Monday = 0 ... Sunday = 6 (matches schedules.days_mask bit order). */
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function startOfWeek(date: LocalDate): LocalDate {
  return addDays(date, -weekdayIndex(parseLocalDate(date)));
}

export function startOfMonth(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`;
}

export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((parseLocalDate(b).getTime() - parseLocalDate(a).getTime()) / DAY_MS);
}

export function formatDuration(ms: number, opts: { seconds?: boolean } = {}): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (opts.seconds) return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

export function formatClock(minute: number): string {
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}
