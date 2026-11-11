//! Typed access to the JSON-valued `settings` table. Defaults mirror apps/desktop/src/lib/settings.ts.

use crate::db::now_ms;
use crate::error::AppResult;
use rusqlite::{params, Connection, OptionalExtension};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

pub fn get<T: DeserializeOwned>(conn: &Connection, key: &str, default: T) -> T {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
        .optional()
        .ok()
        .flatten();
    raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(default)
}

pub fn set<T: Serialize>(conn: &Connection, key: &str, value: &T) -> AppResult<()> {
    let json = serde_json::to_string(value)?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
        params![key, json, now_ms()],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroConfig {
    pub focus_min: i64,
    pub short_break_min: i64,
    pub long_break_min: i64,
    pub long_break_every: i64,
    pub auto_start_breaks: bool,
    pub auto_start_focus: bool,
}

impl Default for PomodoroConfig {
    fn default() -> Self {
        Self {
            focus_min: 25,
            short_break_min: 5,
            long_break_min: 15,
            long_break_every: 4,
            auto_start_breaks: true,
            auto_start_focus: false,
        }
    }
}

pub fn pomodoro(conn: &Connection) -> PomodoroConfig {
    get(conn, "pomodoro", PomodoroConfig::default())
}

pub fn flag(conn: &Connection, key: &str, default: bool) -> bool {
    get(conn, key, default)
}

pub fn int(conn: &Connection, key: &str, default: i64) -> i64 {
    get(conn, key, default)
}

/// The shared secret the browser extension must present. Generated once per installation.
pub fn extension_token(conn: &Connection) -> AppResult<String> {
    let existing: String = get(conn, "extensionToken", String::new());
    if existing.len() >= 32 {
        return Ok(existing);
    }
    use rand::RngCore;
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    set(conn, "extensionToken", &token)?;
    Ok(token)
}
