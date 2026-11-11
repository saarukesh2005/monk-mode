//! Encrypted, portable backups. The same format is implemented by the Android app
//! (BackupCrypto.kt), so a backup made on one device can be restored on another.
//!
//! File layout: b"MONKBAK1" | u32 BE header length | header JSON | AES-256-GCM ciphertext+tag
//! Key: PBKDF2-HMAC-SHA256(passphrase, salt, iterations) → 32 bytes. The header is bound as
//! AES-GCM associated data, so tampering with it fails decryption. The passphrase (the key
//! material) is never stored anywhere.

use crate::db::now_ms;
use crate::error::{AppError, AppResult};
use crate::repo::{json_to_sql, query_json};
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rand::RngCore;
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as Json};

pub const MAGIC: &[u8; 8] = b"MONKBAK1";
pub const ITERATIONS: u32 = 600_000;
pub const MIN_PASSPHRASE: usize = 8;
pub const FORMAT_VERSION: i64 = 1;

/// Insertion order respects foreign keys. Mirrors BACKUP_TABLES in shared-core/backup.ts.
pub const BACKUP_TABLES: &[&str] = &[
    "categories", "subjects", "topics", "tasks", "tags", "task_tags", "focus_sessions", "blocklists",
    "block_rules", "schedules", "quick_blocks", "usage_limits", "exceptions", "strict_sessions",
    "strict_session_lists", "strict_events", "block_events", "pause_events", "app_usage", "web_usage", "events",
    "daily_plans", "notifications", "settings",
];

/// Settings that belong to this device only and are neither exported nor overwritten.
pub const DEVICE_LOCAL_SETTINGS: &[&str] = &["extensionToken", "hostsBlockingEnabled", "startOnLogin"];

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Header {
    pub magic: String,
    pub kdf: String,
    pub iterations: u32,
    pub salt: String,
    pub nonce: String,
    pub cipher: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Payload_ {
    pub format: String,
    pub format_version: i64,
    pub schema_version: i64,
    pub exported_at: i64,
    pub platform: String,
    pub app_version: String,
    pub tables: Map<String, Json>,
}

pub fn export_payload(conn: &Connection, platform: &str, app_version: &str) -> AppResult<Payload_> {
    let mut tables = Map::new();
    for t in BACKUP_TABLES {
        let mut rows = query_json(conn, &format!("SELECT * FROM {t}"), &[])?;
        if *t == "settings" {
            rows.retain(|r| !DEVICE_LOCAL_SETTINGS.contains(&r.get("key").and_then(Json::as_str).unwrap_or("")));
        }
        tables.insert((*t).to_string(), Json::Array(rows.into_iter().map(Json::Object).collect()));
    }
    let schema_version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    Ok(Payload_ {
        format: "monk-mode-backup".into(),
        format_version: FORMAT_VERSION,
        schema_version,
        exported_at: now_ms(),
        platform: platform.into(),
        app_version: app_version.into(),
        tables,
    })
}

fn derive_key(passphrase: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(passphrase.as_bytes(), salt, iterations, &mut key);
    key
}

pub fn encrypt(plaintext: &[u8], passphrase: &str) -> AppResult<Vec<u8>> {
    encrypt_with(plaintext, passphrase, ITERATIONS)
}

fn encrypt_with(plaintext: &[u8], passphrase: &str, iterations: u32) -> AppResult<Vec<u8>> {
    if passphrase.chars().count() < MIN_PASSPHRASE {
        return Err(AppError::invalid(format!("Passphrase must be at least {MIN_PASSPHRASE} characters")));
    }
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce);
    let header = Header {
        magic: "MONKBAK1".into(),
        kdf: "PBKDF2-HMAC-SHA256".into(),
        iterations,
        salt: B64.encode(salt),
        nonce: B64.encode(nonce),
        cipher: "AES-256-GCM".into(),
    };
    let header_bytes = serde_json::to_vec(&header)?;
    let key = derive_key(passphrase, &salt, iterations);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| AppError::Crypto(e.to_string()))?;
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), Payload { msg: plaintext, aad: &header_bytes })
        .map_err(|_| AppError::Crypto("Encryption failed".into()))?;
    let mut out = Vec::with_capacity(12 + header_bytes.len() + ct.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&(header_bytes.len() as u32).to_be_bytes());
    out.extend_from_slice(&header_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

pub fn decrypt(data: &[u8], passphrase: &str) -> AppResult<Vec<u8>> {
    let bad = || AppError::invalid("This is not a MONK MODE backup file");
    if data.len() < 12 || &data[..8] != MAGIC {
        return Err(bad());
    }
    let len = u32::from_be_bytes(data[8..12].try_into().map_err(|_| bad())?) as usize;
    if len > 4096 || data.len() < 12 + len {
        return Err(bad());
    }
    let header_bytes = &data[12..12 + len];
    let header: Header = serde_json::from_slice(header_bytes).map_err(|_| bad())?;
    if header.kdf != "PBKDF2-HMAC-SHA256" || header.cipher != "AES-256-GCM" || !(100_000..=10_000_000).contains(&header.iterations) {
        return Err(AppError::invalid("Unsupported backup encryption parameters"));
    }
    let salt = B64.decode(&header.salt).map_err(|_| bad())?;
    let nonce = B64.decode(&header.nonce).map_err(|_| bad())?;
    if nonce.len() != 12 {
        return Err(bad());
    }
    let key = derive_key(passphrase, &salt, header.iterations);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| AppError::Crypto(e.to_string()))?;
    cipher
        .decrypt(Nonce::from_slice(&nonce), Payload { msg: &data[12 + len..], aad: header_bytes })
        .map_err(|_| AppError::Crypto("Wrong passphrase, or the file is damaged".into()))
}

fn table_columns(conn: &Connection, table: &str) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let cols = stmt.query_map([], |r| r.get::<_, String>(1))?.collect::<Result<_, _>>()?;
    Ok(cols)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub tables: usize,
    pub rows: usize,
    pub source_platform: String,
    pub exported_at: i64,
}

/// Replaces all local data with the backup inside one transaction. Unknown columns are
/// ignored, constraint violations abort the whole restore, device-local settings are kept.
pub fn restore(conn: &mut Connection, payload: &Payload_) -> AppResult<RestoreReport> {
    if payload.format != "monk-mode-backup" {
        return Err(AppError::invalid("Not a MONK MODE backup"));
    }
    if payload.format_version > FORMAT_VERSION {
        return Err(AppError::invalid("This backup was made by a newer version of MONK MODE"));
    }
    for name in payload.tables.keys() {
        if !BACKUP_TABLES.contains(&name.as_str()) {
            return Err(AppError::invalid(format!("Backup contains an unknown table: {name}")));
        }
    }
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM timer_state", [])?;
    for t in BACKUP_TABLES.iter().rev() {
        if *t == "settings" {
            let keep: Vec<String> = DEVICE_LOCAL_SETTINGS.iter().map(|k| format!("'{k}'")).collect();
            tx.execute(&format!("DELETE FROM settings WHERE key NOT IN ({})", keep.join(",")), [])?;
        } else {
            tx.execute(&format!("DELETE FROM {t}"), [])?;
        }
    }
    let mut total = 0;
    for t in BACKUP_TABLES {
        let Some(Json::Array(rows)) = payload.tables.get(*t) else { continue };
        let cols = table_columns(&tx, t)?;
        for row in rows {
            let Json::Object(obj) = row else { return Err(AppError::invalid(format!("Malformed row in {t}"))) };
            if *t == "settings" && DEVICE_LOCAL_SETTINGS.contains(&obj.get("key").and_then(Json::as_str).unwrap_or("")) {
                continue;
            }
            let present: Vec<&String> = cols.iter().filter(|c| obj.contains_key(c.as_str())).collect();
            if present.is_empty() {
                continue;
            }
            let vals = present.iter().map(|c| json_to_sql(&obj[c.as_str()])).collect::<AppResult<Vec<_>>>()?;
            let names: Vec<&str> = present.iter().map(|c| c.as_str()).collect();
            let sql = format!("INSERT INTO {t} ({}) VALUES ({})", names.join(", "), vec!["?"; names.len()].join(", "));
            tx.execute(&sql, params_from_iter(vals.iter()))
                .map_err(|e| AppError::invalid(format!("Backup rejected ({t}): {e}")))?;
            total += 1;
        }
    }
    // Sessions that were live on the source device are closed: we cannot know what happened since.
    tx.execute(
        "UPDATE focus_sessions SET status = 'interrupted', ended_at = COALESCE(paused_at, started_at), paused_at = NULL WHERE status IN ('running','paused')",
        [],
    )?;
    tx.execute(
        "UPDATE strict_sessions SET state = 'COMPLETED', ended_at = COALESCE(ended_at, updated_at) WHERE state IN ('ACTIVE','PAUSED','PREPARING')",
        [],
    )?;
    let problems = crate::db::integrity_check(&tx)?;
    if !problems.is_empty() {
        return Err(AppError::invalid(format!("Backup rejected: {}", problems.join("; "))));
    }
    tx.commit()?;
    Ok(RestoreReport { tables: payload.tables.len(), rows: total, source_platform: payload.platform.clone(), exported_at: payload.exported_at })
}

/// Snapshot of the live database before a destructive operation (restore / wipe).
pub fn safety_snapshot(conn: &Connection, dir: &std::path::Path) -> AppResult<std::path::PathBuf> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(format!("pre-change-{}.sqlite", now_ms()));
    conn.execute("VACUUM INTO ?1", [path.to_string_lossy()])?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn seeded() -> Db {
        let db = Db::open_in_memory().unwrap();
        db.conn()
            .execute_batch(
                "INSERT INTO tasks (id, title, created_at, updated_at) VALUES ('t1','Read',1,1), ('t2','Sub',1,1);
                 UPDATE tasks SET parent_id = 't1' WHERE id = 't2';
                 INSERT INTO focus_sessions (id, mode, phase, status, planned_ms, started_at, ended_at, focused_ms, created_at, updated_at)
                   VALUES ('s1','pomodoro','focus','completed',1500000,1000,1501000,1500000,1,1);
                 INSERT INTO settings (key, value, updated_at) VALUES ('themeId','\"paper\"',1), ('extensionToken','\"secret-token-value-should-not-travel\"',1);",
            )
            .unwrap();
        db
    }

    #[test]
    fn encrypt_decrypt_round_trip_and_wrong_passphrase() {
        let ct = encrypt_with(b"hello monk", "correct horse", 100_000).unwrap();
        assert_eq!(&ct[..8], MAGIC);
        assert_eq!(decrypt(&ct, "correct horse").unwrap(), b"hello monk");
        assert!(decrypt(&ct, "wrong horse!").is_err());
        assert!(encrypt(b"x", "short").is_err());
    }

    const FIXTURE_PASS: &str = "monk-mode-fixture";
    const FIXTURE_PLAIN: &[u8] = br#"{"format":"monk-mode-backup","hello":"monk"}"#;

    /// Regenerate with: cargo test --lib write_cross_platform_fixture -- --ignored
    #[test]
    #[ignore]
    fn write_cross_platform_fixture() {
        let ct = encrypt_with(FIXTURE_PLAIN, FIXTURE_PASS, 100_000).unwrap();
        std::fs::write("../../../packages/shared-core/vectors/backup-fixture.monkbak", ct).unwrap();
    }

    #[test]
    fn decrypts_shared_fixture() {
        let data = include_bytes!("../../../../packages/shared-core/vectors/backup-fixture.monkbak");
        assert_eq!(decrypt(data, FIXTURE_PASS).unwrap(), FIXTURE_PLAIN);
    }

    #[test]
    fn decrypts_cross_platform_vector() {
        let data = include_bytes!("../../../../packages/shared-core/vectors/backup-v1.monkbak");
        let plain = decrypt(data, "monk-vector-passphrase").unwrap();
        let payload: Payload_ = serde_json::from_slice(&plain).unwrap();
        assert_eq!(payload.platform, "vector");
        let db = Db::open_in_memory().unwrap();
        restore(&mut db.conn(), &payload).unwrap();
        let title: String = db.conn().query_row("SELECT title FROM tasks", [], |r| r.get(0)).unwrap();
        assert_eq!(title, "Cross-platform backup works");
    }

    #[test]
    fn tampered_header_or_body_is_rejected() {
        let mut ct = encrypt_with(b"payload", "passphrase1", 100_000).unwrap();
        let last = ct.len() - 1;
        ct[last] ^= 1;
        assert!(decrypt(&ct, "passphrase1").is_err());
        let mut ct = encrypt_with(b"payload", "passphrase1", 100_000).unwrap();
        ct[20] ^= 1;
        assert!(decrypt(&ct, "passphrase1").is_err());
    }

    #[test]
    fn export_excludes_device_secrets_and_restores_on_another_device() {
        let src = seeded();
        let payload = export_payload(&src.conn(), "macos", "1.0.0").unwrap();
        let json = serde_json::to_string(&payload).unwrap();
        assert!(!json.contains("secret-token-value"));

        let dst = Db::open_in_memory().unwrap();
        dst.conn()
            .execute("INSERT INTO settings (key, value, updated_at) VALUES ('extensionToken','\"device-b\"',1)", [])
            .unwrap();
        dst.conn().execute("INSERT INTO tasks (id, title, created_at, updated_at) VALUES ('old','Old',1,1)", []).unwrap();
        let parsed: Payload_ = serde_json::from_str(&json).unwrap();
        let report = restore(&mut dst.conn(), &parsed).unwrap();
        assert!(report.rows >= 4);
        let c = dst.conn();
        let titles: Vec<String> = c.prepare("SELECT title FROM tasks ORDER BY title").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
        assert_eq!(titles, vec!["Read", "Sub"]);
        let token: String = c.query_row("SELECT value FROM settings WHERE key='extensionToken'", [], |r| r.get(0)).unwrap();
        assert_eq!(token, "\"device-b\"");
    }

    #[test]
    fn invalid_backup_rolls_back_completely() {
        let dst = seeded();
        let mut tables = Map::new();
        tables.insert("tasks".into(), serde_json::json!([{ "id": "x", "title": "Bad", "priority": 99, "created_at": 1, "updated_at": 1 }]));
        let payload = Payload_ { format: "monk-mode-backup".into(), format_version: 1, schema_version: 1, exported_at: 0, platform: "android".into(), app_version: "1".into(), tables };
        assert!(restore(&mut dst.conn(), &payload).is_err());
        let n: i64 = dst.conn().query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2, "original data must survive a failed restore");
        let mut tables = Map::new();
        tables.insert("sqlite_master".into(), serde_json::json!([]));
        let payload = Payload_ { format: "monk-mode-backup".into(), format_version: 1, schema_version: 1, exported_at: 0, platform: "x".into(), app_version: "1".into(), tables };
        assert!(restore(&mut dst.conn(), &payload).is_err());
    }
}
