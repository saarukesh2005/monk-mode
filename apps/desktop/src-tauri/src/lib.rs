//! MONK MODE desktop core (Tauri 2). See docs/FOCUS_ENGINE.md and docs/BLOCKING_GUIDE.md.

pub mod backup;
pub mod bridge;
pub mod commands;
pub mod db;
pub mod error;
pub mod focus;
pub mod hosts;
pub mod monitor;
pub mod platform;
pub mod repo;
pub mod rules;
pub mod seed;
pub mod settings;
pub mod strict;

use commands::AppState;
use rules::ActiveBlockSet;
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_notification::NotificationExt;

struct TauriNotifier {
    app: AppHandle,
    db: db::Db,
}

impl monitor::Notifier for TauriNotifier {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        let _ = self.app.emit(event, payload);
    }

    fn notify(&self, kind: &str, title: &str, body: &str) {
        let conn = self.db.conn();
        let _ = conn.execute(
            "INSERT INTO notifications (id, ts, kind, title, body) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![db::new_id(), db::now_ms(), kind, title, body],
        );
        let enabled = settings::flag(&conn, "notificationsEnabled", true);
        drop(conn);
        let _ = self.app.emit("monk://data", "notifications");
        if enabled {
            if let Err(e) = self.app.notification().builder().title(title).body(body).show() {
                log::debug!("notification failed: {e}");
            }
        }
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Quitting is allowed at every level except while strict/maximum sessions run, where the
/// tray "Quit" item explains instead. (Force-quitting the process remains possible and is
/// detected as a monitor gap on the next launch.)
fn quit_allowed(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let conn = state.db.conn();
    !strict::active(&conn).ok().flatten().is_some_and(|s| s.level != "normal")
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open MONK MODE", true, None::<&str>)?;
    let focus25 = MenuItem::with_id(app, "focus25", "Start 25-minute focus", true, None::<&str>)?;
    let end = MenuItem::with_id(app, "end", "End current session", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &focus25, &end, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut builder = TrayIconBuilder::with_id("monk-tray").menu(&menu).tooltip("MONK MODE").show_menu_on_left_click(true);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_menu_event(|app, event| {
            let state = app.state::<AppState>();
            match event.id.as_ref() {
                "open" => show_main(app),
                "focus25" => {
                    let mut conn = state.db.conn();
                    let cfg = settings::pomodoro(&conn);
                    let req = focus::StartRequest { mode: "custom".into(), duration_min: Some(25), ..Default::default() };
                    if focus::start(&mut conn, &req, &cfg, false, db::now_ms()).is_ok() {
                        let _ = app.emit("monk://timer", serde_json::Value::Null);
                    }
                }
                "end" => {
                    if focus::end(&mut state.db.conn(), db::now_ms()).is_ok() {
                        let _ = app.emit("monk://timer", serde_json::Value::Null);
                    }
                }
                "quit" => {
                    if quit_allowed(app) {
                        app.exit(0);
                    } else {
                        show_main(app);
                        let _ = app.notification().builder().title("Strict session active").body("MONK MODE stays open until your commitment ends or you use the emergency exit.").show();
                    }
                }
                _ => {}
            }
        })
        .build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(2_000_000)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("monk-mode.sqlite");
            let database = db::Db::open(&db_path).map_err(|e| Box::new(std::io::Error::other(e.to_string())))?;
            {
                let conn = database.conn();
                if let Ok(problems) = db::integrity_check(&conn) {
                    for p in problems {
                        log::error!("database check: {p}");
                    }
                }
                seed::seed_defaults(&conn).map_err(|e| Box::new(std::io::Error::other(e.to_string())))?;
                settings::extension_token(&conn).map_err(|e| Box::new(std::io::Error::other(e.to_string())))?;
            }
            let block_set = Arc::new(Mutex::new(ActiveBlockSet::default()));
            app.manage(AppState { db: database.clone(), data_dir: data_dir.clone(), block_set: block_set.clone() });

            let handle = app.handle().clone();
            let notifier = Arc::new(TauriNotifier { app: handle.clone(), db: database.clone() });
            monitor::Monitor::new(database.clone(), data_dir, block_set.clone(), notifier).spawn();

            let bridge_handle = handle.clone();
            let port = std::env::var("MONK_BRIDGE_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(bridge::DEFAULT_PORT);
            bridge::spawn(
                bridge::BridgeState {
                    db: database.clone(),
                    block_set,
                    on_change: Box::new(move |what| {
                        let _ = bridge_handle.emit("monk://data", what);
                    }),
                },
                port,
            );

            build_tray(&handle)?;
            let minimized = std::env::args().any(|a| a == "--minimized");
            if minimized {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let state = app.state::<AppState>();
                let to_tray = settings::flag(&state.db.conn(), "closeToTray", true);
                if to_tray || !quit_allowed(app) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::db_list,
            commands::db_upsert,
            commands::db_delete,
            commands::db_integrity,
            commands::settings_all,
            commands::settings_set,
            commands::autostart_status,
            commands::extension_token_regenerate,
            commands::focus_snapshot,
            commands::focus_start,
            commands::focus_pause,
            commands::focus_resume,
            commands::focus_end,
            commands::focus_reset,
            commands::focus_skip_break,
            commands::session_update,
            commands::session_delete,
            commands::strict_status,
            commands::strict_start,
            commands::strict_pause,
            commands::strict_resume,
            commands::strict_request_exit,
            commands::strict_abort_exit,
            commands::block_set_current,
            commands::quick_block_start,
            commands::quick_block_stop,
            commands::exception_grant,
            commands::apps_running,
            commands::apps_installed,
            commands::hosts_status,
            commands::hosts_apply,
            commands::hosts_remove,
            commands::backup_export,
            commands::backup_import,
            commands::save_text_file,
            commands::export_json_payload,
            commands::data_wipe,
        ])
        .build(tauri::generate_context!())
        .expect("error while building MONK MODE")
        .run(|app, event| {
            // ⌘Q / system quit requests arrive with no exit code. They are honoured except while a
            // strict or maximum commitment is running (the window is shown with an explanation).
            if let tauri::RunEvent::ExitRequested { api, code: None, .. } = event {
                if !quit_allowed(app) {
                    api.prevent_exit();
                    show_main(app);
                }
            }
        });
}
