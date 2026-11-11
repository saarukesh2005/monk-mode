import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { BACKUP_TABLES } from '@monk/shared-core';
import { MIGRATIONS } from '../src';

// Loaded via require: Vite does not yet list node:sqlite as a builtin.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

function openDb(): InstanceType<typeof DatabaseSync> {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const m of MIGRATIONS) db.exec(readFileSync(new URL(`../migrations/${m}`, import.meta.url), 'utf8'));
  return db;
}

const now = Date.now();

describe('schema', () => {
  it('applies cleanly and passes integrity checks', () => {
    const db = openDb();
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('contains every table the backup format exports', () => {
    const db = openDb();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    for (const t of BACKUP_TABLES) expect(tables).toContain(t);
  });

  it('allows only one live timer', () => {
    const db = openDb();
    const ins = db.prepare("INSERT INTO focus_sessions (id, mode, phase, status, planned_ms, started_at, created_at, updated_at) VALUES (?, 'pomodoro', 'focus', 'running', 1500000, ?, ?, ?)");
    ins.run('a', now, now, now);
    ins.run('b', now, now, now);
    db.prepare('INSERT INTO timer_state (singleton, session_id, updated_at) VALUES (1, ?, ?)').run('a', now);
    expect(() => db.prepare('INSERT INTO timer_state (singleton, session_id, updated_at) VALUES (1, ?, ?)').run('b', now)).toThrow();
    expect(() => db.prepare('INSERT INTO timer_state (singleton, session_id, updated_at) VALUES (2, ?, ?)').run('b', now)).toThrow();
  });

  it('enforces check constraints', () => {
    const db = openDb();
    expect(() => db.prepare("INSERT INTO tasks (id, title, priority, created_at, updated_at) VALUES ('t', 'x', 9, 0, 0)").run()).toThrow();
    expect(() => db.prepare("INSERT INTO schedules (id, name, list_id, days_mask, start_minute, end_minute, created_at, updated_at) VALUES ('s','n','missing',0,0,0,0,0)").run()).toThrow();
  });

  it('cascades subtasks and rules', () => {
    const db = openDb();
    db.exec("INSERT INTO tasks (id, title, created_at, updated_at) VALUES ('p', 'parent', 0, 0)");
    db.exec("INSERT INTO tasks (id, parent_id, title, created_at, updated_at) VALUES ('c', 'p', 'child', 0, 0)");
    db.exec("INSERT INTO blocklists (id, name, created_at, updated_at) VALUES ('l', 'List', 0, 0)");
    db.exec("INSERT INTO block_rules (id, list_id, type, value, created_at) VALUES ('r', 'l', 'domain', 'x.com', 0)");
    db.exec("DELETE FROM tasks WHERE id = 'p'");
    db.exec("DELETE FROM blocklists WHERE id = 'l'");
    expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM block_rules').get()).toEqual({ n: 0 });
  });
});
