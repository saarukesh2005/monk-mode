// Typed loaders for the entities the pages share.
import type { Blocklist, BlockRule, CalendarEvent, Category, FocusSession, Schedule, Subject, Task, Topic } from '@monk/shared-types';
import { useTable } from './hooks';
import { where } from './db';

const DAY = 86_400_000;

export const useCategories = () => useTable<Category>('categories', { orderBy: 'name' });
export const useSubjects = () => useTable<Subject>('subjects', { orderBy: 'name' });
export const useTopics = () => useTable<Topic>('topics', { orderBy: 'created_at' });
export const useTasks = () => useTable<Task>('tasks', { orderBy: 'sort_order' });
export const useBlocklists = () => useTable<Blocklist>('blocklists', { orderBy: 'created_at' });
export const useRules = () => useTable<BlockRule>('block_rules', { orderBy: 'created_at' });
export const useSchedules = () => useTable<Schedule>('schedules', { orderBy: 'start_minute' });
export const useEvents = () => useTable<CalendarEvent>('events', { orderBy: 'start_at' });

/** Finished and live sessions that started within the last `days` days. */
export function useSessionsSince(days: number) {
  const since = Math.floor((Date.now() - days * DAY) / DAY) * DAY;
  return useTable<FocusSession>('focus_sessions', { filters: [where('started_at', 'gte', since)], orderBy: 'started_at', desc: true, limit: 50_000 }, [since]);
}
