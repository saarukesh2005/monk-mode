import type { BlockRule, Recurrence, RuleType, Schedule, Task } from '@monk/shared-types';
import { RECURRENCES } from '@monk/shared-types';
import { normalizeDomain, normalizeUrlPattern, presetById } from '@monk/shared-core';

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const err = <T>(...errors: string[]): Result<T> => ({ ok: false, errors });

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// Control characters except tab/newline are stripped from user text.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function cleanText(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return '';
  return input.replace(CONTROL_RE, '').trim().slice(0, maxLength);
}

export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function isColor(value: unknown): value is string {
  return typeof value === 'string' && COLOR_RE.test(value);
}

export interface TaskInput {
  title: unknown;
  notes?: unknown;
  priority?: unknown;
  dueDate?: unknown;
  recurrence?: unknown;
}

export function validateTask(input: TaskInput): Result<Pick<Task, 'title' | 'notes' | 'priority' | 'dueDate' | 'recurrence'>> {
  const errors: string[] = [];
  const title = cleanText(input.title, 300);
  if (!title) errors.push('Title is required');
  const priority = input.priority ?? 0;
  if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 0 || priority > 3) errors.push('Priority must be 0–3');
  const dueDate = input.dueDate == null || input.dueDate === '' ? null : input.dueDate;
  if (dueDate !== null && !isLocalDate(dueDate)) errors.push('Due date must be a valid YYYY-MM-DD date');
  const recurrence = (input.recurrence ?? 'none') as Recurrence;
  if (!RECURRENCES.includes(recurrence)) errors.push('Unknown recurrence');
  if (recurrence !== 'none' && dueDate === null) errors.push('Recurring tasks need a due date');
  if (errors.length) return { ok: false, errors };
  return ok({ title, notes: cleanText(input.notes, 10_000), priority: priority as Task['priority'], dueDate: dueDate as string | null, recurrence });
}

const APP_RE = /^[\w .,()&+'@-]+$/u;
const ANDROID_PACKAGE_RE = /^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/;

/** Validates and normalizes a block/allow rule value for its type. */
export function validateRule(type: RuleType, rawValue: unknown, platform: BlockRule['platform'] = 'all'): Result<string> {
  const value = cleanText(rawValue, 500);
  if (!value) return err('Value is required');
  switch (type) {
    case 'domain': {
      const d = normalizeDomain(value);
      return d ? ok(d) : err(`"${value}" is not a valid domain`);
    }
    case 'url_pattern': {
      const p = normalizeUrlPattern(value);
      return p ? ok(p) : err('URL patterns look like example.com/path/*');
    }
    case 'category':
      return presetById(value) ? ok(value) : err('Unknown category');
    case 'app': {
      if (value === '*') return err('Blocking every application is not allowed');
      if (platform === 'android') return ANDROID_PACKAGE_RE.test(value) ? ok(value) : err('Android apps are identified by package name, e.g. com.instagram.android');
      if (value.includes('/') || value.includes('\\')) return ok(value);
      return APP_RE.test(value) ? ok(value) : err('App names may only contain letters, numbers, spaces and . , ( ) & + \' @ -');
    }
  }
}

export function validateSchedule(input: Pick<Schedule, 'name' | 'daysMask' | 'startMinute' | 'endMinute' | 'listId'>): Result<typeof input> {
  const errors: string[] = [];
  const name = cleanText(input.name, 80);
  if (!name) errors.push('Name is required');
  if (!Number.isInteger(input.daysMask) || input.daysMask < 1 || input.daysMask > 127) errors.push('Pick at least one day');
  for (const [label, v] of [['Start', input.startMinute], ['End', input.endMinute]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 1439) errors.push(`${label} time is invalid`);
  }
  if (!input.listId) errors.push('Choose a blocklist');
  return errors.length ? { ok: false, errors } : ok({ ...input, name });
}

export function validateDurationMin(value: unknown, min = 1, max = 600): Result<number> {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return err('Enter a whole number of minutes');
  if (n < min || n > max) return err(`Enter between ${min} and ${max} minutes`);
  return ok(n);
}

export function parseTimeOfDay(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}
