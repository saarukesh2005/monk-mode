import { describe, expect, it } from 'vitest';
import type { Blocklist, BlockRule, CalendarEvent, Schedule } from '@monk/shared-types';
import {
  addDays,
  addMonths,
  appMatches,
  describeDays,
  expandEvents,
  formatDuration,
  nextOccurrenceDate,
  normalizeUrlPattern,
  plannedMsFor,
  DEFAULT_POMODORO,
  resolveActiveBlockSet,
  validateBackupPayload,
  passphraseStrength,
  type BlockInputs,
} from '../src';

describe('time helpers', () => {
  it('adds days across month ends', () => expect(addDays('2026-01-31', 1)).toBe('2026-02-01'));
  it('clamps month arithmetic to the last day', () => expect(addMonths('2026-01-31', 1)).toBe('2026-02-28'));
  it('formats durations', () => {
    expect(formatDuration(90 * 60_000)).toBe('1h 30m');
    expect(formatDuration(65_000, { seconds: true })).toBe('01:05');
    expect(formatDuration(3_725_000, { seconds: true })).toBe('1:02:05');
  });
});

describe('recurrence', () => {
  it('weekday recurrence skips the weekend', () => expect(nextOccurrenceDate('2026-11-13', 'weekdays')).toBe('2026-11-16'));
  it('monthly recurrence', () => expect(nextOccurrenceDate('2026-11-10', 'monthly')).toBe('2026-12-10'));
  it('none returns null', () => expect(nextOccurrenceDate('2026-11-10', 'none')).toBeNull());

  it('expands weekly events within a range', () => {
    const start = new Date(2026, 10, 9, 9, 0).getTime();
    const ev: CalendarEvent = { id: 'e', title: 'Standup', kind: 'event', startAt: start, endAt: start + 30 * 60_000, allDay: false, recurrence: 'weekly', subjectId: null, notes: '', createdAt: 0, updatedAt: 0 };
    const occ = expandEvents([ev], new Date(2026, 10, 1).getTime(), new Date(2026, 11, 1).getTime());
    expect(occ.map((o) => new Date(o.startAt).getDate())).toEqual([9, 16, 23, 30]);
  });

  it('does not expand before the first occurrence', () => {
    const start = new Date(2026, 10, 20, 9, 0).getTime();
    const ev: CalendarEvent = { id: 'e', title: 'Gym', kind: 'event', startAt: start, endAt: start + 60_000, allDay: false, recurrence: 'daily', subjectId: null, notes: '', createdAt: 0, updatedAt: 0 };
    expect(expandEvents([ev], new Date(2026, 10, 1).getTime(), new Date(2026, 10, 22).getTime())).toHaveLength(2);
  });
});

describe('matching helpers', () => {
  it('normalizes url patterns', () => expect(normalizeUrlPattern('https://www.YouTube.com/shorts/*')).toBe('youtube.com/shorts/*'));
  it('rejects patterns without a path', () => expect(normalizeUrlPattern('youtube.com')).toBeNull());
  it('matches apps by name, exe and bundle path', () => {
    expect(appMatches('Discord', ['/Applications/Discord.app'])).toBe(true);
    expect(appMatches('steam', ['C:\\Program Files\\Steam\\steam.exe'])).toBe(true);
    expect(appMatches('com.instagram.android', ['com.instagram.android'])).toBe(true);
    expect(appMatches('code', ['/usr/bin/codex'])).toBe(false);
  });
  it('describes day masks', () => {
    expect(describeDays(31)).toBe('Weekdays');
    expect(describeDays(5)).toBe('Mon, Wed');
  });
});

describe('focus durations', () => {
  it('uses the pomodoro setting', () => expect(plannedMsFor('pomodoro', undefined, DEFAULT_POMODORO)).toBe(25 * 60_000));
  it('stopwatch is open ended', () => expect(plannedMsFor('stopwatch', 30, DEFAULT_POMODORO)).toBeNull());
  it('rejects invalid durations', () => expect(() => plannedMsFor('custom', 0, DEFAULT_POMODORO)).toThrow());
});

describe('active block set', () => {
  const list = (id: string, kind: Blocklist['kind'] = 'block', blockDuringFocus = true): Blocklist => ({ id, name: id, kind, enabled: true, blockDuringFocus, createdAt: 0, updatedAt: 0 });
  const rule = (listId: string, type: BlockRule['type'], value: string, platform: BlockRule['platform'] = 'all'): BlockRule => ({ id: `${listId}-${value}`, listId, type, value, label: '', platform, createdAt: 0 });
  const base: BlockInputs = {
    now: new Date(2026, 10, 9, 10, 0).getTime(),
    platform: 'macos',
    lists: [list('work'), list('allow', 'allow')],
    rules: [rule('work', 'domain', 'reddit.com'), rule('work', 'app', 'Discord'), rule('work', 'app', 'com.x.android', 'android'), rule('work', 'category', 'short-feeds'), rule('allow', 'domain', 'old.reddit.com')],
    schedules: [],
    quickBlocks: [],
    focusActive: false,
    strictListIds: [],
    exceptions: [],
    limitExceeded: [],
  };

  it('is inactive when nothing triggers', () => {
    expect(resolveActiveBlockSet(base).active).toBe(false);
  });

  it('activates lists during focus and filters by platform', () => {
    const set = resolveActiveBlockSet({ ...base, focusActive: true });
    expect(set.active).toBe(true);
    expect(set.triggers).toEqual(['focus']);
    expect(set.apps).toEqual(['Discord']);
    expect(set.domains).toContain('reddit.com');
    expect(set.domains).toContain('tiktok.com');
    expect(set.urlPatterns).toContain('youtube.com/shorts*');
    expect(set.allowDomains).toEqual(['old.reddit.com']);
  });

  it('activates by schedule', () => {
    const sched: Schedule = { id: 's', name: 'Work', listId: 'work', daysMask: 31, startMinute: 540, endMinute: 1020, strict: false, enabled: true, createdAt: 0, updatedAt: 0 };
    expect(resolveActiveBlockSet({ ...base, schedules: [sched] }).triggers).toEqual(['schedule']);
  });

  it('exceptions are ignored for strict targets', () => {
    const ex = { id: 'x', type: 'app' as const, value: 'Discord', reason: '', untilAt: base.now + 60_000, createdAt: 0 };
    expect(resolveActiveBlockSet({ ...base, focusActive: true, exceptions: [ex] }).apps).toEqual([]);
    const strictSet = resolveActiveBlockSet({ ...base, strictListIds: ['work'], exceptions: [ex] });
    expect(strictSet.apps).toEqual(['Discord']);
    expect(strictSet.strict).toBe(true);
  });

  it('expired quick blocks do not apply', () => {
    const q = { id: 'q', listId: 'work', startedAt: base.now - 120_000, endsAt: base.now - 60_000, endedAt: null };
    expect(resolveActiveBlockSet({ ...base, quickBlocks: [q] }).active).toBe(false);
  });
});

describe('backup validation', () => {
  it('accepts a valid payload', () => {
    expect(validateBackupPayload({ format: 'monk-mode-backup', formatVersion: 1, tables: { tasks: [] } }).ok).toBe(true);
  });
  it('rejects unknown tables and newer formats', () => {
    const r = validateBackupPayload({ format: 'monk-mode-backup', formatVersion: 99, tables: { evil: [] } });
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
  });
  it('rates passphrases', () => {
    expect(passphraseStrength('short')).toBe('too-short');
    expect(passphraseStrength('correct horse battery staple')).toBe('strong');
  });
});
