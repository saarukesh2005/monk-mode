import type { AppUsage, EpochMs, FocusSession, LocalDate, MetricProvenance, WebUsage } from '@monk/shared-types';
import { addDays, localDateKey, parseLocalDate, startOfLocalDay, weekdayIndex } from '@monk/shared-core';

export interface Metric<T = number> {
  value: T;
  provenance: MetricProvenance;
}

export interface FocusSummary {
  totalFocusMs: number;
  sessionCount: number;
  completedCount: number;
  interruptedCount: number;
  completionRate: number | null;
  longestMs: number;
  averageMs: number;
}

const isFocus = (s: FocusSession): boolean => s.phase === 'focus';
const isFinished = (s: FocusSession): boolean => s.status === 'completed' || s.status === 'interrupted';

/** Splits a [start, end) interval across local days so cross-midnight sessions count on both days. */
export function splitByDay(start: EpochMs, end: EpochMs): { date: LocalDate; ms: number }[] {
  const out: { date: LocalDate; ms: number }[] = [];
  let cursor = start;
  while (cursor < end) {
    const dayStart = startOfLocalDay(cursor);
    const next = new Date(dayStart);
    next.setDate(next.getDate() + 1);
    const segEnd = Math.min(end, next.getTime());
    out.push({ date: localDateKey(cursor), ms: segEnd - cursor });
    cursor = segEnd;
  }
  return out;
}

export function summarizeFocus(sessions: FocusSession[]): FocusSummary {
  const focus = sessions.filter((s) => isFocus(s) && isFinished(s));
  const completed = focus.filter((s) => s.status === 'completed').length;
  const interrupted = focus.length - completed;
  const durations = focus.map((s) => s.focusedMs);
  const total = durations.reduce((a, b) => a + b, 0);
  return {
    totalFocusMs: total,
    sessionCount: focus.length,
    completedCount: completed,
    interruptedCount: interrupted,
    completionRate: focus.length ? completed / focus.length : null,
    longestMs: durations.length ? Math.max(...durations) : 0,
    averageMs: focus.length ? Math.round(total / focus.length) : 0,
  };
}

/**
 * Focus milliseconds per local day. A finished session's focused time is spread over its
 * wall-clock span proportionally, so pauses do not distort per-day totals.
 */
export function focusByDay(sessions: FocusSession[]): Map<LocalDate, number> {
  const map = new Map<LocalDate, number>();
  for (const s of sessions) {
    if (!isFocus(s) || !isFinished(s) || s.endedAt == null || s.focusedMs <= 0) continue;
    const span = s.endedAt - s.startedAt;
    const parts = span > 0 ? splitByDay(s.startedAt, s.endedAt) : [{ date: localDateKey(s.startedAt), ms: 1 }];
    const totalParts = parts.reduce((a, p) => a + p.ms, 0);
    for (const p of parts) map.set(p.date, (map.get(p.date) ?? 0) + Math.round((s.focusedMs * p.ms) / totalParts));
  }
  return map;
}

/** Consecutive days (ending today, or yesterday if today has nothing yet) with at least `minMs` of focus. */
export function focusStreak(byDay: Map<LocalDate, number>, today: LocalDate, minMs = 1): { current: number; best: number } {
  const qualifies = (d: LocalDate): boolean => (byDay.get(d) ?? 0) >= minMs;
  let current = 0;
  let cursor = qualifies(today) ? today : addDays(today, -1);
  while (qualifies(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  const days = [...byDay.keys()].filter(qualifies).sort();
  let best = 0;
  let run = 0;
  let prev: LocalDate | null = null;
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best: Math.max(best, current) };
}

export function dailySeries(byDay: Map<LocalDate, number>, from: LocalDate, days: number): { date: LocalDate; ms: number }[] {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    return { date, ms: byDay.get(date) ?? 0 };
  });
}

/** Focus minutes by hour of day (0–23), based on session start times. */
export function hourOfDayDistribution(sessions: FocusSession[]): number[] {
  const hours = Array.from({ length: 24 }, () => 0);
  for (const s of sessions) {
    if (!isFocus(s) || !isFinished(s)) continue;
    const h = new Date(s.startedAt).getHours();
    hours[h] = (hours[h] ?? 0) + s.focusedMs;
  }
  return hours;
}

export function weekdayDistribution(byDay: Map<LocalDate, number>): number[] {
  const out = Array.from({ length: 7 }, () => 0);
  for (const [d, ms] of byDay) {
    const i = weekdayIndex(parseLocalDate(d));
    out[i] = (out[i] ?? 0) + ms;
  }
  return out;
}

export interface UsageTotal {
  key: string;
  label: string;
  ms: number;
}

export function topApps(usage: AppUsage[], limit = 10): UsageTotal[] {
  const map = new Map<string, UsageTotal>();
  for (const u of usage) {
    const t = map.get(u.appId) ?? { key: u.appId, label: u.appName, ms: 0 };
    map.set(u.appId, { ...t, ms: t.ms + u.durationMs });
  }
  return [...map.values()].sort((a, b) => b.ms - a.ms).slice(0, limit);
}

export function topDomains(usage: WebUsage[], limit = 10): UsageTotal[] {
  const map = new Map<string, number>();
  for (const u of usage) map.set(u.domain, (map.get(u.domain) ?? 0) + u.durationMs);
  return [...map.entries()]
    .map(([key, ms]) => ({ key, label: key, ms }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit);
}

export function usageByDay(rows: { startedAt: EpochMs; endedAt: EpochMs }[]): Map<LocalDate, number> {
  const map = new Map<LocalDate, number>();
  for (const r of rows) for (const p of splitByDay(r.startedAt, r.endedAt)) map.set(p.date, (map.get(p.date) ?? 0) + p.ms);
  return map;
}

/** Distraction time = measured time in apps/domains that appear on any blocklist. */
export function distractionMs(apps: AppUsage[], web: WebUsage[], isDistractingApp: (u: AppUsage) => boolean, isDistractingDomain: (d: string) => boolean): number {
  return apps.filter(isDistractingApp).reduce((a, u) => a + u.durationMs, 0) + web.filter((w) => isDistractingDomain(w.domain)).reduce((a, u) => a + u.durationMs, 0);
}

export interface PeriodComparison {
  current: number;
  previous: number;
  deltaPct: number | null;
}

export function comparePeriods(byDay: Map<LocalDate, number>, currentStart: LocalDate, lengthDays: number): PeriodComparison {
  const sum = (from: LocalDate): number => dailySeries(byDay, from, lengthDays).reduce((a, d) => a + d.ms, 0);
  const current = sum(currentStart);
  const previous = sum(addDays(currentStart, -lengthDays));
  return { current, previous, deltaPct: previous > 0 ? (current - previous) / previous : null };
}

export interface HeatCell {
  date: LocalDate;
  ms: number;
  level: 0 | 1 | 2 | 3 | 4;
}

/** Calendar heatmap cells: `weeks` full Monday–Sunday weeks ending with the week containing `today`. */
export function heatmap(byDay: Map<LocalDate, number>, today: LocalDate, weeks = 18): HeatCell[] {
  const weekEnd = addDays(today, 6 - weekdayIndex(parseLocalDate(today)));
  const start = addDays(weekEnd, -(weeks * 7 - 1));
  const series = dailySeries(byDay, start, weeks * 7);
  const max = Math.max(1, ...series.map((s) => s.ms));
  return series.map(({ date, ms }) => ({
    date,
    ms,
    level: ms === 0 ? 0 : (Math.min(4, Math.ceil((ms / max) * 4)) as HeatCell['level']),
  }));
}

export function targetProgress(actualMs: number, targetMin: number): Metric<number | null> {
  if (targetMin <= 0) return { value: null, provenance: 'unavailable' };
  return { value: Math.min(1, actualMs / (targetMin * 60_000)), provenance: 'recorded' };
}

// ---------- Export ----------

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Neutralize spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [cols.map(csvCell).join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
