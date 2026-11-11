//! Background supervisor thread. Every tick it:
//! 1. advances the focus and strict engines (exact catch-up after sleep/restart),
//! 2. resolves the active block set and closes blocked applications,
//! 3. samples the frontmost application for usage statistics (idle time excluded),
//! 4. records tamper signals (monitor gaps, wall-clock jumps) during strict sessions.

use crate::bridge::Heartbeats;
use crate::db::{new_id, now_ms, Db};
use crate::platform::{self, Foreground, ProcessMonitor};
use crate::rules::{self, ActiveBlockSet};
use crate::{focus, hosts, settings, strict};
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use sysinfo::Pid;

pub const TICK: Duration = Duration::from_millis(1500);
const IDLE_CUTOFF_SEC: f64 = 300.0;
const USAGE_GAP_MS: i64 = 10_000;
const USAGE_FLUSH_MS: i64 = 30_000;
const KILL_GRACE: Duration = Duration::from_secs(3);
const EVENT_DEBOUNCE_MS: i64 = 30_000;
const HEARTBEAT_MS: i64 = 15_000;
const CLOCK_JUMP_MS: i64 = 120_000;
/// Extension sync runs every 30 s; a browser is "unprotected" after missing three syncs.
const EXTENSION_STALE_MS: i64 = 90_000;

/// Whether a browser of `family` must be closed: strict session older than the grace period and
/// no recent sync from that family's extension. Pure function for testing.
pub fn browser_unprotected(family: &str, heartbeats: &HashMap<String, i64>, strict_started_at: i64, now: i64) -> bool {
    if now - strict_started_at < EXTENSION_STALE_MS {
        return false;
    }
    heartbeats.get(family).is_none_or(|t| now - t > EXTENSION_STALE_MS)
}

/// Callbacks into the UI layer (Tauri events + notifications), injected by lib.rs.
pub trait Notifier: Send + Sync {
    fn emit(&self, event: &str, payload: serde_json::Value);
    fn notify(&self, kind: &str, title: &str, body: &str);
}

// ---------- Usage tracking ----------

struct OpenInterval {
    row_id: String,
    app_id: String,
    #[cfg_attr(not(test), allow(dead_code))]
    started_at: i64,
    last_seen: i64,
    flushed_at: i64,
}

#[derive(Default)]
pub struct UsageTracker {
    open: Option<OpenInterval>,
}

impl UsageTracker {
    fn flush(conn: &Connection, o: &OpenInterval) -> rusqlite::Result<()> {
        conn.execute(
            "UPDATE app_usage SET ended_at = ?2, duration_ms = ?2 - started_at WHERE id = ?1",
            params![o.row_id, o.last_seen],
        )?;
        Ok(())
    }

    pub fn close(&mut self, conn: &Connection) -> rusqlite::Result<()> {
        if let Some(o) = self.open.take() {
            Self::flush(conn, &o)?;
        }
        Ok(())
    }

    /// Records one sample. `fg = None` means idle/locked/unknown.
    pub fn sample(&mut self, conn: &Connection, fg: Option<&Foreground>, now: i64) -> rusqlite::Result<()> {
        let continuing = match (&self.open, fg) {
            (Some(o), Some(f)) => o.app_id == f.app_id && now - o.last_seen <= USAGE_GAP_MS && now >= o.last_seen,
            _ => false,
        };
        if continuing {
            if let Some(o) = self.open.as_mut() {
                o.last_seen = now;
                if now - o.flushed_at >= USAGE_FLUSH_MS {
                    Self::flush(conn, o)?;
                    o.flushed_at = now;
                }
            }
            return Ok(());
        }
        self.close(conn)?;
        if let Some(f) = fg {
            let id = new_id();
            conn.execute(
                "INSERT INTO app_usage (id, app_id, app_name, started_at, ended_at, duration_ms, platform, source) VALUES (?1, ?2, ?3, ?4, ?4, 0, ?5, 'foreground_sampler')",
                params![id, f.app_id, f.app_name, now, platform::platform_name()],
            )?;
            self.open = Some(OpenInterval { row_id: id, app_id: f.app_id.clone(), started_at: now, last_seen: now, flushed_at: now });
        }
        Ok(())
    }

    #[cfg(test)]
    fn started_at(&self) -> Option<i64> {
        self.open.as_ref().map(|o| o.started_at)
    }
}

// ---------- Supervisor ----------

pub struct Monitor {
    pub db: Db,
    pub data_dir: PathBuf,
    pub block_set: Arc<Mutex<ActiveBlockSet>>,
    pub notifier: Arc<dyn Notifier>,
    pub heartbeats: Heartbeats,
    procs: ProcessMonitor,
    usage: UsageTracker,
    pending_kills: HashMap<Pid, (Instant, String)>,
    last_event: HashMap<String, i64>,
    last_heartbeat: i64,
    wall_anchor: (Instant, i64),
    last_proc_refresh: Instant,
}

impl Monitor {
    pub fn new(db: Db, data_dir: PathBuf, block_set: Arc<Mutex<ActiveBlockSet>>, notifier: Arc<dyn Notifier>, heartbeats: Heartbeats) -> Self {
        Self {
            db,
            data_dir,
            block_set,
            notifier,
            heartbeats,
            procs: ProcessMonitor::new(),
            usage: UsageTracker::default(),
            pending_kills: HashMap::new(),
            last_event: HashMap::new(),
            last_heartbeat: 0,
            wall_anchor: (Instant::now(), now_ms()),
            last_proc_refresh: Instant::now() - Duration::from_secs(60),
        }
    }

    pub fn spawn(mut self) {
        std::thread::Builder::new()
            .name("monk-monitor".into())
            .spawn(move || {
                self.on_startup();
                loop {
                    if let Err(e) = self.tick() {
                        log::warn!("monitor tick failed: {e}");
                    }
                    std::thread::sleep(TICK);
                }
            })
            .ok();
    }

    /// Detects that the app was not running during a strict session (crash, force quit, reboot).
    fn on_startup(&mut self) {
        let conn = self.db.conn();
        let last: i64 = settings::get(&conn, "monitorHeartbeat", 0);
        if let Ok(Some(s)) = strict::active(&conn) {
            let gap = now_ms() - last;
            if last > 0 && gap > 2 * HEARTBEAT_MS {
                let _ = strict::record_event(&conn, Some(&s.id), "monitor_gap", &format!("MONK MODE was not running for {} min", gap / 60_000));
            }
        }
        // Close usage intervals left open by a crash (their ended_at is the last flush).
        let _ = conn.execute("UPDATE app_usage SET duration_ms = ended_at - started_at WHERE duration_ms != ended_at - started_at", []);
    }

    pub fn tick(&mut self) -> crate::error::AppResult<()> {
        let now = now_ms();
        self.detect_clock_jump(now);
        let mut conn = self.db.conn();
        let cfg = settings::pomodoro(&conn);

        for ev in focus::tick(&mut conn, &cfg, now)? {
            self.on_focus_event(&conn, &ev);
        }
        let max_cooldown = settings::int(&conn, "emergencyCooldownSec", 300);
        if let Some(t) = strict::tick(&conn, now, max_cooldown)? {
            self.on_strict_transition(&conn, &t);
        }

        let session = focus::active(&conn)?;
        let focus_active = session.as_ref().is_some_and(|s| s.phase == "focus");
        let strict_lists = strict::enforced_list_ids(&conn)?;
        let set = rules::resolve(&conn, now, focus_active, &strict_lists)?;
        let changed = {
            let mut guard = self.block_set.lock().unwrap_or_else(|e| e.into_inner());
            let changed = guard.apps != set.apps || guard.domains != set.domains || guard.url_patterns != set.url_patterns || guard.triggers != set.triggers || guard.allow_domains != set.allow_domains;
            *guard = set.clone();
            changed
        };
        if changed {
            self.notifier.emit("monk://blockset", serde_json::to_value(&set).unwrap_or_default());
        }

        if now - self.last_heartbeat >= HEARTBEAT_MS {
            settings::set(&conn, "monitorHeartbeat", &now)?;
            self.last_heartbeat = now;
        }

        let track_usage = settings::flag(&conn, "usageTracking", true);
        let require_extension = settings::flag(&conn, "requireExtensionInStrict", false);
        let strict_session = strict::active(&conn)?.filter(|s| s.level != "normal" && s.state == "ACTIVE");
        drop(conn);

        self.enforce_apps(&set, now)?;
        if let (true, Some(s)) = (require_extension, strict_session) {
            self.enforce_browsers(&s.id, s.started_at, now)?;
        }
        if track_usage {
            let fg = if platform::idle_seconds() >= IDLE_CUTOFF_SEC { None } else { platform::foreground(&self.procs) };
            let conn = self.db.conn();
            self.usage.sample(&conn, fg.as_ref(), now)?;
        }
        Ok(())
    }

    fn detect_clock_jump(&mut self, now: i64) {
        let (anchor_instant, anchor_wall) = self.wall_anchor;
        let expected = anchor_wall + anchor_instant.elapsed().as_millis() as i64;
        self.wall_anchor = (Instant::now(), now);
        // A monotonic clock keeps counting through sleep on macOS but not everywhere, so only
        // backwards jumps are treated as suspicious.
        if expected - now > CLOCK_JUMP_MS {
            let conn = self.db.conn();
            if let Ok(Some(s)) = strict::active(&conn) {
                let _ = strict::record_event(&conn, Some(&s.id), "clock_changed", &format!("System clock moved back {} s", (expected - now) / 1000));
            }
        }
    }

    fn enforce_apps(&mut self, set: &ActiveBlockSet, now: i64) -> crate::error::AppResult<()> {
        let need = !set.apps.is_empty() || !self.pending_kills.is_empty();
        if !need && self.last_proc_refresh.elapsed() < Duration::from_secs(30) {
            return Ok(());
        }
        self.procs.refresh();
        self.last_proc_refresh = Instant::now();

        // Escalate apps that ignored the polite quit request.
        let overdue: Vec<Pid> = self.pending_kills.iter().filter(|(_, (t, _))| t.elapsed() >= KILL_GRACE).map(|(p, _)| *p).collect();
        for pid in overdue {
            if self.procs.is_alive(pid) {
                self.procs.force_kill(pid);
            }
            self.pending_kills.remove(&pid);
        }

        for (pid, rule, display) in self.procs.find_blocked(&set.apps, &set.allow_apps) {
            if self.pending_kills.contains_key(&pid) {
                continue;
            }
            if self.procs.terminate(pid) {
                self.pending_kills.insert(pid, (Instant::now(), rule.clone()));
                self.record_block(&rule, &display, set, now)?;
            }
        }
        Ok(())
    }

    /// Closes browsers whose MONK MODE extension is not syncing during a strict session
    /// (opt-in setting). Mirrors the "extension removed during a locked block" safeguard.
    fn enforce_browsers(&mut self, session_id: &str, started_at: i64, now: i64) -> crate::error::AppResult<()> {
        let beats = self.heartbeats.lock().map(|h| h.clone()).unwrap_or_default();
        for (pid, name, family) in self.procs.running_browsers() {
            if self.pending_kills.contains_key(&pid) || !browser_unprotected(family, &beats, started_at, now) {
                continue;
            }
            if self.procs.terminate(pid) {
                self.pending_kills.insert(pid, (Instant::now(), name.clone()));
                let key = format!("browser:{name}");
                if self.last_event.get(&key).is_some_and(|t| now - t < EVENT_DEBOUNCE_MS) {
                    continue;
                }
                self.last_event.insert(key, now);
                let conn = self.db.conn();
                strict::record_event(&conn, Some(session_id), "extension_missing", &format!("Closed {name}: the MONK MODE extension was not active"))?;
                drop(conn);
                self.notifier.notify("strict", &format!("{name} was closed"), "During this commitment, browsers need the MONK MODE extension. Re-enable it, then reopen the browser.");
            }
        }
        Ok(())
    }

    fn record_block(&mut self, rule: &str, display: &str, set: &ActiveBlockSet, now: i64) -> crate::error::AppResult<()> {
        let key = rule.to_lowercase();
        if self.last_event.get(&key).is_some_and(|t| now - t < EVENT_DEBOUNCE_MS) {
            return Ok(());
        }
        self.last_event.insert(key, now);
        let trigger = set.trigger_for.get(rule).cloned().unwrap_or_else(|| "manual".into());
        let list = set.source_list.get(rule).cloned();
        let conn = self.db.conn();
        conn.execute(
            "INSERT INTO block_events (id, ts, platform, source, target, list_id, action, trigger) VALUES (?1, ?2, ?3, 'app', ?4, (SELECT id FROM blocklists WHERE id = ?5), 'terminated', ?6)",
            params![new_id(), now, platform::platform_name(), display, list, trigger],
        )?;
        let notify = settings::flag(&conn, "notifyOnBlock", true);
        drop(conn);
        self.notifier.emit("monk://data", serde_json::json!("block_events"));
        if notify {
            self.notifier.notify("block", &format!("{display} was closed"), "It is blocked right now. Stay with the work in front of you.");
        }
        Ok(())
    }

    fn on_focus_event(&self, conn: &Connection, ev: &focus::FocusEvent) {
        self.notifier.emit("monk://timer", serde_json::to_value(ev).unwrap_or_default());
        if !settings::flag(conn, "notifyOnPhaseEnd", true) {
            return;
        }
        if let focus::FocusEvent::PhaseCompleted { session } = ev {
            let (title, body) = if session.phase == "focus" {
                ("Focus session complete", format!("{} minutes of focused work. Take a breath.", session.focused_ms / 60_000))
            } else {
                ("Break is over", "Ready for the next focus session?".to_string())
            };
            self.notifier.notify("focus", title, &body);
        }
    }

    fn on_strict_transition(&self, conn: &Connection, t: &strict::StrictTransition) {
        self.notifier.emit("monk://strict", serde_json::to_value(t).unwrap_or_default());
        let (title, body) = match t {
            strict::StrictTransition::Completed(_) => ("Commitment complete", "Your strict session finished. Well done."),
            strict::StrictTransition::EmergencyExit(_) => ("Strict session ended early", "Emergency exit completed. Restrictions are lifted."),
        };
        self.notifier.notify("strict", title, body);
        // Lift hosts-file blocking that was applied for this session.
        if settings::flag(conn, "hostsAppliedForStrict", false) {
            let _ = settings::set(conn, "hostsAppliedForStrict", &false);
            let dir = self.data_dir.clone();
            let db = self.db.clone();
            let notifier = self.notifier.clone();
            std::thread::spawn(move || {
                let conn = db.conn();
                if let Err(e) = hosts::apply(&conn, &dir, &[]) {
                    notifier.notify("hosts", "Hosts file still contains blocks", &format!("{e} Open Blocker → System-wide blocking to remove them."));
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fg(id: &str) -> Foreground {
        Foreground { app_id: id.into(), app_name: id.into() }
    }

    fn rows(db: &Db) -> Vec<(String, i64)> {
        db.conn()
            .prepare("SELECT app_id, duration_ms FROM app_usage ORDER BY started_at")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    #[test]
    fn merges_samples_and_splits_on_switch_idle_and_gaps() {
        let db = Db::open_in_memory().unwrap();
        let mut t = UsageTracker::default();
        let c = db.conn();
        t.sample(&c, Some(&fg("Code")), 0).unwrap();
        t.sample(&c, Some(&fg("Code")), 1500).unwrap();
        t.sample(&c, Some(&fg("Code")), 3000).unwrap();
        t.sample(&c, Some(&fg("Safari")), 4500).unwrap();
        t.sample(&c, None, 6000).unwrap(); // idle
        t.sample(&c, Some(&fg("Safari")), 7500).unwrap();
        t.sample(&c, Some(&fg("Safari")), 60_000).unwrap(); // sleep gap → new interval
        assert_eq!(t.started_at(), Some(60_000));
        t.close(&c).unwrap();
        drop(c);
        assert_eq!(rows(&db), vec![("Code".into(), 3000), ("Safari".into(), 0), ("Safari".into(), 0), ("Safari".into(), 0)]);
    }

    #[test]
    fn browsers_need_a_recent_extension_sync_after_the_grace_period() {
        let mut hb = HashMap::new();
        hb.insert("chromium".to_string(), 1_000_000);
        // Within the grace period after the commitment starts: never close.
        assert!(!browser_unprotected("firefox", &hb, 1_000_000, 1_050_000));
        // Afterwards: a family without any sync is unprotected; a fresh sync protects.
        assert!(browser_unprotected("firefox", &hb, 900_000, 1_050_000));
        assert!(!browser_unprotected("chromium", &hb, 900_000, 1_050_000));
        assert!(browser_unprotected("chromium", &hb, 900_000, 1_200_000));
        assert!(browser_unprotected("safari", &hb, 0, 1_000_000));
    }

    #[test]
    fn flushes_long_intervals_periodically() {
        let db = Db::open_in_memory().unwrap();
        let mut t = UsageTracker::default();
        let c = db.conn();
        let mut now = 0;
        while now <= 40_000 {
            t.sample(&c, Some(&fg("Code")), now).unwrap();
            now += 1500;
        }
        let d: i64 = c.query_row("SELECT duration_ms FROM app_usage", [], |r| r.get(0)).unwrap();
        assert!(d >= USAGE_FLUSH_MS, "crash-safe: duration persisted before close ({d})");
    }
}
