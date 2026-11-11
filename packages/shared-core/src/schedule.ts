import type { Schedule } from '@monk/shared-types';
import { minutesOfDay, weekdayIndex } from './time';

export const ALL_DAYS_MASK = 0b1111111;
export const WEEKDAYS_MASK = 0b0011111;
export const WEEKEND_MASK = 0b1100000;
export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export type ScheduleWindow = Pick<Schedule, 'daysMask' | 'startMinute' | 'endMinute'>;

const dayInMask = (mask: number, day: number): boolean => (mask & (1 << day)) !== 0;

/**
 * Whether a recurring window is active at a local time.
 * - start < end: same-day window [start, end)
 * - start > end: overnight window; the part after midnight belongs to the previous day's schedule
 * - start == end: the whole day
 */
export function isWindowActive(window: ScheduleWindow, at: Date): boolean {
  const day = weekdayIndex(at);
  const minute = minutesOfDay(at);
  const { daysMask, startMinute, endMinute } = window;
  if (startMinute === endMinute) return dayInMask(daysMask, day);
  if (startMinute < endMinute) {
    return dayInMask(daysMask, day) && minute >= startMinute && minute < endMinute;
  }
  const previousDay = (day + 6) % 7;
  return (dayInMask(daysMask, day) && minute >= startMinute) || (dayInMask(daysMask, previousDay) && minute < endMinute);
}

export function isScheduleActive(schedule: Schedule, at: Date): boolean {
  return schedule.enabled && isWindowActive(schedule, at);
}

export function describeDays(mask: number): string {
  if (mask === ALL_DAYS_MASK) return 'Every day';
  if (mask === WEEKDAYS_MASK) return 'Weekdays';
  if (mask === WEEKEND_MASK) return 'Weekends';
  return DAY_LABELS.filter((_, i) => dayInMask(mask, i)).join(', ');
}

export function toggleDay(mask: number, day: number): number {
  return mask ^ (1 << day);
}
