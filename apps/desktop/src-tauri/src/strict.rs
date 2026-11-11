//! Strict-mode state machine persisted in `strict_sessions`. Mirrors
//! packages/shared-core/src/strict.ts. Every level keeps an emergency exit; stricter levels only
//! add friction (reason, cool-down, typed phrase). Nothing here can lock the user out.

use crate::db::{new_id, now_ms};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

pub const MIN_DURATION_MIN: i64 = 5;
pub const MAX_DURATION_MIN: i64 = 12 * 60;
pub const MAXIMUM_EXIT_PHRASE: &str = "I choose to end this commitment early";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExitPolicy {
    pub min_reason_length: usize,
    pub cooldown_ms: i64,
    pub phrase: Option<&'static str>,
    pub can_pause: bool,
    pub can_remove_rules: bool,
}

pub fn exit_policy(level: &str, maximum_cooldown_sec: i64) -> ExitPolicy {
    match level {
        "strict" => ExitPolicy { min_reason_length: 10, cooldown_ms: 30_000, phrase: None, can_pause: false, can_remove_rules: false },
        "maximum" => ExitPolicy {
            min_reason_length: 25,
            cooldown_ms: maximum_cooldown_sec.clamp(60, 1800) * 1000,
            phrase: Some(MAXIMUM_EXIT_PHRASE),
            can_pause: false,
            can_remove_rules: false,
        },
        _ => ExitPolicy { min_reason_length: 0, cooldown_ms: 0, phrase: None, can_pause: true, can_remove_rules: true },
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StrictSession {
    pub id: String,
    pub level: String,
    pub state: String,
    pub started_at: i64,
    pub ends_at: i64,
    pub paused_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub exit_reason: String,
    pub exit_requested_at: Option<i64>,
    pub list_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StrictStatus {
    pub session: Option<StrictSession>,
    pub policy: Option<ExitPolicy>,
    pub remaining_ms: i64,
    pub exit_available_at: Option<i64>,
    pub used_today_min: i64,
    pub daily_limit_min: i64,
}

fn from_row(r: &Row) -> rusqlite::Result<StrictSession> {
    Ok(StrictSession {
        id: r.get("id")?,
        level: r.get("level")?,
        state: r.get("state")?,
        started_at: r.get("started_at")?,
        ends_at: r.get("ends_at")?,
        paused_at: r.get("paused_at")?,
        ended_at: r.get("ended_at")?,
        exit_reason: r.get("exit_reason")?,
        exit_requested_at: r.get("exit_requested_at")?,
        list_ids: Vec::new(),
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

fn with_lists(conn: &Connection, mut s: StrictSession) -> AppResult<StrictSession> {
    let mut stmt = conn.prepare("SELECT list_id FROM strict_session_lists WHERE session_id = ?1")?;
    s.list_ids = stmt.query_map([&s.id], |r| r.get(0))?.collect::<Result<_, _>>()?;
    Ok(s)
}

pub fn active(conn: &Connection) -> AppResult<Option<StrictSession>> {
    let s = conn
        .query_row(
            "SELECT * FROM strict_sessions WHERE state IN ('ACTIVE','PAUSED') ORDER BY started_at DESC LIMIT 1",
            [],
            from_row,
        )
        .optional()?;
    s.map(|s| with_lists(conn, s)).transpose()
}

pub fn record_event(conn: &Connection, session_id: Option<&str>, kind: &str, detail: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO strict_events (id, session_id, ts, kind, detail) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![new_id(), session_id, now_ms(), kind, detail.chars().take(500).collect::<String>()],
    )?;
    Ok(())
}

/// Minutes of strict sessions started today (local time), counting planned length.
pub fn used_today_min(conn: &Connection, day_start: i64) -> AppResult<i64> {
    let ms: i64 = conn.query_row(
        "SELECT COALESCE(SUM(COALESCE(ended_at, ends_at) - started_at), 0) FROM strict_sessions WHERE started_at >= ?1",
        [day_start],
        |r| r.get(0),
    )?;
    Ok(ms / 60_000)
}

pub fn remaining_ms(s: &StrictSession, now: i64) -> i64 {
    let end = match (s.state.as_str(), s.paused_at) {
        ("PAUSED", Some(p)) => s.ends_at + (now - p),
        _ => s.ends_at,
    };
    (end - now).max(0)
}

pub fn status(conn: &Connection, now: i64, day_start: i64, daily_limit_min: i64, max_cooldown_sec: i64) -> AppResult<StrictStatus> {
    let session = active(conn)?;
    let policy = session.as_ref().map(|s| exit_policy(&s.level, max_cooldown_sec));
    let exit_available_at = match (&session, &policy) {
        (Some(s), Some(p)) => s.exit_requested_at.map(|t| t + p.cooldown_ms),
        _ => None,
    };
    Ok(StrictStatus {
        remaining_ms: session.as_ref().map(|s| remaining_ms(s, now)).unwrap_or(0),
        session,
        policy,
        exit_available_at,
        used_today_min: used_today_min(conn, day_start)?,
        daily_limit_min,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartStrict {
    pub level: String,
    pub duration_min: i64,
    pub list_ids: Vec<String>,
    pub confirmed: bool,
}

pub fn start(conn: &mut Connection, req: &StartStrict, now: i64, day_start: i64, daily_limit_min: i64) -> AppResult<StrictSession> {
    if !["normal", "strict", "maximum"].contains(&req.level.as_str()) {
        return Err(AppError::invalid("Unknown strictness level"));
    }
    if !req.confirmed {
        return Err(AppError::invalid("Please confirm your commitment first"));
    }
    if !(MIN_DURATION_MIN..=MAX_DURATION_MIN).contains(&req.duration_min) {
        return Err(AppError::invalid(format!("Duration must be {MIN_DURATION_MIN}–{MAX_DURATION_MIN} minutes")));
    }
    if req.list_ids.is_empty() {
        return Err(AppError::invalid("Choose at least one blocklist to enforce"));
    }
    let tx = conn.transaction()?;
    if active(&tx)?.is_some() {
        return Err(AppError::refused("A strict session is already active"));
    }
    if daily_limit_min > 0 && used_today_min(&tx, day_start)? + req.duration_min > daily_limit_min {
        return Err(AppError::refused(format!(
            "This would exceed your daily strict-mode limit of {daily_limit_min} minutes. You can change the limit in Settings."
        )));
    }
    let id = new_id();
    tx.execute(
        "INSERT INTO strict_sessions (id, level, state, started_at, ends_at, created_at, updated_at) VALUES (?1, ?2, 'ACTIVE', ?3, ?4, ?3, ?3)",
        params![id, req.level, now, now + req.duration_min * 60_000],
    )?;
    for list in &req.list_ids {
        tx.execute(
            "INSERT OR IGNORE INTO strict_session_lists (session_id, list_id) SELECT ?1, id FROM blocklists WHERE id = ?2",
            params![id, list],
        )?;
    }
    record_event(&tx, Some(&id), "started", &format!("{} for {} min", req.level, req.duration_min))?;
    let s = with_lists(&tx, tx.query_row("SELECT * FROM strict_sessions WHERE id = ?1", [&id], from_row)?)?;
    tx.commit()?;
    Ok(s)
}

fn require_active(conn: &Connection) -> AppResult<StrictSession> {
    active(conn)?.ok_or_else(|| AppError::invalid("No strict session is active"))
}

fn set_state(conn: &Connection, id: &str, state: &str, now: i64) -> AppResult<()> {
    let ended = matches!(state, "COMPLETED" | "EMERGENCY_EXIT").then_some(now);
    conn.execute(
        "UPDATE strict_sessions SET state = ?2, ended_at = COALESCE(?3, ended_at), updated_at = ?4 WHERE id = ?1",
        params![id, state, ended, now],
    )?;
    Ok(())
}

pub fn pause(conn: &Connection, now: i64) -> AppResult<()> {
    let s = require_active(conn)?;
    if s.state != "ACTIVE" {
        return Err(AppError::invalid("Session is not active"));
    }
    if !exit_policy(&s.level, 300).can_pause {
        record_event(conn, Some(&s.id), "pause_refused", "")?;
        return Err(AppError::refused(format!("Pausing is not allowed at the {} level", s.level)));
    }
    conn.execute(
        "UPDATE strict_sessions SET state = 'PAUSED', paused_at = ?2, updated_at = ?2 WHERE id = ?1",
        params![s.id, now],
    )?;
    record_event(conn, Some(&s.id), "paused", "")
}

pub fn resume(conn: &Connection, now: i64) -> AppResult<()> {
    let s = require_active(conn)?;
    let Some(p) = s.paused_at.filter(|_| s.state == "PAUSED") else {
        return Err(AppError::invalid("Session is not paused"));
    };
    conn.execute(
        "UPDATE strict_sessions SET state = 'ACTIVE', ends_at = ends_at + ?2, paused_at = NULL, updated_at = ?3 WHERE id = ?1",
        params![s.id, (now - p).max(0), now],
    )?;
    record_event(conn, Some(&s.id), "resumed", "")
}

/// Starts an emergency exit. Returns true if the session ended immediately.
pub fn request_exit(conn: &Connection, reason: &str, phrase: Option<&str>, now: i64, max_cooldown_sec: i64) -> AppResult<bool> {
    let s = require_active(conn)?;
    let policy = exit_policy(&s.level, max_cooldown_sec);
    let reason = reason.trim();
    if reason.chars().count() < policy.min_reason_length {
        return Err(AppError::invalid(format!("Please describe the reason (at least {} characters)", policy.min_reason_length)));
    }
    if let Some(expected) = policy.phrase {
        if phrase.map(str::trim) != Some(expected) {
            return Err(AppError::invalid("The confirmation phrase does not match"));
        }
    }
    let reason: String = reason.chars().take(500).collect();
    conn.execute(
        "UPDATE strict_sessions SET exit_reason = ?2, exit_requested_at = ?3, updated_at = ?3 WHERE id = ?1",
        params![s.id, reason, now],
    )?;
    record_event(conn, Some(&s.id), "exit_requested", &reason)?;
    if policy.cooldown_ms == 0 {
        set_state(conn, &s.id, "EMERGENCY_EXIT", now)?;
        record_event(conn, Some(&s.id), "emergency_exit", "")?;
        return Ok(true);
    }
    Ok(false)
}

pub fn abort_exit(conn: &Connection) -> AppResult<()> {
    let s = require_active(conn)?;
    conn.execute(
        "UPDATE strict_sessions SET exit_requested_at = NULL, exit_reason = '' WHERE id = ?1",
        [&s.id],
    )?;
    record_event(conn, Some(&s.id), "exit_cancelled", "")
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StrictTransition {
    Completed(String),
    EmergencyExit(String),
}

/// Completes due sessions and finishes exits whose cool-down elapsed.
pub fn tick(conn: &Connection, now: i64, max_cooldown_sec: i64) -> AppResult<Option<StrictTransition>> {
    let Some(s) = active(conn)? else { return Ok(None) };
    if s.state == "ACTIVE" && now >= s.ends_at {
        set_state(conn, &s.id, "COMPLETED", now)?;
        record_event(conn, Some(&s.id), "completed", "")?;
        return Ok(Some(StrictTransition::Completed(s.id)));
    }
    let policy = exit_policy(&s.level, max_cooldown_sec);
    if let Some(req) = s.exit_requested_at {
        if now - req >= policy.cooldown_ms {
            set_state(conn, &s.id, "EMERGENCY_EXIT", now)?;
            record_event(conn, Some(&s.id), "emergency_exit", "")?;
            return Ok(Some(StrictTransition::EmergencyExit(s.id)));
        }
    }
    Ok(None)
}

/// Lists protected by the active strict session (empty at the normal level).
pub fn protected_list_ids(conn: &Connection) -> AppResult<Vec<String>> {
    Ok(match active(conn)? {
        Some(s) if !exit_policy(&s.level, 300).can_remove_rules => s.list_ids,
        _ => Vec::new(),
    })
}

pub fn enforced_list_ids(conn: &Connection) -> AppResult<Vec<String>> {
    Ok(match active(conn)? {
        Some(s) if s.state == "ACTIVE" => s.list_ids,
        _ => Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    const T0: i64 = 1_800_000_000_000;

    fn setup() -> Db {
        let db = Db::open_in_memory().unwrap();
        db.conn()
            .execute("INSERT INTO blocklists (id, name, created_at, updated_at) VALUES ('l', 'L', 0, 0)", [])
            .unwrap();
        db
    }

    fn req(level: &str, min: i64) -> StartStrict {
        StartStrict { level: level.into(), duration_min: min, list_ids: vec!["l".into()], confirmed: true }
    }

    #[test]
    fn shared_policy_vectors() {
        let v: serde_json::Value =
            serde_json::from_str(include_str!("../../../../packages/shared-core/vectors/strict.json")).unwrap();
        assert_eq!(v["phrase"].as_str().unwrap(), MAXIMUM_EXIT_PHRASE);
        for p in v["policies"].as_array().unwrap() {
            let pol = exit_policy(p["level"].as_str().unwrap(), 300);
            assert_eq!(pol.min_reason_length as i64, p["minReasonLength"].as_i64().unwrap());
            assert_eq!(pol.cooldown_ms, p["cooldownMs"].as_i64().unwrap());
            assert_eq!(pol.phrase.is_some(), p["requiresPhrase"].as_bool().unwrap());
            assert_eq!(pol.can_pause, p["canPause"].as_bool().unwrap());
            assert_eq!(pol.can_remove_rules, p["canRemoveRules"].as_bool().unwrap());
        }
    }

    #[test]
    fn full_lifecycle_completes() {
        let db = setup();
        let mut c = db.conn();
        let s = start(&mut c, &req("strict", 30), T0, T0, 0).unwrap();
        assert_eq!(s.list_ids, vec!["l".to_string()]);
        assert!(start(&mut c, &req("strict", 30), T0, T0, 0).is_err());
        assert_eq!(protected_list_ids(&c).unwrap(), vec!["l".to_string()]);
        assert_eq!(tick(&c, T0 + 29 * 60_000, 300).unwrap(), None);
        assert!(matches!(tick(&c, T0 + 30 * 60_000, 300).unwrap(), Some(StrictTransition::Completed(_))));
        assert!(active(&c).unwrap().is_none());
    }

    #[test]
    fn strict_exit_needs_reason_and_cooldown() {
        let db = setup();
        let mut c = db.conn();
        start(&mut c, &req("strict", 60), T0, T0, 0).unwrap();
        assert!(pause(&c, T0).is_err());
        assert!(request_exit(&c, "short", None, T0, 300).is_err());
        assert!(!request_exit(&c, "Urgent family matter", None, T0 + 1000, 300).unwrap());
        assert_eq!(tick(&c, T0 + 20_000, 300).unwrap(), None);
        assert!(matches!(tick(&c, T0 + 31_000, 300).unwrap(), Some(StrictTransition::EmergencyExit(_))));
        let kinds: Vec<String> = c
            .prepare("SELECT kind FROM strict_events ORDER BY ts")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert!(kinds.contains(&"pause_refused".to_string()));
        assert!(kinds.contains(&"emergency_exit".to_string()));
    }

    #[test]
    fn maximum_requires_phrase_and_normal_exits_immediately() {
        let db = setup();
        let mut c = db.conn();
        start(&mut c, &req("maximum", 60), T0, T0, 0).unwrap();
        let reason = "Need to handle a production outage right now";
        assert!(request_exit(&c, reason, Some("whatever"), T0, 300).is_err());
        assert!(!request_exit(&c, reason, Some(MAXIMUM_EXIT_PHRASE), T0, 300).unwrap());
        abort_exit(&c).unwrap();
        assert_eq!(tick(&c, T0 + 400_000, 300).unwrap(), None);
        drop(c);
        let db = setup();
        let mut c = db.conn();
        start(&mut c, &req("normal", 60), T0, T0, 0).unwrap();
        pause(&c, T0 + 60_000).unwrap();
        resume(&c, T0 + 120_000).unwrap();
        assert_eq!(active(&c).unwrap().unwrap().ends_at, T0 + 61 * 60_000);
        assert!(request_exit(&c, "", None, T0, 300).unwrap());
    }

    #[test]
    fn enforces_daily_limit_and_validation() {
        let db = setup();
        let mut c = db.conn();
        assert!(start(&mut c, &req("strict", 2), T0, T0, 0).is_err());
        let mut unconfirmed = req("strict", 30);
        unconfirmed.confirmed = false;
        assert!(start(&mut c, &unconfirmed, T0, T0, 0).is_err());
        start(&mut c, &req("normal", 50), T0, T0, 60).unwrap();
        request_exit(&c, "", None, T0 + 10 * 60_000, 300).unwrap();
        // 10 used minutes + 60 requested > 60 limit
        assert!(start(&mut c, &req("normal", 60), T0 + 11 * 60_000, T0, 60).is_err());
        assert!(start(&mut c, &req("normal", 45), T0 + 11 * 60_000, T0, 60).is_ok());
    }
}
