import { call } from './ipc';

// Rows travel as snake_case (SQLite column names); the UI uses camelCase shared types.
const BOOL_COLUMNS = new Set(['enabled', 'archived', 'all_day', 'block_during_focus', 'strict', 'read']);
const JSON_COLUMNS = new Set(['priorities']);

const toCamel = (s: string): string => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const toSnake = (s: string): string => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export function fromRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (BOOL_COLUMNS.has(k)) out[toCamel(k)] = v === 1 || v === true;
    else if (JSON_COLUMNS.has(k) && typeof v === 'string') {
      try {
        out[toCamel(k)] = JSON.parse(v);
      } catch {
        out[toCamel(k)] = [];
      }
    } else out[toCamel(k)] = v;
  }
  return out as T;
}

export function toRow(obj: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || k === 'tags') continue;
    const key = toSnake(k);
    out[key] = JSON_COLUMNS.has(key) && typeof v !== 'string' ? JSON.stringify(v) : v;
  }
  return out;
}

export type Op = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'isnull' | 'notnull';
export interface Filter {
  column: string;
  op: Op;
  value?: unknown;
}
export interface ListQuery {
  filters?: Filter[];
  orderBy?: string;
  desc?: boolean;
  limit?: number;
}

export const where = (column: string, op: Op, value?: unknown): Filter => ({ column, op, value });

export async function list<T>(table: string, query: ListQuery = {}): Promise<T[]> {
  const rows = await call<Record<string, unknown>[]>('db_list', { table, query });
  return rows.map((r) => fromRow<T>(r));
}

export async function save<T>(table: string, obj: object): Promise<T> {
  const row = await call<Record<string, unknown>>('db_upsert', { table, row: toRow(obj) });
  return fromRow<T>(row);
}

export async function remove(table: string, key: Record<string, unknown>): Promise<void> {
  await call('db_delete', { table, key });
}
