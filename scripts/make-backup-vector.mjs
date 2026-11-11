// Writes a known-answer encrypted backup used by the Rust and Kotlin tests to prove the
// three implementations share one file format.
import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const passphrase = 'monk-vector-passphrase';
const iterations = 100_000;
const salt = randomBytes(16);
const nonce = randomBytes(12);
const header = Buffer.from(JSON.stringify({ magic: 'MONKBAK1', kdf: 'PBKDF2-HMAC-SHA256', iterations, salt: salt.toString('base64'), nonce: nonce.toString('base64'), cipher: 'AES-256-GCM' }));
const payload = Buffer.from(JSON.stringify({ format: 'monk-mode-backup', formatVersion: 1, schemaVersion: 1, exportedAt: 1_800_000_000_000, platform: 'vector', appVersion: '1.0.0', tables: { tasks: [{ id: 'vector-task', title: 'Cross-platform backup works', priority: 1, status: 'todo', created_at: 1, updated_at: 1 }] } }));
const key = pbkdf2Sync(passphrase, salt, iterations, 32, 'sha256');
const c = createCipheriv('aes-256-gcm', key, nonce);
c.setAAD(header);
const ct = Buffer.concat([c.update(payload), c.final(), c.getAuthTag()]);
const len = Buffer.alloc(4);
len.writeUInt32BE(header.length);
writeFileSync(new URL('../packages/shared-core/vectors/backup-v1.monkbak', import.meta.url), Buffer.concat([Buffer.from('MONKBAK1'), len, header, ct]));
process.stdout.write(`wrote vector (${passphrase})\n`);
