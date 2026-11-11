import { BACKUP_FORMAT_VERSION, type BackupPayload } from '@monk/shared-types';

/** Tables included in a backup, in foreign-key-safe insertion order. */
export const BACKUP_TABLES = [
  'categories',
  'subjects',
  'topics',
  'tasks',
  'tags',
  'task_tags',
  'focus_sessions',
  'blocklists',
  'block_rules',
  'schedules',
  'quick_blocks',
  'usage_limits',
  'exceptions',
  'strict_sessions',
  'strict_session_lists',
  'strict_events',
  'block_events',
  'app_usage',
  'web_usage',
  'events',
  'daily_plans',
  'notifications',
  'settings',
] as const;

/** Device-local settings that must never be copied to another device by a restore. */
export const DEVICE_LOCAL_SETTINGS = ['extensionToken', 'hostsBlockingEnabled', 'startOnLogin'] as const;

export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 8;

export interface BackupValidation {
  ok: boolean;
  errors: string[];
}

export function validateBackupPayload(value: unknown): BackupValidation {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null) return { ok: false, errors: ['Backup is not a JSON object'] };
  const p = value as Partial<BackupPayload>;
  if (p.format !== 'monk-mode-backup') errors.push('Not a MONK MODE backup file');
  if (typeof p.formatVersion !== 'number' || p.formatVersion > BACKUP_FORMAT_VERSION) {
    errors.push('Backup was created by a newer version of MONK MODE');
  }
  if (typeof p.tables !== 'object' || p.tables === null) errors.push('Backup has no tables');
  else {
    for (const [name, rows] of Object.entries(p.tables)) {
      if (!(BACKUP_TABLES as readonly string[]).includes(name)) errors.push(`Unknown table: ${name}`);
      if (!Array.isArray(rows)) errors.push(`Table ${name} is not a list`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function passphraseStrength(pass: string): 'too-short' | 'weak' | 'ok' | 'strong' {
  if (pass.length < MIN_PASSPHRASE_LENGTH) return 'too-short';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((r) => r.test(pass)).length;
  if (pass.length >= 16 || (pass.length >= 12 && classes >= 3)) return 'strong';
  return classes >= 2 ? 'ok' : 'weak';
}
