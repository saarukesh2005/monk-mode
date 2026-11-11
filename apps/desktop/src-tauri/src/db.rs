//! SQLite connection management and migrations. The migration files are shared verbatim
//! with the Android app (packages/database/migrations).

use crate::error::AppResult;
use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

pub const MIGRATIONS: &[(&str, &str)] = &[(
    "0001_init.sql",
    include_str!("../../../../packages/database/migrations/0001_init.sql"),
)];

pub const SCHEMA_VERSION: i64 = MIGRATIONS.len() as i64;

#[derive(Clone)]
pub struct Db(Arc<Mutex<Connection>>);

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> AppResult<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> AppResult<Self> {
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;",
        )?;
        migrate(&mut conn)?;
        Ok(Self(Arc::new(Mutex::new(conn))))
    }

    /// Locks the connection. A poisoned lock (panic in another thread) is recovered because
    /// SQLite transactions guarantee the data itself is consistent.
    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

pub fn migrate(conn: &mut Connection) -> AppResult<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, (_name, sql)) in MIGRATIONS.iter().enumerate() {
        let version = i as i64 + 1;
        if version <= current {
            continue;
        }
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn integrity_check(conn: &Connection) -> AppResult<Vec<String>> {
    let mut problems = Vec::new();
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if integrity != "ok" {
        problems.push(format!("integrity: {integrity}"));
    }
    let mut stmt = conn.prepare("PRAGMA foreign_key_check")?;
    let fk: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .filter_map(Result::ok)
        .map(|t| format!("foreign key violation in {t}"))
        .collect();
    problems.extend(fk);
    Ok(problems)
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_to_current_version_and_is_idempotent() {
        let db = Db::open_in_memory().unwrap();
        let mut conn = db.conn();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, SCHEMA_VERSION);
        migrate(&mut conn).unwrap();
        assert!(integrity_check(&conn).unwrap().is_empty());
    }

    #[test]
    fn foreign_keys_are_enforced() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let err = conn.execute(
            "INSERT INTO block_rules (id, list_id, type, value, created_at) VALUES ('r','missing','domain','x.com',0)",
            [],
        );
        assert!(err.is_err());
    }
}
