//! Authoritative focus timer. All state lives in SQLite as instants (started_at, paused_at,
//! paused_total_ms); elapsed/remaining time is always *derived*, never counted. This makes the
//! timer exact across app restarts, sleep, minimisation and crashes: whenever the engine next
//! runs (`tick`), overdue phases are completed at the instant they were actually due.

use crate::db::{new_id, now_ms};
use crate::error::{AppError, AppResult};
use crate::settings::PomodoroConfig;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

pub const MINUTE_MS: i64 = 60_000;
pub const STOPWATCH_MAX_MS: i64 = 12 * 60 * MINUTE_MS;
/// A finished break only auto-starts the next focus phase if the user is actually present,
/// i.e. the break ended no longer than this ago. Prevents fabricating focus time while away.
pub const LIVE_GRACE_MS: i64 = 15_000;
/// Pomodoro cycles continue if the previous phase ended within this window.
pub const CYCLE_CONTINUE_MS: i64 = 2 * 60 * MINUTE_MS;

const MODES: &[&str] = &["pomodoro", "stopwatch", "custom", "deep_work", "study", "reading", "break"];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub mode: String,
    pub phase: String,
    pub status: String,
    pub planned_ms: Option<i64>,
    pub started_at: i64,
    pub paused_at: Option<i64>,
    pub paused_total_ms: i64,
    pub ended_at: Option<i64>,
    pub focused_ms: i64,
    pub cycle_index: i64,
    pub category_id: Option<String>,
    pub subject_id: Option<String>,
    pub task_id: Option<String>,
    pub note: String,
    pub strict: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Session {
    fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: r.get("id")?,
            mode: r.get("mode")?,
            phase: r.get("phase")?,
            status: r.get("status")?,
            planned_ms: r.get("planned_ms")?,
            started_at: r.get("started_at")?,
            paused_at: r.get("paused_at")?,
            paused_total_ms: r.get("paused_total_ms")?,
            ended_at: r.get("ended_at")?,
            focused_ms: r.get("focused_ms")?,
            cycle_index: r.get("cycle_index")?,
            category_id: r.get("category_id")?,
            subject_id: r.get("subject_id")?,
            task_id: r.get("task_id")?,
            note: r.get("note")?,
            strict: r.get::<_, i64>("strict")? == 1,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
        })
    }

    pub fn elapsed_ms(&self, now: i64) -> i64 {
        let end = self.ended_at.or(self.paused_at).unwrap_or(now);
        (end - self.started_at - self.paused_total_ms).max(0)
    }

    pub fn remaining_ms(&self, now: i64) -> Option<i64> {
        self.planned_ms.map(|p| (p - self.elapsed_ms(now)).max(0))
    }

    /// Instant a running countdown reaches zero.
    pub fn due_at(&self) -> Option<i64> {
        if self.status != "running" {
            return None;
        }
        self.planned_ms.map(|p| self.started_at + self.paused_total_ms + p)
    }

    pub fn is_break(&self) -> bool {
        self.phase != "focus"
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub session: Option<Session>,
    pub now: i64,
    pub elapsed_ms: i64,
    pub remaining_ms: Option<i64>,
}

pub fn snapshot(conn: &Connection, now: i64) -> AppResult<Snapshot> {
    let session = active(conn)?;
    Ok(Snapshot {
        elapsed_ms: session.as_ref().map(|s| s.elapsed_ms(now)).unwrap_or(0),
        remaining_ms: session.as_ref().and_then(|s| s.remaining_ms(now)),
        session,
        now,
    })
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    pub mode: String,
    pub duration_min: Option<i64>,
    pub category_id: Option<String>,
    pub subject_id: Option<String>,
    pub task_id: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FocusEvent {
    PhaseCompleted { session: Session },
    PhaseStarted { session: Session },
}

pub fn active(conn: &Connection) -> AppResult<Option<Session>> {
    Ok(conn
        .query_row(
            "SELECT s.* FROM timer_state t JOIN focus_sessions s ON s.id = t.session_id WHERE t.singleton = 1",
            [],
            Session::from_row,
        )
        .optional()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Session> {
    Ok(conn.query_row("SELECT * FROM focus_sessions WHERE id = ?1", [id], Session::from_row)?)
}

fn mode_default_min(mode: &str, cfg: &PomodoroConfig) -> Option<i64> {
    match mode {
        "stopwatch" => None,
        "pomodoro" => Some(cfg.focus_min),
        "deep_work" => Some(90),
        "study" => Some(50),
        "reading" => Some(30),
        "break" => Some(cfg.short_break_min),
        _ => Some(45),
    }
}

fn planned_ms(mode: &str, duration_min: Option<i64>, cfg: &PomodoroConfig) -> AppResult<Option<i64>> {
    if mode == "stopwatch" {
        return Ok(None);
    }
    let min = duration_min.or_else(|| mode_default_min(mode, cfg)).unwrap_or(25);
    if !(1..=600).contains(&min) {
        return Err(AppError::invalid("Duration must be between 1 and 600 minutes"));
    }
    Ok(Some(min * MINUTE_MS))
}

/// Next 1-based position in the pomodoro cycle for a manually started pomodoro.
fn next_cycle_index(conn: &Connection, now: i64, cfg: &PomodoroConfig) -> AppResult<i64> {
    let last: Option<(String, i64, Option<i64>)> = conn
        .query_row(
            "SELECT phase, cycle_index, ended_at FROM focus_sessions WHERE mode = 'pomodoro' AND status IN ('completed','skipped')
             ORDER BY started_at DESC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    Ok(match last {
        Some((phase, idx, Some(ended))) if now - ended <= CYCLE_CONTINUE_MS && phase != "long_break" => {
            if idx >= cfg.long_break_every.max(1) { 1 } else { idx + 1 }
        }
        _ => 1,
    })
}

struct NewPhase<'a> {
    mode: &'a str,
    phase: &'a str,
    planned_ms: Option<i64>,
    started_at: i64,
    cycle_index: i64,
    category_id: Option<String>,
    subject_id: Option<String>,
    task_id: Option<String>,
    note: String,
    strict: bool,
}

fn insert_phase(conn: &Connection, p: NewPhase, now: i64) -> AppResult<Session> {
    let id = new_id();
    conn.execute(
        "INSERT INTO focus_sessions (id, mode, phase, status, planned_ms, started_at, paused_total_ms, cycle_index,
           category_id, subject_id, task_id, note, strict, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'running', ?4, ?5, 0, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
        params![
            id, p.mode, p.phase, p.planned_ms, p.started_at, p.cycle_index, p.category_id, p.subject_id,
            p.task_id, p.note, p.strict as i64, now
        ],
    )?;
    conn.execute(
        "INSERT INTO timer_state (singleton, session_id, updated_at) VALUES (1, ?1, ?2)",
        params![id, now],
    )?;
    get(conn, &id)
}

pub fn start(conn: &mut Connection, req: &StartRequest, cfg: &PomodoroConfig, strict: bool, now: i64) -> AppResult<Session> {
    if !MODES.contains(&req.mode.as_str()) {
        return Err(AppError::invalid("Unknown focus mode"));
    }
    let tx = conn.transaction()?;
    if active(&tx)?.is_some() {
        return Err(AppError::refused("A session is already running. End it before starting another."));
    }
    let planned = planned_ms(&req.mode, req.duration_min, cfg)?;
    let is_break = req.mode == "break";
    let cycle = if req.mode == "pomodoro" { next_cycle_index(&tx, now, cfg)? } else { 0 };
    let note: String = req.note.clone().unwrap_or_default().chars().take(2000).collect();
    let session = insert_phase(
        &tx,
        NewPhase {
            mode: &req.mode,
            phase: if is_break { "short_break" } else { "focus" },
            planned_ms: planned,
            started_at: now,
            cycle_index: cycle,
            category_id: req.category_id.clone(),
            subject_id: req.subject_id.clone(),
            task_id: req.task_id.clone(),
            note,
            strict,
        },
        now,
    )?;
    tx.commit()?;
    Ok(session)
}

fn require_active(conn: &Connection) -> AppResult<Session> {
    active(conn)?.ok_or_else(|| AppError::invalid("No session is running"))
}

pub fn pause(conn: &mut Connection, now: i64) -> AppResult<Session> {
    let tx = conn.transaction()?;
    let s = require_active(&tx)?;
    if s.status != "running" {
        return Err(AppError::invalid("Session is not running"));
    }
    tx.execute(
        "UPDATE focus_sessions SET status = 'paused', paused_at = ?2, updated_at = ?2 WHERE id = ?1",
        params![s.id, now.max(s.started_at)],
    )?;
    let out = get(&tx, &s.id)?;
    tx.commit()?;
    Ok(out)
}

pub fn resume(conn: &mut Connection, now: i64) -> AppResult<Session> {
    let tx = conn.transaction()?;
    let s = require_active(&tx)?;
    let paused_at = match (s.status.as_str(), s.paused_at) {
        ("paused", Some(p)) => p,
        _ => return Err(AppError::invalid("Session is not paused")),
    };
    let add = (now - paused_at).max(0);
    tx.execute(
        "UPDATE focus_sessions SET status = 'running', paused_at = NULL, paused_total_ms = paused_total_ms + ?2, updated_at = ?3 WHERE id = ?1",
        params![s.id, add, now],
    )?;
    let out = get(&tx, &s.id)?;
    tx.commit()?;
    Ok(out)
}

fn finalize(conn: &Connection, s: &Session, ended_at: i64, status: &str, now: i64) -> AppResult<Session> {
    // Close a pause that is still open so paused time is not counted as focus.
    let paused_total = match s.paused_at {
        Some(p) => s.paused_total_ms + (ended_at - p).max(0),
        None => s.paused_total_ms,
    };
    let focused = (ended_at - s.started_at - paused_total).max(0);
    let focused = s.planned_ms.map(|p| focused.min(p)).unwrap_or(focused.min(STOPWATCH_MAX_MS));
    conn.execute(
        "UPDATE focus_sessions SET status = ?2, ended_at = ?3, paused_at = NULL, paused_total_ms = ?4, focused_ms = ?5, updated_at = ?6 WHERE id = ?1",
        params![s.id, status, ended_at.max(s.started_at), paused_total, focused, now],
    )?;
    conn.execute("DELETE FROM timer_state WHERE session_id = ?1", [&s.id])?;
    get(conn, &s.id)
}

/// Ends the active phase now. Countdown phases that reached their target are `completed`,
/// earlier ends are `interrupted` (breaks: `skipped`). No automatic transition follows.
pub fn end(conn: &mut Connection, now: i64) -> AppResult<Session> {
    let tx = conn.transaction()?;
    let s = require_active(&tx)?;
    let reached = s.planned_ms.map(|p| s.elapsed_ms(now) >= p).unwrap_or(true);
    let status = match (s.is_break(), reached) {
        (_, true) => "completed",
        (true, false) => "skipped",
        (false, false) => "interrupted",
    };
    let out = finalize(&tx, &s, now, status, now)?;
    tx.commit()?;
    Ok(out)
}

/// Discards the active phase entirely (nothing is recorded).
pub fn reset(conn: &mut Connection) -> AppResult<()> {
    let tx = conn.transaction()?;
    let s = require_active(&tx)?;
    tx.execute("DELETE FROM focus_sessions WHERE id = ?1", [&s.id])?;
    tx.commit()?;
    Ok(())
}

pub fn skip_break(conn: &mut Connection, cfg: &PomodoroConfig, now: i64) -> AppResult<Vec<FocusEvent>> {
    let tx = conn.transaction()?;
    let s = require_active(&tx)?;
    if !s.is_break() {
        return Err(AppError::invalid("Only breaks can be skipped"));
    }
    let done = finalize(&tx, &s, now, "skipped", now)?;
    let mut events = vec![FocusEvent::PhaseCompleted { session: done.clone() }];
    if cfg.auto_start_focus && done.mode == "pomodoro" {
        let next = start_next_focus(&tx, &done, cfg, now)?;
        events.push(FocusEvent::PhaseStarted { session: next });
    }
    tx.commit()?;
    Ok(events)
}

fn start_next_focus(conn: &Connection, after: &Session, cfg: &PomodoroConfig, now: i64) -> AppResult<Session> {
    let cycle = if after.phase == "long_break" { 1 } else { after.cycle_index + 1 };
    insert_phase(
        conn,
        NewPhase {
            mode: "pomodoro",
            phase: "focus",
            planned_ms: Some(cfg.focus_min.clamp(1, 600) * MINUTE_MS),
            started_at: now,
            cycle_index: cycle,
            category_id: after.category_id.clone(),
            subject_id: after.subject_id.clone(),
            task_id: after.task_id.clone(),
            note: String::new(),
            strict: after.strict,
        },
        now,
    )
}

/// Advances the engine to `now`: completes overdue phases at their exact due instant and
/// performs automatic pomodoro transitions. Safe to call at any frequency and after downtime.
pub fn tick(conn: &mut Connection, cfg: &PomodoroConfig, now: i64) -> AppResult<Vec<FocusEvent>> {
    let tx = conn.transaction()?;
    let mut events = Vec::new();
    // Bounded loop: at most focus → break → (live) focus per tick.
    for _ in 0..4 {
        let Some(s) = active(&tx)? else { break };
        if s.status == "running" && s.planned_ms.is_none() && s.elapsed_ms(now) >= STOPWATCH_MAX_MS {
            let done = finalize(&tx, &s, s.started_at + s.paused_total_ms + STOPWATCH_MAX_MS, "completed", now)?;
            events.push(FocusEvent::PhaseCompleted { session: done });
            break;
        }
        let Some(due) = s.due_at() else { break };
        if due > now {
            break;
        }
        let done = finalize(&tx, &s, due, "completed", now)?;
        events.push(FocusEvent::PhaseCompleted { session: done.clone() });
        if done.mode != "pomodoro" {
            break;
        }
        if done.phase == "focus" && cfg.auto_start_breaks {
            let every = cfg.long_break_every.max(1);
            let (phase, minutes) = if done.cycle_index > 0 && done.cycle_index % every == 0 {
                ("long_break", cfg.long_break_min)
            } else {
                ("short_break", cfg.short_break_min)
            };
            let next = insert_phase(
                &tx,
                NewPhase {
                    mode: "pomodoro",
                    phase,
                    planned_ms: Some(minutes.clamp(1, 600) * MINUTE_MS),
                    started_at: due,
                    cycle_index: done.cycle_index,
                    category_id: done.category_id.clone(),
                    subject_id: done.subject_id.clone(),
                    task_id: done.task_id.clone(),
                    note: String::new(),
                    strict: done.strict,
                },
                now,
            )?;
            events.push(FocusEvent::PhaseStarted { session: next });
            continue;
        }
        if done.is_break() && cfg.auto_start_focus && now - due <= LIVE_GRACE_MS {
            let next = start_next_focus(&tx, &done, cfg, now)?;
            events.push(FocusEvent::PhaseStarted { session: next });
        }
        break;
    }
    tx.commit()?;
    Ok(events)
}

pub fn update_details(conn: &Connection, id: &str, note: &str, category_id: Option<String>, subject_id: Option<String>, task_id: Option<String>) -> AppResult<Session> {
    let note: String = note.chars().take(2000).collect();
    conn.execute(
        "UPDATE focus_sessions SET note = ?2, category_id = ?3, subject_id = ?4, task_id = ?5, updated_at = ?6 WHERE id = ?1",
        params![id, note, category_id, subject_id, task_id, now_ms()],
    )?;
    get(conn, id)
}

pub fn delete_finished(conn: &Connection, id: &str) -> AppResult<()> {
    let n = conn.execute(
        "DELETE FROM focus_sessions WHERE id = ?1 AND status NOT IN ('running','paused')",
        [id],
    )?;
    if n == 0 {
        return Err(AppError::invalid("Only finished sessions can be deleted"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    const T0: i64 = 1_800_000_000_000;

    fn cfg() -> PomodoroConfig {
        PomodoroConfig::default()
    }

    fn req(mode: &str) -> StartRequest {
        StartRequest { mode: mode.into(), ..Default::default() }
    }

    #[test]
    fn shared_timing_vectors() {
        let v: serde_json::Value =
            serde_json::from_str(include_str!("../../../../packages/shared-core/vectors/focus.json")).unwrap();
        for c in v["cases"].as_array().unwrap() {
            let paused_at = c["pausedAt"].as_i64();
            let s = Session {
                id: String::new(),
                mode: "custom".into(),
                phase: "focus".into(),
                status: if paused_at.is_some() { "paused".into() } else { "running".into() },
                planned_ms: c["plannedMs"].as_i64(),
                started_at: c["startedAt"].as_i64().unwrap(),
                paused_at,
                paused_total_ms: c["pausedTotalMs"].as_i64().unwrap(),
                ended_at: None,
                focused_ms: 0,
                cycle_index: 0,
                category_id: None,
                subject_id: None,
                task_id: None,
                note: String::new(),
                strict: false,
                created_at: 0,
                updated_at: 0,
            };
            let now = c["now"].as_i64().unwrap();
            let name = c["name"].as_str().unwrap();
            assert_eq!(s.elapsed_ms(now), c["elapsed"].as_i64().unwrap(), "{name}");
            assert_eq!(s.remaining_ms(now), c["remaining"].as_i64(), "{name}");
            assert_eq!(s.due_at(), c["due"].as_i64(), "{name}");
        }
    }

    #[test]
    fn prevents_duplicate_sessions() {
        let db = Db::open_in_memory().unwrap();
        let mut c = db.conn();
        start(&mut c, &req("custom"), &cfg(), false, T0).unwrap();
        assert!(start(&mut c, &req("custom"), &cfg(), false, T0 + 1).is_err());
    }

    #[test]
    fn pause_and_resume_exclude_paused_time() {
        let db = Db::open_in_memory().unwrap();
        let mut c = db.conn();
        let mut r = req("custom");
        r.duration_min = Some(10);
        start(&mut c, &r, &cfg(), false, T0).unwrap();
        pause(&mut c, T0 + 2 * MINUTE_MS).unwrap();
        resume(&mut c, T0 + 7 * MINUTE_MS).unwrap();
        let s = active(&c).unwrap().unwrap();
        assert_eq!(s.paused_total_ms, 5 * MINUTE_MS);
        assert_eq!(s.due_at(), Some(T0 + 15 * MINUTE_MS));
        assert!(tick(&mut c, &cfg(), T0 + 14 * MINUTE_MS).unwrap().is_empty());
        let ev = tick(&mut c, &cfg(), T0 + 15 * MINUTE_MS).unwrap();
        assert_eq!(ev.len(), 1);
        let FocusEvent::PhaseCompleted { session } = &ev[0] else { panic!() };
        assert_eq!(session.focused_ms, 10 * MINUTE_MS);
        assert_eq!(session.status, "completed");
    }

    #[test]
    fn recovers_after_downtime_without_fabricating_focus() {
        // App closed mid-pomodoro and reopened 3 hours later.
        let db = Db::open_in_memory().unwrap();
        let mut c = db.conn();
        start(&mut c, &req("pomodoro"), &cfg(), false, T0).unwrap();
        let events = tick(&mut c, &cfg(), T0 + 180 * MINUTE_MS).unwrap();
        // focus completed at its due time, break started at that instant and also completed; no new focus.
        assert_eq!(events.len(), 3);
        let FocusEvent::PhaseCompleted { session: f } = &events[0] else { panic!() };
        assert_eq!(f.ended_at, Some(T0 + 25 * MINUTE_MS));
        let FocusEvent::PhaseCompleted { session: b } = &events[2] else { panic!() };
        assert_eq!(b.phase, "short_break");
        assert_eq!(b.ended_at, Some(T0 + 30 * MINUTE_MS));
        assert!(active(&c).unwrap().is_none());
        let n: i64 = c.query_row("SELECT COUNT(*) FROM focus_sessions WHERE phase='focus'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn live_break_end_auto_starts_focus_when_enabled() {
        let db = Db::open_in_memory().unwrap();
        let mut c = db.conn();
        let cfg = PomodoroConfig { auto_start_focus: true, ..PomodoroConfig::default() };
        start(&mut c, &req("pomodoro"), &cfg, false, T0).unwrap();
        tick(&mut c, &cfg, T0 + 25 * MINUTE_MS).unwrap();
        let ev = tick(&mut c, &cfg, T0 + 30 * MINUTE_MS + 1000).unwrap();
        let FocusEvent::PhaseStarted { session } = ev.last().unwrap() else { panic!() };
        assert_eq!(session.phase, "focus");
        assert_eq!(session.cycle_index, 2);
    }

    #[test]
    fn fourth_pomodoro_gets_a_long_break() {
        let db = Db::open_in_memory().unwrap();
        let mut c = db.conn();
        let mut now = T0;
        for i in 1..=4 {
            let s = start(&mut c, &req("pomodoro"), &cfg(), false, now).unwrap();
            assert_eq!(s.cycle_index, i);
            now += 25 * MINUTE_MS;
            let ev = tick(&mut c, &cfg(), now).unwrap();
            let FocusEvent::PhaseStarted { session } = &ev[1] else { panic!() };
            assert_eq!(session.phase, if i == 4 { "long_break" } else { "short_break" });
            skip_break(&mut c, &cfg(), now + MINUTE_MS).unwrap();
            now += 2 * MINUTE_MS;
        }
    }

    #[test]
    fn ending_early_is_interrupted_and_reset_discards() {
        let db = Db::open_in_memory().unwrap();
        let mut c = db.conn();
        start(&mut c, &req("deep_work"), &cfg(), false, T0).unwrap();
        let s = end(&mut c, T0 + 30 * MINUTE_MS).unwrap();
        assert_eq!(s.status, "interrupted");
        assert_eq!(s.focused_ms, 30 * MINUTE_MS);
        start(&mut c, &req("reading"), &cfg(), false, T0 + 31 * MINUTE_MS).unwrap();
        reset(&mut c).unwrap();
        let n: i64 = c.query_row("SELECT COUNT(*) FROM focus_sessions", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn ending_while_paused_does_not_count_pause() {
        let db = Db::open_in_memory().unwrap();
        let mut c = db.conn();
        start(&mut c, &req("stopwatch"), &cfg(), false, T0).unwrap();
        pause(&mut c, T0 + 10 * MINUTE_MS).unwrap();
        let s = end(&mut c, T0 + 60 * MINUTE_MS).unwrap();
        assert_eq!(s.focused_ms, 10 * MINUTE_MS);
        assert_eq!(s.status, "completed");
    }

    #[test]
    fn stopwatch_is_capped() {
        let db = Db::open_in_memory().unwrap();
        let mut c = db.conn();
        start(&mut c, &req("stopwatch"), &cfg(), false, T0).unwrap();
        let ev = tick(&mut c, &cfg(), T0 + 20 * 60 * MINUTE_MS).unwrap();
        let FocusEvent::PhaseCompleted { session } = &ev[0] else { panic!() };
        assert_eq!(session.focused_ms, STOPWATCH_MAX_MS);
    }

    #[test]
    fn rejects_invalid_input() {
        let db = Db::open_in_memory().unwrap();
        let mut c = db.conn();
        assert!(start(&mut c, &req("nap"), &cfg(), false, T0).is_err());
        let mut r = req("custom");
        r.duration_min = Some(0);
        assert!(start(&mut c, &r, &cfg(), false, T0).is_err());
        assert!(pause(&mut c, T0).is_err());
    }
}
