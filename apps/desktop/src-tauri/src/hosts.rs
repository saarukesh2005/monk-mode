//! Optional, consent-based system-wide domain blocking via the hosts file.
//! Only the section between our BEGIN/END markers is ever written or removed; the rest of the
//! file is preserved byte-for-byte. Every change keeps a timestamped backup and a ledger row in
//! `system_changes`, and requires the user's administrator approval (osascript / UAC).

use crate::db::{new_id, now_ms};
use crate::error::{AppError, AppResult};
use crate::rules::normalize_domain;
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};

pub const BEGIN: &str = "# >>> MONK MODE BEGIN (managed by MONK MODE; remove via the app) >>>";
pub const END: &str = "# <<< MONK MODE END <<<";
const MAX_DOMAINS: usize = 2000;

pub fn hosts_path() -> PathBuf {
    if cfg!(windows) {
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        PathBuf::from(root).join("System32").join("drivers").join("etc").join("hosts")
    } else {
        PathBuf::from("/etc/hosts")
    }
}

/// Removes our managed section (if any) and returns the remaining content unchanged.
pub fn strip_managed(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    let mut inside = false;
    for line in content.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed == BEGIN {
            inside = true;
            continue;
        }
        if inside && trimmed == END {
            inside = false;
            continue;
        }
        if !inside {
            out.push_str(line);
        }
    }
    out
}

/// Domains currently blocked by our managed section (without the www. duplicates).
pub fn managed_domains(content: &str) -> Vec<String> {
    let mut inside = false;
    let mut out = Vec::new();
    for line in content.lines().map(str::trim_end) {
        if line == BEGIN {
            inside = true;
        } else if line == END {
            inside = false;
        } else if inside {
            if let Some(d) = line.strip_prefix("0.0.0.0 ").filter(|d| !d.starts_with("www.")) {
                out.push(d.to_string());
            }
        }
    }
    out
}

pub fn has_managed(content: &str) -> bool {
    content.lines().any(|l| l.trim_end() == BEGIN)
}

/// Produces the new hosts content blocking `domains` (wildcard and invalid entries are skipped).
pub fn render(content: &str, domains: &[String]) -> String {
    let base = strip_managed(content);
    let mut clean: Vec<String> = domains
        .iter()
        .filter_map(|d| normalize_domain(d))
        .filter(|d| d != "*" && d != "localhost")
        .collect();
    clean.sort();
    clean.dedup();
    clean.truncate(MAX_DOMAINS);
    if clean.is_empty() {
        return base;
    }
    let nl = if content.contains("\r\n") { "\r\n" } else { "\n" };
    let mut out = base;
    if !out.is_empty() && !out.ends_with('\n') {
        out.push_str(nl);
    }
    out.push_str(BEGIN);
    out.push_str(nl);
    for d in &clean {
        for host in [d.clone(), format!("www.{d}")] {
            out.push_str(&format!("0.0.0.0 {host}{nl}:: {host}{nl}"));
        }
    }
    out.push_str(END);
    out.push_str(nl);
    out
}

pub fn read_hosts() -> AppResult<String> {
    Ok(std::fs::read_to_string(hosts_path())?)
}

fn safe_path_str(p: &Path) -> AppResult<String> {
    let s = p.to_string_lossy().to_string();
    if s.contains('"') || s.contains('\'') || s.contains('\n') {
        return Err(AppError::invalid("Unsupported characters in the app data path"));
    }
    Ok(s)
}

#[cfg(target_os = "macos")]
fn elevated_copy(src: &Path) -> AppResult<()> {
    let src = safe_path_str(src)?;
    let script = [
        "on run argv",
        "do shell script \"/bin/cp \" & quoted form of (item 1 of argv) & \" /etc/hosts && /usr/bin/dscacheutil -flushcache; /usr/bin/killall -HUP mDNSResponder || true\" with prompt \"MONK MODE needs your permission to update website blocking in /etc/hosts.\" with administrator privileges",
        "end run",
    ];
    let mut cmd = std::process::Command::new("/usr/bin/osascript");
    for line in script {
        cmd.arg("-e").arg(line);
    }
    let out = cmd.arg(src).output()?;
    if !out.status.success() {
        return Err(AppError::refused("Administrator approval was cancelled or failed. No changes were made."));
    }
    Ok(())
}

#[cfg(windows)]
fn elevated_copy(src: &Path) -> AppResult<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let src = safe_path_str(src)?;
    let dst = safe_path_str(&hosts_path())?;
    let inner = format!("/c copy /y \"{src}\" \"{dst}\" && ipconfig /flushdns");
    let ps = format!("Start-Process -FilePath cmd.exe -ArgumentList '{inner}' -Verb RunAs -Wait -WindowStyle Hidden");
    let status = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
        .creation_flags(CREATE_NO_WINDOW)
        .status()?;
    if !status.success() {
        return Err(AppError::refused("Administrator approval was cancelled or failed. No changes were made."));
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", windows)))]
fn elevated_copy(_src: &Path) -> AppResult<()> {
    Err(AppError::refused("Hosts-file blocking is not supported on this platform"))
}

/// Writes the managed section for `domains` (empty = remove our section). Returns whether the
/// file changed. `work_dir` holds the staged file and backups.
pub fn apply(conn: &Connection, work_dir: &Path, domains: &[String]) -> AppResult<bool> {
    let current = read_hosts()?;
    let next = render(&current, domains);
    if next == current {
        return Ok(false);
    }
    let backups = work_dir.join("hosts-backups");
    std::fs::create_dir_all(&backups)?;
    let ts = now_ms();
    let backup = backups.join(format!("hosts-{ts}.bak"));
    std::fs::write(&backup, &current)?;
    let staged = work_dir.join("hosts.staged");
    std::fs::write(&staged, &next)?;
    let result = elevated_copy(&staged);
    let _ = std::fs::remove_file(&staged);
    result?;
    // Verify the write took effect rather than assuming it did.
    if read_hosts()? != next {
        return Err(AppError::refused("The hosts file did not update (another program may be protecting it)."));
    }
    let kind = if domains.is_empty() { "hosts_removed" } else { "hosts_applied" };
    conn.execute(
        "INSERT INTO system_changes (id, kind, target, backup_path, applied_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![new_id(), kind, hosts_path().to_string_lossy(), backup.to_string_lossy(), ts],
    )?;
    if domains.is_empty() {
        conn.execute("UPDATE system_changes SET reverted_at = ?1 WHERE kind = 'hosts_applied' AND reverted_at IS NULL", [ts])?;
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ORIGINAL: &str = "127.0.0.1 localhost\n# user entry\n10.0.0.5 nas.local\n";

    #[test]
    fn render_appends_and_strip_restores_exactly() {
        let out = render(ORIGINAL, &["https://www.reddit.com/".into(), "reddit.com".into(), "*".into(), "bad domain".into()]);
        assert!(out.starts_with(ORIGINAL));
        assert!(out.contains("0.0.0.0 reddit.com\n"));
        assert!(out.contains("0.0.0.0 www.reddit.com\n"));
        assert!(out.contains(":: reddit.com\n"));
        assert_eq!(out.matches("0.0.0.0 reddit.com\n").count(), 1);
        assert!(!out.contains("bad domain"));
        assert_eq!(strip_managed(&out), ORIGINAL);
        assert_eq!(managed_domains(&out), vec!["reddit.com".to_string()]);
        assert_eq!(render(&out, &[]), ORIGINAL);
    }

    #[test]
    fn re_render_replaces_previous_section() {
        let a = render(ORIGINAL, &["a.com".into()]);
        let b = render(&a, &["b.com".into()]);
        assert!(!b.contains("a.com"));
        assert_eq!(b.matches(BEGIN).count(), 1);
    }

    #[test]
    fn preserves_crlf_and_missing_trailing_newline() {
        let win = "127.0.0.1 localhost\r\n10.0.0.1 router";
        let out = render(win, &["x.com".into()]);
        assert!(out.contains("\r\n0.0.0.0 x.com") || out.contains("router\r\n# >>>"));
        assert_eq!(strip_managed(&out).trim_end(), win);
    }

    #[test]
    fn never_touches_lines_outside_markers() {
        let tricky = format!("{ORIGINAL}# >>> MONK MODE something else\n");
        assert_eq!(strip_managed(&tricky), tricky);
    }
}
