import { describe, expect, it } from 'vitest';
import { cleanText, isLocalDate, parseTimeOfDay, validateDurationMin, validateRule, validateSchedule, validateTask } from '../src';

describe('validation', () => {
  it('cleans control characters and trims', () => expect(cleanText('  hi\u0000 there ', 100)).toBe('hi there'));
  it('validates real calendar dates', () => {
    expect(isLocalDate('2026-02-28')).toBe(true);
    expect(isLocalDate('2026-02-30')).toBe(false);
  });
  it('requires task titles', () => expect(validateTask({ title: '   ' }).ok).toBe(false));
  it('requires a due date for recurring tasks', () => {
    const r = validateTask({ title: 'Run', recurrence: 'daily' });
    expect(r.ok).toBe(false);
  });
  it('accepts a complete task', () => {
    const r = validateTask({ title: ' Read ', priority: 2, dueDate: '2026-11-10', recurrence: 'weekly' });
    expect(r).toEqual({ ok: true, value: { title: 'Read', notes: '', priority: 2, dueDate: '2026-11-10', recurrence: 'weekly' } });
  });
  it('normalizes domain rules', () => expect(validateRule('domain', 'https://www.reddit.com/r/x')).toEqual({ ok: true, value: 'reddit.com' }));
  it('rejects wildcard app rules', () => expect(validateRule('app', '*').ok).toBe(false));
  it('validates android package names', () => {
    expect(validateRule('app', 'com.instagram.android', 'android').ok).toBe(true);
    expect(validateRule('app', 'Instagram', 'android').ok).toBe(false);
  });
  it('validates schedules', () => {
    expect(validateSchedule({ name: 'Work', daysMask: 0, startMinute: 0, endMinute: 10, listId: 'l' }).ok).toBe(false);
    expect(validateSchedule({ name: 'Work', daysMask: 31, startMinute: 540, endMinute: 1020, listId: 'l' }).ok).toBe(true);
  });
  it('validates durations', () => {
    expect(validateDurationMin('25').ok).toBe(true);
    expect(validateDurationMin(2.5).ok).toBe(false);
    expect(validateDurationMin(0).ok).toBe(false);
  });
  it('parses time of day', () => {
    expect(parseTimeOfDay('09:30')).toBe(570);
    expect(parseTimeOfDay('24:00')).toBeNull();
  });
});
