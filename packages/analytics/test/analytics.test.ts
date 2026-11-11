import { describe, expect, it } from 'vitest';
import type { FocusSession } from '@monk/shared-types';
import { comparePeriods, focusByDay, focusStreak, heatmap, hourOfDayDistribution, splitByDay, summarizeFocus, targetProgress, toCsv, topApps } from '../src';

const MIN = 60_000;
const at = (d: number, h: number, m = 0): number => new Date(2026, 10, d, h, m).getTime();
const session = (over: Partial<FocusSession>): FocusSession => ({
  id: Math.random().toString(36),
  mode: 'pomodoro',
  phase: 'focus',
  status: 'completed',
  plannedMs: 25 * MIN,
  startedAt: at(9, 9),
  pausedAt: null,
  pausedTotalMs: 0,
  endedAt: at(9, 9, 25),
  focusedMs: 25 * MIN,
  cycleIndex: 1,
  categoryId: null,
  subjectId: null,
  taskId: null,
  note: '',
  strict: false,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('analytics', () => {
  it('summarizes only finished focus phases', () => {
    const s = summarizeFocus([
      session({}),
      session({ status: 'interrupted', focusedMs: 10 * MIN }),
      session({ phase: 'short_break', focusedMs: 5 * MIN }),
      session({ status: 'running', endedAt: null }),
    ]);
    expect(s.sessionCount).toBe(2);
    expect(s.totalFocusMs).toBe(35 * MIN);
    expect(s.completionRate).toBe(0.5);
    expect(s.longestMs).toBe(25 * MIN);
    expect(s.averageMs).toBe(17.5 * MIN);
  });

  it('reports no completion rate without data instead of inventing one', () => {
    expect(summarizeFocus([]).completionRate).toBeNull();
    expect(targetProgress(0, 0).provenance).toBe('unavailable');
  });

  it('splits sessions crossing midnight', () => {
    const parts = splitByDay(at(9, 23, 30), at(10, 0, 30));
    expect(parts).toEqual([
      { date: '2026-11-09', ms: 30 * MIN },
      { date: '2026-11-10', ms: 30 * MIN },
    ]);
    const byDay = focusByDay([session({ startedAt: at(9, 23, 30), endedAt: at(10, 0, 30), focusedMs: 60 * MIN })]);
    expect(byDay.get('2026-11-09')).toBe(30 * MIN);
    expect(byDay.get('2026-11-10')).toBe(30 * MIN);
  });

  it('computes current and best streaks', () => {
    const byDay = new Map([
      ['2026-11-01', MIN],
      ['2026-11-02', MIN],
      ['2026-11-03', MIN],
      ['2026-11-08', MIN],
      ['2026-11-09', MIN],
    ]);
    expect(focusStreak(byDay, '2026-11-10')).toEqual({ current: 2, best: 3 });
    expect(focusStreak(byDay, '2026-11-12')).toEqual({ current: 0, best: 3 });
  });

  it('builds hour-of-day distribution', () => {
    const h = hourOfDayDistribution([session({}), session({ startedAt: at(9, 21), endedAt: at(9, 21, 25) })]);
    expect(h[9]).toBe(25 * MIN);
    expect(h[21]).toBe(25 * MIN);
  });

  it('compares periods', () => {
    const byDay = new Map([
      ['2026-11-02', 60 * MIN],
      ['2026-11-09', 90 * MIN],
    ]);
    expect(comparePeriods(byDay, '2026-11-09', 7)).toEqual({ current: 90 * MIN, previous: 60 * MIN, deltaPct: 0.5 });
  });

  it('heatmap ends on the Sunday of the current week and scales levels', () => {
    const cells = heatmap(new Map([['2026-11-10', 100]]), '2026-11-10', 2);
    expect(cells).toHaveLength(14);
    expect(cells.at(-1)?.date).toBe('2026-11-15');
    expect(cells.find((c) => c.date === '2026-11-10')?.level).toBe(4);
  });

  it('aggregates top apps', () => {
    const rows = [
      { id: '1', appId: 'a', appName: 'A', startedAt: 0, endedAt: 1, durationMs: 5, platform: 'macos' as const, source: 't' },
      { id: '2', appId: 'b', appName: 'B', startedAt: 0, endedAt: 1, durationMs: 9, platform: 'macos' as const, source: 't' },
      { id: '3', appId: 'a', appName: 'A', startedAt: 0, endedAt: 1, durationMs: 6, platform: 'macos' as const, source: 't' },
    ];
    expect(topApps(rows).map((r) => [r.key, r.ms])).toEqual([
      ['a', 11],
      ['b', 9],
    ]);
  });

  it('escapes CSV and neutralizes formulas', () => {
    expect(toCsv([{ a: 'x,y', b: '=HYPERLINK()' }])).toBe('a,b\r\n"x,y",\'=HYPERLINK()\r\n');
  });
});
