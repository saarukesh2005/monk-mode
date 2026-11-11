import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimerSnapshot } from '@monk/shared-types';
import { elapsedMs, remainingMs } from '@monk/shared-core';
import { list, type ListQuery } from './db';
import { call, errorMessage, on } from './ipc';

export interface AsyncState<T> {
  data: T;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Loads a table and reloads automatically when the backend reports a change to it. */
export function useTable<T>(table: string, query: ListQuery = {}, deps: unknown[] = []): AsyncState<T[]> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const queryKey = JSON.stringify(query);
  const seq = useRef(0);

  const load = useCallback(() => {
    const id = ++seq.current;
    list<T>(table, JSON.parse(queryKey) as ListQuery)
      .then((rows) => {
        if (id !== seq.current) return;
        setData(rows);
        setError(null);
      })
      .catch((e) => id === seq.current && setError(errorMessage(e)))
      .finally(() => id === seq.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, queryKey, ...deps]);

  useEffect(() => {
    load();
    return on<string>('monk://data', (what) => {
      if (what === table || what === '*') load();
    });
  }, [load, table]);

  return { data, loading, error, reload: load };
}

/** Generic async loader for commands. */
export function useCommand<T>(command: string, initial: T, events: Parameters<typeof on>[0][] = []): AsyncState<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const eventsKey = events.join(',');
  const load = useCallback(() => {
    call<T>(command)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [command]);
  useEffect(() => {
    load();
    const offs = eventsKey ? eventsKey.split(',').map((ev) => on(ev as Parameters<typeof on>[0], () => load())) : [];
    return () => offs.forEach((off) => off());
  }, [load, eventsKey]);
  return { data, loading, error, reload: load };
}

/** Re-renders every `ms`. Only for display; all timing comes from persisted timestamps. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export interface LiveTimer {
  snapshot: TimerSnapshot | null;
  elapsed: number;
  remaining: number | null;
  reload: () => void;
}

/** The live timer: state from the Rust engine, display values derived from timestamps. */
export function useTimer(): LiveTimer {
  const { data, reload } = useCommand<TimerSnapshot | null>('focus_snapshot', null, ['monk://timer', 'monk://data']);
  const now = useNow(data?.session?.status === 'running' ? 250 : 5000);
  const s = data?.session ?? null;
  // The backend completes due phases within ~1.5 s; poll so the UI follows promptly.
  useEffect(() => {
    if (!s || s.status !== 'running' || s.plannedMs == null) return;
    if (remainingMs(s, now) === 0) reload();
  }, [s, now, reload]);
  return {
    snapshot: data,
    elapsed: s ? elapsedMs(s, now) : 0,
    remaining: s ? remainingMs(s, now) : null,
    reload,
  };
}

export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const key = [(e.metaKey || e.ctrlKey) && 'mod', e.shiftKey && 'shift', e.key.toLowerCase()].filter(Boolean).join('+');
      const handler = ref.current[key];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);
}
