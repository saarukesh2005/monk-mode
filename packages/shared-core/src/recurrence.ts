import type { CalendarEvent, EpochMs, EventOccurrence, LocalDate, Recurrence } from '@monk/shared-types';
import { addDays, addMonths, DAY_MS, localDateKey, parseLocalDate, weekdayIndex } from './time';

/** Next due date for a recurring task after `from`. Returns null for non-recurring tasks. */
export function nextOccurrenceDate(from: LocalDate, recurrence: Recurrence): LocalDate | null {
  switch (recurrence) {
    case 'none':
      return null;
    case 'daily':
      return addDays(from, 1);
    case 'weekly':
      return addDays(from, 7);
    case 'monthly':
      return addMonths(from, 1);
    case 'weekdays': {
      let next = addDays(from, 1);
      while (weekdayIndex(parseLocalDate(next)) > 4) next = addDays(next, 1);
      return next;
    }
  }
}

function occursOn(event: CalendarEvent, date: LocalDate): boolean {
  const first = localDateKey(event.startAt);
  if (date < first) return false;
  const d = parseLocalDate(date);
  const f = parseLocalDate(first);
  switch (event.recurrence) {
    case 'none':
      return date === first;
    case 'daily':
      return true;
    case 'weekdays':
      return weekdayIndex(d) <= 4;
    case 'weekly':
      return weekdayIndex(d) === weekdayIndex(f);
    case 'monthly':
      return d.getDate() === f.getDate();
  }
}

/** Expands events (including recurring ones) into concrete occurrences overlapping [from, to). */
export function expandEvents(events: CalendarEvent[], from: EpochMs, to: EpochMs): EventOccurrence[] {
  const out: EventOccurrence[] = [];
  const firstDay = localDateKey(from);
  const lastDay = localDateKey(to - 1);
  for (const ev of events) {
    const duration = ev.endAt - ev.startAt;
    const start = new Date(ev.startAt);
    for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
      if (!occursOn(ev, day)) continue;
      const d = parseLocalDate(day);
      const occStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), start.getHours(), start.getMinutes()).getTime();
      const occEnd = occStart + duration;
      if (occEnd < from || occStart >= to) continue;
      out.push({ eventId: ev.id, title: ev.title, kind: ev.kind, startAt: occStart, endAt: occEnd, allDay: ev.allDay });
    }
  }
  return out.sort((a, b) => a.startAt - b.startAt);
}

export const EVENT_RANGE_GUARD_MS = 400 * DAY_MS;
