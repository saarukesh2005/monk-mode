//! Tauri command surface. Every command validates input and returns user-facing errors.

use crate::backup;
use crate::db::{integrity_check, new_id, now_ms, Db, SCHEMA_VERSION};
use crate::error::{AppError, AppResult};
use crate::platform::{self, AppInfo, ProcessMonitor};
use crate::repo::{self, ListQuery};
use crate::rules::{self, ActiveBlockSet};
use crate::{focus, hosts, settings, strict};
use rusqlite::params;
use serde::Serialize;
use serde_json::{Map, Value as Json};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;

pub struct AppState {
    pub db: Db,
    pub data_dir: PathBuf,
    pub block_set: Arc<Mutex<ActiveBlockSet>>,
}

impl AppState {
    fn changed(&self, app: &AppHandle, what: &str) {
        let _ = app.emit("monk://data", what);
    }
}

type Cmd<T> = Result<T, AppError>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfoOut {
    version: String,
    build: String,
    platform: String,
    data_dir: String,
    schema_version: i64,
    bridge_port: u16,
}

#[tauri::command]
pub fn app_info(state: State<AppState>) -> AppInfoOut {
    AppInfoOut {
        version: env!("CARGO_PKG_VERSION").into(),
        build: option_env!("MONK_BUILD_NUMBER").unwrap_or("local").into(),
        platform: platform::platform_name().into(),
        data_dir: state.data_dir.to_string_lossy().into(),
        schema_version: SCHEMA_VERSION,
        bridge_port: crate::bridge::DEFAULT_PORT,
    }
}

// ---------- Generic data ----------

#[tauri::command]
pub fn db_list(state: State<AppState>, table: String, query: Option<ListQuery>) -> Cmd<Vec<Map<String, Json>>> {
    repo::list(&state.db.conn(), &table, &query.unwrap_or_default())
}

#[tauri::command]
pub fn db_upsert(app: AppHandle, state: State<AppState>, table: String, row: Map<String, Json>) -> Cmd<Map<String, Json>> {
    let out = repo::upsert(&mut state.db.conn(), &table, &row)?;
    state.changed(&app, &table);
    Ok(out)
}

#[tauri::command]
pub fn db_delete(app: AppHandle, state: State<AppState>, table: String, key: Map<String, Json>) -> Cmd<()> {
    repo::delete(&mut state.db.conn(), &table, &key)?;
    state.changed(&app, &table);
    Ok(())
}

#[tauri::command]
pub fn db_integrity(state: State<AppState>) -> Cmd<Vec<String>> {
    integrity_check(&state.db.conn())
}

// ---------- Settings ----------

#[tauri::command]
pub fn settings_all(state: State<AppState>) -> Cmd<Map<String, Json>> {
    let conn = state.db.conn();
    settings::extension_token(&conn)?;
    let rows = repo::query_json(&conn, "SELECT key, value FROM settings", &[])?;
    Ok(rows
        .into_iter()
        .filter_map(|r| {
            let k = r.get("key")?.as_str()?.to_string();
            let v = serde_json::from_str(r.get("value")?.as_str()?).ok()?;
            Some((k, v))
        })
        .collect())
}

const PROTECTED_IN_STRICT: &[&str] = &["hostsBlockingEnabled", "strictDailyLimitMin", "emergencyCooldownSec", "usageTracking", "requireExtensionInStrict"];

#[tauri::command]
pub fn settings_set(app: AppHandle, state: State<AppState>, key: String, value: Json) -> Cmd<()> {
    if key.is_empty() || key.len() > 64 || !key.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::invalid("Invalid setting name"));
    }
    if ["extensionToken", "monitorHeartbeat", "hostsAppliedForStrict"].contains(&key.as_str()) {
        return Err(AppError::refused("This setting is managed by the app"));
    }
    let conn = state.db.conn();
    if PROTECTED_IN_STRICT.contains(&key.as_str()) {
        if let Some(s) = strict::active(&conn)?.filter(|s| s.level != "normal") {
            strict::record_event(&conn, Some(&s.id), "blocked_edit", &format!("Tried to change {key}"))?;
            return Err(AppError::refused("This setting is locked while a strict session is active."));
        }
    }
    if key == "startOnLogin" {
        let enable = value.as_bool().unwrap_or(false);
        let launcher = app.autolaunch();
        let res = if enable { launcher.enable() } else { launcher.disable() };
        res.map_err(|e| AppError::invalid(format!("Could not change login item: {e}")))?;
    }
    settings::set(&conn, &key, &value)?;
    state.changed(&app, "settings");
    Ok(())
}

#[tauri::command]
pub fn autostart_status(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn extension_token_regenerate(state: State<AppState>) -> Cmd<String> {
    let conn = state.db.conn();
    settings::set(&conn, "extensionToken", &"")?;
    settings::extension_token(&conn)
}

// ---------- Focus ----------

fn emit_timer(app: &AppHandle) {
    let _ = app.emit("monk://timer", Json::Null);
}

#[tauri::command]
pub fn focus_snapshot(state: State<AppState>) -> Cmd<focus::Snapshot> {
    focus::snapshot(&state.db.conn(), now_ms())
}

#[tauri::command]
pub fn focus_start(app: AppHandle, state: State<AppState>, req: focus::StartRequest) -> Cmd<focus::Session> {
    let mut conn = state.db.conn();
    let cfg = settings::pomodoro(&conn);
    let strict_on = strict::active(&conn)?.is_some();
    let s = focus::start(&mut conn, &req, &cfg, strict_on, now_ms())?;
    emit_timer(&app);
    Ok(s)
}

#[tauri::command]
pub fn focus_pause(app: AppHandle, state: State<AppState>) -> Cmd<focus::Session> {
    let s = focus::pause(&mut state.db.conn(), now_ms())?;
    emit_timer(&app);
    Ok(s)
}

#[tauri::command]
pub fn focus_resume(app: AppHandle, state: State<AppState>) -> Cmd<focus::Session> {
    let s = focus::resume(&mut state.db.conn(), now_ms())?;
    emit_timer(&app);
    Ok(s)
}

#[tauri::command]
pub fn focus_end(app: AppHandle, state: State<AppState>) -> Cmd<focus::Session> {
    let s = focus::end(&mut state.db.conn(), now_ms())?;
    emit_timer(&app);
    state.changed(&app, "focus_sessions");
    Ok(s)
}

#[tauri::command]
pub fn focus_reset(app: AppHandle, state: State<AppState>) -> Cmd<()> {
    focus::reset(&mut state.db.conn())?;
    emit_timer(&app);
    Ok(())
}

#[tauri::command]
pub fn focus_skip_break(app: AppHandle, state: State<AppState>) -> Cmd<()> {
    let mut conn = state.db.conn();
    let cfg = settings::pomodoro(&conn);
    focus::skip_break(&mut conn, &cfg, now_ms())?;
    emit_timer(&app);
    Ok(())
}

#[tauri::command]
pub fn session_update(app: AppHandle, state: State<AppState>, id: String, note: String, category_id: Option<String>, subject_id: Option<String>, task_id: Option<String>) -> Cmd<focus::Session> {
    let s = focus::update_details(&state.db.conn(), &id, &note, category_id, subject_id, task_id)?;
    state.changed(&app, "focus_sessions");
    Ok(s)
}

#[tauri::command]
pub fn session_delete(app: AppHandle, state: State<AppState>, id: String) -> Cmd<()> {
    focus::delete_finished(&state.db.conn(), &id)?;
    state.changed(&app, "focus_sessions");
    Ok(())
}

// ---------- Strict ----------

fn strict_params(conn: &rusqlite::Connection) -> (i64, i64, i64) {
    (rules::local_day_start(now_ms()), settings::int(conn, "strictDailyLimitMin", 480), settings::int(conn, "emergencyCooldownSec", 300))
}

#[tauri::command]
pub fn strict_status(state: State<AppState>) -> Cmd<strict::StrictStatus> {
    let conn = state.db.conn();
    let (day, limit, cooldown) = strict_params(&conn);
    strict::status(&conn, now_ms(), day, limit, cooldown)
}

#[tauri::command]
pub fn strict_start(app: AppHandle, state: State<AppState>, req: strict::StartStrict) -> Cmd<strict::StrictSession> {
    let mut conn = state.db.conn();
    let (day, limit, _) = strict_params(&conn);
    let s = strict::start(&mut conn, &req, now_ms(), day, limit)?;
    let _ = app.emit("monk://strict", Json::Null);
    // Optional system-wide layer: apply the hosts file for the committed lists (user consented in settings).
    if req.level != "normal" && settings::flag(&conn, "hostsBlockingEnabled", false) {
        let domains = domains_for_lists(&conn, &req.list_ids)?;
        drop(conn);
        match hosts::apply(&state.db.conn(), &state.data_dir, &domains) {
            Ok(_) => settings::set(&state.db.conn(), "hostsAppliedForStrict", &true)?,
            Err(e) => log::warn!("hosts apply skipped: {e}"),
        }
    }
    Ok(s)
}

#[tauri::command]
pub fn strict_pause(app: AppHandle, state: State<AppState>) -> Cmd<()> {
    strict::pause(&state.db.conn(), now_ms())?;
    let _ = app.emit("monk://strict", Json::Null);
    Ok(())
}

#[tauri::command]
pub fn strict_resume(app: AppHandle, state: State<AppState>) -> Cmd<()> {
    strict::resume(&state.db.conn(), now_ms())?;
    let _ = app.emit("monk://strict", Json::Null);
    Ok(())
}

#[tauri::command]
pub fn strict_request_exit(app: AppHandle, state: State<AppState>, reason: String, phrase: Option<String>) -> Cmd<bool> {
    let conn = state.db.conn();
    let (_, _, cooldown) = strict_params(&conn);
    let ended = strict::request_exit(&conn, &reason, phrase.as_deref(), now_ms(), cooldown)?;
    let _ = app.emit("monk://strict", Json::Null);
    Ok(ended)
}

#[tauri::command]
pub fn strict_abort_exit(app: AppHandle, state: State<AppState>) -> Cmd<()> {
    strict::abort_exit(&state.db.conn())?;
    let _ = app.emit("monk://strict", Json::Null);
    Ok(())
}

// ---------- Blocking ----------

#[tauri::command]
pub fn block_set_current(state: State<AppState>) -> ActiveBlockSet {
    state.block_set.lock().map(|s| s.clone()).unwrap_or_default()
}

#[tauri::command]
pub fn quick_block_start(app: AppHandle, state: State<AppState>, list_id: String, minutes: i64) -> Cmd<String> {
    if !(1..=24 * 60).contains(&minutes) {
        return Err(AppError::invalid("Choose between 1 minute and 24 hours"));
    }
    let now = now_ms();
    let id = new_id();
    state.db.conn().execute(
        "INSERT INTO quick_blocks (id, list_id, started_at, ends_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, list_id, now, now + minutes * 60_000],
    )?;
    state.changed(&app, "quick_blocks");
    Ok(id)
}

#[tauri::command]
pub fn quick_block_stop(app: AppHandle, state: State<AppState>, id: String) -> Cmd<()> {
    let conn = state.db.conn();
    let list: String = conn.query_row("SELECT list_id FROM quick_blocks WHERE id = ?1", [&id], |r| r.get(0))?;
    if strict::protected_list_ids(&conn)?.contains(&list) {
        return Err(AppError::refused("This list is part of an active strict session."));
    }
    conn.execute("UPDATE quick_blocks SET ended_at = ?2 WHERE id = ?1 AND ended_at IS NULL", params![id, now_ms()])?;
    state.changed(&app, "quick_blocks");
    Ok(())
}

#[tauri::command]
pub fn exception_grant(app: AppHandle, state: State<AppState>, kind: String, value: String, minutes: i64, reason: String) -> Cmd<()> {
    if kind != "app" && kind != "domain" {
        return Err(AppError::invalid("Unknown exception type"));
    }
    let value = if kind == "domain" { rules::normalize_domain(&value).ok_or_else(|| AppError::invalid("Invalid domain"))? } else { value.trim().to_string() };
    if value.is_empty() || value == "*" {
        return Err(AppError::invalid("Choose what to allow"));
    }
    let conn = state.db.conn();
    if let Some(s) = strict::active(&conn)?.filter(|s| s.level != "normal") {
        strict::record_event(&conn, Some(&s.id), "exception_refused", &value)?;
        return Err(AppError::refused("Temporary exceptions are disabled during a strict session."));
    }
    let minutes = minutes.clamp(1, 60);
    conn.execute(
        "INSERT INTO exceptions (id, type, value, reason, until_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![new_id(), kind, value, reason.chars().take(200).collect::<String>(), now_ms() + minutes * 60_000, now_ms()],
    )?;
    state.changed(&app, "exceptions");
    Ok(())
}

#[tauri::command]
pub fn apps_running() -> Vec<AppInfo> {
    let mut m = ProcessMonitor::new();
    m.refresh();
    m.running_apps()
}

#[tauri::command]
pub fn apps_installed() -> Vec<AppInfo> {
    platform::installed_apps()
}

// ---------- Hosts file ----------

fn domains_for_lists(conn: &rusqlite::Connection, list_ids: &[String]) -> AppResult<Vec<String>> {
    let mut out = Vec::new();
    for id in list_ids {
        let mut stmt = conn.prepare("SELECT type, value FROM block_rules WHERE list_id = ?1")?;
        let rows: Vec<(String, String)> = stmt.query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
        for (t, v) in rows {
            match t.as_str() {
                "domain" => out.push(v),
                "category" => {
                    if let Some(p) = rules::presets().iter().find(|p| p.id == v) {
                        out.extend(p.domains.iter().cloned());
                    }
                }
                _ => {}
            }
        }
    }
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostsStatus {
    path: String,
    readable: bool,
    managed_section: bool,
    managed_domains: usize,
    supported: bool,
}

#[tauri::command]
pub fn hosts_status() -> HostsStatus {
    let content = hosts::read_hosts();
    let managed = content.as_deref().map(hosts::managed_domains).unwrap_or_default();
    HostsStatus {
        path: hosts::hosts_path().to_string_lossy().into(),
        readable: content.is_ok(),
        managed_section: content.as_deref().is_ok_and(hosts::has_managed),
        managed_domains: managed.len(),
        supported: cfg!(any(target_os = "macos", windows)),
    }
}

#[tauri::command]
pub async fn hosts_apply(state: State<'_, AppState>, list_ids: Vec<String>) -> Cmd<bool> {
    let domains = domains_for_lists(&state.db.conn(), &list_ids)?;
    if domains.is_empty() {
        return Err(AppError::invalid("The selected lists contain no domains"));
    }
    let conn = state.db.conn();
    hosts::apply(&conn, &state.data_dir, &domains)
}

#[tauri::command]
pub async fn hosts_remove(state: State<'_, AppState>) -> Cmd<bool> {
    let conn = state.db.conn();
    if let Some(s) = strict::active(&conn)?.filter(|s| s.level != "normal") {
        strict::record_event(&conn, Some(&s.id), "blocked_edit", "Tried to remove hosts blocking")?;
        return Err(AppError::refused("Hosts blocking stays in place until the strict session ends."));
    }
    hosts::apply(&conn, &state.data_dir, &[])
}

// ---------- Backup, export, wipe ----------

#[tauri::command]
pub async fn backup_export(app: AppHandle, state: State<'_, AppState>, passphrase: String) -> Cmd<Option<String>> {
    let payload = backup::export_payload(&state.db.conn(), platform::platform_name(), env!("CARGO_PKG_VERSION"))?;
    let bytes = backup::encrypt(&serde_json::to_vec(&payload)?, &passphrase)?;
    let name = format!("monk-mode-{}.monkbak", chrono::Local::now().format("%Y-%m-%d"));
    let Some(path) = app.dialog().file().add_filter("MONK MODE backup", &["monkbak"]).set_file_name(&name).blocking_save_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|_| AppError::invalid("Choose a local file"))?;
    std::fs::write(&path, bytes)?;
    Ok(Some(path.to_string_lossy().into()))
}

#[tauri::command]
pub async fn backup_import(app: AppHandle, state: State<'_, AppState>, passphrase: String) -> Cmd<Option<backup::RestoreReport>> {
    let Some(path) = app.dialog().file().add_filter("MONK MODE backup", &["monkbak"]).blocking_pick_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|_| AppError::invalid("Choose a local file"))?;
    let meta = std::fs::metadata(&path)?;
    if meta.len() > 512 * 1024 * 1024 {
        return Err(AppError::invalid("Backup file is too large"));
    }
    let plain = backup::decrypt(&std::fs::read(&path)?, &passphrase)?;
    let payload: backup::Payload_ = serde_json::from_slice(&plain).map_err(|_| AppError::invalid("Backup content is not valid"))?;
    let mut conn = state.db.conn();
    if strict::active(&conn)?.is_some_and(|s| s.level != "normal") {
        return Err(AppError::refused("Restore is unavailable during a strict session."));
    }
    backup::safety_snapshot(&conn, &state.data_dir.join("safety-snapshots"))?;
    let report = backup::restore(&mut conn, &payload)?;
    drop(conn);
    state.changed(&app, "*");
    emit_timer(&app);
    Ok(Some(report))
}

#[tauri::command]
pub async fn save_text_file(app: AppHandle, default_name: String, content: String, extension: String) -> Cmd<Option<String>> {
    if !["json", "csv", "txt"].contains(&extension.as_str()) {
        return Err(AppError::invalid("Unsupported export type"));
    }
    let safe_name: String = default_name.chars().filter(|c| c.is_ascii_alphanumeric() || "-_.".contains(*c)).take(80).collect();
    let Some(path) = app.dialog().file().add_filter(extension.to_uppercase(), &[extension.as_str()]).set_file_name(&safe_name).blocking_save_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|_| AppError::invalid("Choose a local file"))?;
    std::fs::write(&path, content)?;
    Ok(Some(path.to_string_lossy().into()))
}

#[tauri::command]
pub fn export_json_payload(state: State<AppState>) -> Cmd<Json> {
    let payload = backup::export_payload(&state.db.conn(), platform::platform_name(), env!("CARGO_PKG_VERSION"))?;
    Ok(serde_json::to_value(payload)?)
}

#[tauri::command]
pub fn data_wipe(app: AppHandle, state: State<AppState>, confirm: String) -> Cmd<()> {
    if confirm != "DELETE" {
        return Err(AppError::invalid("Type DELETE to confirm"));
    }
    let mut conn = state.db.conn();
    if strict::active(&conn)?.is_some_and(|s| s.level != "normal") {
        return Err(AppError::refused("Local data cannot be deleted during a strict session."));
    }
    backup::safety_snapshot(&conn, &state.data_dir.join("safety-snapshots"))?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM timer_state", [])?;
    for t in backup::BACKUP_TABLES.iter().rev() {
        if *t == "settings" {
            tx.execute("DELETE FROM settings WHERE key != 'extensionToken'", [])?;
        } else {
            tx.execute(&format!("DELETE FROM {t}"), [])?;
        }
    }
    tx.commit()?;
    crate::seed::seed_defaults(&conn)?;
    drop(conn);
    state.changed(&app, "*");
    emit_timer(&app);
    Ok(())
}
