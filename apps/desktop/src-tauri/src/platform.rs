//! OS integration: running processes, termination, frontmost application and idle time.
//! Only processes owned by the current user are ever terminated, and protected system
//! processes are always skipped (see rules::is_protected).

use crate::rules::{app_matches, is_protected};
use serde::Serialize;
use std::collections::BTreeMap;
use sysinfo::{Pid, ProcessesToUpdate, Signal, System};

#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// Stable identifier used in rules (macOS: app name; Windows: exe file name).
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Foreground {
    pub app_id: String,
    pub app_name: String,
}

pub struct ProcessMonitor {
    sys: System,
    self_pid: Option<Pid>,
}

/// "/Applications/Foo.app/Contents/MacOS/Foo" → "/Applications/Foo.app".
fn bundle_path(exe: &str) -> Option<&str> {
    exe.find(".app/").map(|i| &exe[..i + 4])
}

fn display_name(proc_name: &str, exe: &str) -> String {
    if let Some(bundle) = bundle_path(exe) {
        if let Some(stem) = bundle.rsplit('/').next().and_then(|b| b.strip_suffix(".app")) {
            return stem.to_string();
        }
    }
    proc_name.to_string()
}

impl Default for ProcessMonitor {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessMonitor {
    pub fn new() -> Self {
        Self { sys: System::new(), self_pid: sysinfo::get_current_pid().ok() }
    }

    pub fn refresh(&mut self) {
        self.sys.refresh_processes(ProcessesToUpdate::All, true);
    }

    fn current_uid(&self) -> Option<sysinfo::Uid> {
        self.self_pid.and_then(|p| self.sys.process(p)).and_then(|p| p.user_id().cloned())
    }

    /// User-owned GUI-ish applications currently running, deduplicated by name.
    pub fn running_apps(&self) -> Vec<AppInfo> {
        let uid = self.current_uid();
        let mut out = BTreeMap::new();
        for p in self.sys.processes().values() {
            if uid.is_some() && p.user_id() != uid.as_ref() {
                continue;
            }
            let name = p.name().to_string_lossy().to_string();
            let exe = p.exe().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
            let is_app = if cfg!(target_os = "macos") {
                bundle_path(&exe).is_some_and(|b| !b.contains("/System/") && !b.contains(".app/Contents/"))
            } else {
                exe.to_lowercase().ends_with(".exe") && !exe.to_lowercase().contains("\\windows\\")
            };
            if !is_app || is_protected(&name) {
                continue;
            }
            let display = display_name(&name, &exe);
            let id = if cfg!(target_os = "macos") { display.clone() } else { name.clone() };
            let path = bundle_path(&exe).unwrap_or(&exe).to_string();
            out.entry(id.to_lowercase()).or_insert(AppInfo { id, name: display, path });
        }
        out.into_values().collect()
    }

    /// Finds running user processes matching any blocked app rule (minus allowed apps).
    /// Returns (pid, rule, display name).
    pub fn find_blocked(&self, blocked: &[String], allowed: &[String]) -> Vec<(Pid, String, String)> {
        if blocked.is_empty() {
            return Vec::new();
        }
        let uid = self.current_uid();
        let mut hits = Vec::new();
        for (pid, p) in self.sys.processes() {
            if Some(*pid) == self.self_pid || (uid.is_some() && p.user_id() != uid.as_ref()) {
                continue;
            }
            let name = p.name().to_string_lossy().to_string();
            if is_protected(&name) {
                continue;
            }
            let exe = p.exe().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
            let display = display_name(&name, &exe);
            let bundle = bundle_path(&exe).unwrap_or("").to_string();
            let candidates = [name.as_str(), exe.as_str(), display.as_str(), bundle.as_str()];
            if allowed.iter().any(|a| app_matches(a, &candidates)) {
                continue;
            }
            if let Some(rule) = blocked.iter().find(|r| app_matches(r, &candidates)) {
                hits.push((*pid, rule.clone(), display));
            }
        }
        hits
    }

    /// Main browser processes owned by the user: (pid, display name, extension family).
    /// Safari reports the family "safari", which can never carry the MONK MODE extension.
    pub fn running_browsers(&self) -> Vec<(Pid, String, &'static str)> {
        let uid = self.current_uid();
        self.sys
            .processes()
            .iter()
            .filter(|(_, p)| uid.is_none() || p.user_id() == uid.as_ref())
            .filter_map(|(pid, p)| {
                let name = p.name().to_string_lossy().to_string();
                browser_family_of_process(&name).map(|f| (*pid, name, f))
            })
            .collect()
    }

    /// Asks the process to quit (SIGTERM / TerminateProcess). Returns false if it is gone.
    pub fn terminate(&self, pid: Pid) -> bool {
        match self.sys.process(pid) {
            Some(p) => p.kill_with(Signal::Term).unwrap_or_else(|| p.kill()),
            None => false,
        }
    }

    pub fn force_kill(&self, pid: Pid) -> bool {
        self.sys.process(pid).map(|p| p.kill()).unwrap_or(false)
    }

    pub fn is_alive(&self, pid: Pid) -> bool {
        self.sys.process(pid).is_some()
    }

    pub fn process_name(&self, pid: Pid) -> Option<(String, String)> {
        self.sys.process(pid).map(|p| {
            let name = p.name().to_string_lossy().to_string();
            let exe = p.exe().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
            (name, exe)
        })
    }
}

/// Exact main-process names of browsers (helpers/renderers are children and close with them).
pub fn browser_family_of_process(name: &str) -> Option<&'static str> {
    match name.to_ascii_lowercase().as_str() {
        "google chrome" | "brave browser" | "vivaldi" | "opera" | "arc" | "chromium" | "chrome.exe" | "brave.exe" | "vivaldi.exe" | "opera.exe" => Some("chromium"),
        "microsoft edge" | "msedge.exe" => Some("edge"),
        "firefox" | "firefox.exe" => Some("firefox"),
        "safari" => Some("safari"),
        _ => None,
    }
}

/// Installed application bundles (macOS) for the app picker.
pub fn installed_apps() -> Vec<AppInfo> {
    #[cfg(target_os = "macos")]
    {
        let mut dirs = vec![std::path::PathBuf::from("/Applications"), std::path::PathBuf::from("/System/Applications")];
        if let Ok(home) = std::env::var("HOME") {
            dirs.push(std::path::PathBuf::from(home).join("Applications"));
        }
        let mut out = BTreeMap::new();
        for dir in dirs {
            let Ok(entries) = std::fs::read_dir(&dir) else { continue };
            for e in entries.flatten() {
                let path = e.path();
                if path.extension().and_then(|x| x.to_str()) != Some("app") {
                    continue;
                }
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    out.entry(stem.to_lowercase()).or_insert(AppInfo { id: stem.into(), name: stem.into(), path: path.to_string_lossy().into() });
                }
            }
        }
        out.into_values().collect()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

// ---------- Frontmost application & idle time ----------

#[cfg(target_os = "macos")]
pub fn foreground(_mon: &ProcessMonitor) -> Option<Foreground> {
    use objc2_app_kit::NSWorkspace;
    #[allow(unused_unsafe)]
    // SAFETY: NSWorkspace/NSRunningApplication accessors are read-only Objective-C calls that
    // return retained objects; no pointers escape this block.
    unsafe {
        let ws = NSWorkspace::sharedWorkspace();
        let app = ws.frontmostApplication()?;
        let name = app.localizedName().map(|s| s.to_string()).unwrap_or_default();
        if name.is_empty() {
            return None;
        }
        Some(Foreground { app_id: name.clone(), app_name: name })
    }
}

#[cfg(windows)]
pub fn foreground(mon: &ProcessMonitor) -> Option<Foreground> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    // SAFETY: plain Win32 calls with a valid out-pointer to a local u32.
    let pid = unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        pid
    };
    if pid == 0 {
        return None;
    }
    let (name, exe) = mon.process_name(Pid::from_u32(pid))?;
    let display = std::path::Path::new(&exe)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(String::from)
        .unwrap_or_else(|| name.clone());
    Some(Foreground { app_id: name, app_name: display })
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn foreground(_mon: &ProcessMonitor) -> Option<Foreground> {
    None
}

#[cfg(target_os = "macos")]
pub fn idle_seconds() -> f64 {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
    }
    const COMBINED_SESSION_STATE: i32 = 0;
    const ANY_INPUT_EVENT: u32 = u32::MAX;
    // SAFETY: pure query function with value arguments.
    unsafe { CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION_STATE, ANY_INPUT_EVENT) }
}

#[cfg(windows)]
pub fn idle_seconds() -> f64 {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: info is a properly sized, initialised LASTINPUTINFO.
    unsafe {
        if GetLastInputInfo(&mut info) == 0 {
            return 0.0;
        }
        GetTickCount().wrapping_sub(info.dwTime) as f64 / 1000.0
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn idle_seconds() -> f64 {
    0.0
}

pub fn platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else {
        "linux"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_bundle_names() {
        assert_eq!(bundle_path("/Applications/Discord.app/Contents/MacOS/Discord"), Some("/Applications/Discord.app"));
        assert_eq!(display_name("Electron", "/Applications/Slack.app/Contents/MacOS/Slack"), "Slack");
        assert_eq!(display_name("steam.exe", "C:\\Steam\\steam.exe"), "steam.exe");
    }

    #[test]
    fn classifies_browser_processes() {
        assert_eq!(browser_family_of_process("Google Chrome"), Some("chromium"));
        assert_eq!(browser_family_of_process("msedge.exe"), Some("edge"));
        assert_eq!(browser_family_of_process("firefox"), Some("firefox"));
        assert_eq!(browser_family_of_process("Safari"), Some("safari"));
        assert_eq!(browser_family_of_process("Google Chrome Helper (Renderer)"), None);
    }

    #[test]
    fn lists_processes_without_panicking() {
        let mut m = ProcessMonitor::new();
        m.refresh();
        let _ = m.running_apps();
        assert!(m.find_blocked(&[], &[]).is_empty());
        // Never matches our own process even with a catch-all-looking rule.
        let me = m.self_pid.unwrap();
        assert!(m.find_blocked(&["monk_mode_lib".into()], &[]).iter().all(|(p, _, _)| *p != me));
    }
}
