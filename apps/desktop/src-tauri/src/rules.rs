//! Rule evaluation shared in spirit with packages/shared-core (schedule.ts, matching.ts,
//! blockset.ts). Verified against the same JSON vectors in tests.

use crate::error::AppResult;
use chrono::{Datelike, Local, NaiveDateTime, TimeZone, Timelike};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};

// ---------- Schedules ----------

pub fn window_active(days_mask: i64, start: i64, end: i64, at: &NaiveDateTime) -> bool {
    let day = at.weekday().num_days_from_monday() as i64;
    let minute = (at.hour() * 60 + at.minute()) as i64;
    let in_mask = |d: i64| days_mask & (1 << d) != 0;
    if start == end {
        return in_mask(day);
    }
    if start < end {
        return in_mask(day) && minute >= start && minute < end;
    }
    let prev = (day + 6) % 7;
    (in_mask(day) && minute >= start) || (in_mask(prev) && minute < end)
}

pub fn local_naive(ms: i64) -> NaiveDateTime {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|d| d.naive_local())
        .unwrap_or_default()
}

/// Epoch ms of local midnight for the day containing `ms`.
pub fn local_day_start(ms: i64) -> i64 {
    let date = local_naive(ms).date();
    let midnight = date.and_hms_opt(0, 0, 0).unwrap_or_default();
    Local
        .from_local_datetime(&midnight)
        .earliest()
        .map(|d| d.timestamp_millis())
        .unwrap_or(ms - ms.rem_euclid(86_400_000))
}

// ---------- Domains & apps ----------

pub fn normalize_domain(input: &str) -> Option<String> {
    let mut s = input.trim().to_lowercase();
    if s == "*" {
        return Some(s);
    }
    if let Some(i) = s.find("://") {
        if s[..i].chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c)) {
            s = s[i + 3..].to_string();
        }
    }
    s = s.split(['/', '?', '#']).next().unwrap_or("").to_string();
    if let Some(i) = s.rfind('@') {
        s = s[i + 1..].to_string();
    }
    if let Some(i) = s.rfind(':') {
        if s[i + 1..].chars().all(|c| c.is_ascii_digit()) {
            s.truncate(i);
        }
    }
    let s = s.trim_end_matches('.');
    let s = s.strip_prefix("*.").unwrap_or(s);
    let s = s.strip_prefix("www.").unwrap_or(s);
    if s.is_empty() || s.len() > 253 {
        return None;
    }
    let valid = s.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    });
    valid.then(|| s.to_string())
}

pub fn host_matches(host: &str, rule: &str) -> bool {
    if rule == "*" {
        return true;
    }
    let h = host.to_lowercase();
    let h = h.trim_end_matches('.');
    h == rule || h.ends_with(&format!(".{rule}"))
}

/// Protected processes are never terminated, even if a rule matches them.
const PROTECTED_PROCESSES: &[&str] = &[
    "finder", "dock", "loginwindow", "windowserver", "systemuiserver", "launchd", "kernel_task",
    "explorer.exe", "explorer", "winlogon.exe", "csrss.exe", "dwm.exe", "lsass.exe", "services.exe",
    "svchost.exe", "smss.exe", "wininit.exe", "monk mode", "monk-mode", "monk-mode.exe", "monk mode.exe",
];

pub fn is_protected(name: &str) -> bool {
    PROTECTED_PROCESSES.contains(&name.to_lowercase().as_str())
}

pub fn app_matches(rule: &str, candidates: &[&str]) -> bool {
    let r = rule.trim().to_lowercase();
    if r.is_empty() {
        return false;
    }
    candidates.iter().any(|c| {
        let v = c.trim().to_lowercase();
        if v.is_empty() {
            return false;
        }
        if v == r {
            return true;
        }
        let base = v.rsplit(['/', '\\']).next().unwrap_or(&v);
        let stem = base.strip_suffix(".exe").or_else(|| base.strip_suffix(".app")).unwrap_or(base);
        base == r || stem == r
    })
}

// ---------- Presets ----------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub domains: Vec<String>,
    pub url_patterns: Vec<String>,
}

pub fn presets() -> &'static [Preset] {
    use std::sync::OnceLock;
    static PRESETS: OnceLock<Vec<Preset>> = OnceLock::new();
    PRESETS.get_or_init(|| {
        serde_json::from_str(include_str!("../../../../packages/shared-core/data/presets.json"))
            .unwrap_or_default()
    })
}

// ---------- Active block set ----------

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActiveBlockSet {
    pub computed_at: i64,
    pub active: bool,
    pub strict: bool,
    pub triggers: Vec<String>,
    pub apps: Vec<String>,
    pub domains: Vec<String>,
    pub url_patterns: Vec<String>,
    pub allow_domains: Vec<String>,
    pub allow_apps: Vec<String>,
    pub source_list: BTreeMap<String, String>,
    /// app/domain → trigger that activated it (for block-event attribution).
    #[serde(skip)]
    pub trigger_for: HashMap<String, String>,
}

struct Rule {
    list_id: String,
    kind: String,
    value: String,
    platform: String,
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else {
        "linux"
    }
}

/// Resolves what must be blocked now from the database. `focus_active` reflects the focus engine.
pub fn resolve(conn: &Connection, now: i64, focus_active: bool, strict_lists: &[String]) -> AppResult<ActiveBlockSet> {
    let at = local_naive(now);
    let mut triggers: BTreeMap<String, BTreeSet<&'static str>> = BTreeMap::new();

    let mut stmt = conn.prepare("SELECT id, block_during_focus FROM blocklists WHERE enabled = 1 AND kind = 'block'")?;
    let lists: Vec<(String, bool)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? == 1)))?
        .collect::<Result<_, _>>()?;
    let enabled: BTreeSet<&str> = lists.iter().map(|(id, _)| id.as_str()).collect();
    if focus_active {
        for (id, during_focus) in &lists {
            if *during_focus {
                triggers.entry(id.clone()).or_default().insert("focus");
            }
        }
    }
    let mut stmt = conn.prepare("SELECT list_id, days_mask, start_minute, end_minute, strict FROM schedules WHERE enabled = 1")?;
    let rows: Vec<(String, i64, i64, i64, bool)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get::<_, i64>(4)? == 1)))?
        .collect::<Result<_, _>>()?;
    for (list, mask, start, end, strict) in rows {
        if enabled.contains(list.as_str()) && window_active(mask, start, end, &at) {
            triggers.entry(list).or_default().insert(if strict { "strict" } else { "schedule" });
        }
    }
    let mut stmt = conn.prepare("SELECT list_id FROM quick_blocks WHERE ended_at IS NULL AND started_at <= ?1 AND ends_at > ?1")?;
    let quick: Vec<String> = stmt.query_map([now], |r| r.get(0))?.collect::<Result<_, _>>()?;
    for list in quick {
        if enabled.contains(list.as_str()) {
            triggers.entry(list).or_default().insert("manual");
        }
    }
    for list in strict_lists {
        triggers.entry(list.clone()).or_default().insert("strict");
    }

    let mut stmt = conn.prepare("SELECT list_id, type, value, platform FROM block_rules")?;
    let rules: Vec<Rule> = stmt
        .query_map([], |r| Ok(Rule { list_id: r.get(0)?, kind: r.get(1)?, value: r.get(2)?, platform: r.get(3)? }))?
        .collect::<Result<_, _>>()?;
    let platform = current_platform();
    let applies = |r: &Rule| r.platform == "all" || r.platform == platform;

    let mut set = ActiveBlockSet { computed_at: now, ..Default::default() };
    let (mut apps, mut domains, mut patterns) = (BTreeSet::new(), BTreeSet::new(), BTreeSet::new());
    let mut strict_targets = BTreeSet::new();
    let mut all_triggers = BTreeSet::new();
    for (list_id, trig) in &triggers {
        let is_strict = trig.contains("strict");
        let primary = if is_strict { "strict" } else { trig.iter().next().copied().unwrap_or("manual") };
        all_triggers.extend(trig.iter().copied());
        let mut push = |bucket: &mut BTreeSet<String>, v: &str, set: &mut ActiveBlockSet| {
            bucket.insert(v.to_string());
            set.source_list.entry(v.to_string()).or_insert_with(|| list_id.clone());
            set.trigger_for.entry(v.to_string()).or_insert_with(|| primary.to_string());
            if is_strict {
                strict_targets.insert(v.to_string());
            }
        };
        for r in rules.iter().filter(|r| &r.list_id == list_id && applies(r)) {
            match r.kind.as_str() {
                "app" => push(&mut apps, &r.value, &mut set),
                "domain" => push(&mut domains, &r.value, &mut set),
                "url_pattern" => push(&mut patterns, &r.value, &mut set),
                "category" => {
                    if let Some(p) = presets().iter().find(|p| p.id == r.value) {
                        for d in &p.domains {
                            push(&mut domains, d, &mut set);
                        }
                        for u in &p.url_patterns {
                            push(&mut patterns, u, &mut set);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    // Daily usage limits.
    let day_start = local_day_start(now);
    let mut stmt = conn.prepare(
        "SELECT l.type, l.value, l.minutes_per_day,
           CASE l.type WHEN 'app' THEN (SELECT COALESCE(SUM(duration_ms),0) FROM app_usage u WHERE u.started_at >= ?1 AND (lower(u.app_id) = lower(l.value) OR lower(u.app_name) = lower(l.value)))
                       ELSE (SELECT COALESCE(SUM(duration_ms),0) FROM web_usage w WHERE w.started_at >= ?1 AND (w.domain = l.value OR w.domain LIKE '%.' || l.value)) END
         FROM usage_limits l WHERE l.enabled = 1 AND (l.platform = 'all' OR l.platform = ?2)",
    )?;
    let limits: Vec<(String, String, i64, i64)> = stmt
        .query_map(rusqlite::params![day_start, platform], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<Result<_, _>>()?;
    for (kind, value, minutes, used) in limits {
        if used >= minutes * 60_000 {
            all_triggers.insert("limit");
            set.trigger_for.entry(value.clone()).or_insert_with(|| "limit".into());
            if kind == "app" { apps.insert(value) } else { domains.insert(value) };
        }
    }

    // Allowlists and temporary exceptions (exceptions never override strict targets).
    let mut stmt = conn.prepare(
        "SELECT r.type, r.value, r.platform FROM block_rules r JOIN blocklists l ON l.id = r.list_id WHERE l.enabled = 1 AND l.kind = 'allow'",
    )?;
    let allow: Vec<(String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    let (mut allow_apps, mut allow_domains) = (BTreeSet::new(), BTreeSet::new());
    for (kind, value, plat) in allow {
        if plat != "all" && plat != platform {
            continue;
        }
        match kind.as_str() {
            "app" => allow_apps.insert(value),
            "domain" => allow_domains.insert(value),
            _ => false,
        };
    }
    let mut stmt = conn.prepare("SELECT type, value FROM exceptions WHERE until_at > ?1")?;
    let exceptions: Vec<(String, String)> = stmt.query_map([now], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
    for (kind, value) in exceptions {
        if strict_targets.contains(&value) {
            continue;
        }
        if kind == "app" { allow_apps.insert(value) } else { allow_domains.insert(value) };
    }
    for a in &allow_apps {
        apps.remove(a);
    }

    set.active = !(apps.is_empty() && domains.is_empty() && patterns.is_empty());
    set.strict = !strict_targets.is_empty();
    set.triggers = all_triggers.into_iter().map(String::from).collect();
    set.apps = apps.into_iter().collect();
    set.domains = domains.into_iter().collect();
    set.url_patterns = patterns.into_iter().collect();
    set.allow_apps = allow_apps.into_iter().collect();
    set.allow_domains = allow_domains.into_iter().collect();
    Ok(set)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn shared_schedule_vectors() {
        let v: serde_json::Value =
            serde_json::from_str(include_str!("../../../../packages/shared-core/vectors/schedules.json")).unwrap();
        for c in v["cases"].as_array().unwrap() {
            let at = NaiveDateTime::parse_from_str(c["at"].as_str().unwrap(), "%Y-%m-%dT%H:%M").unwrap();
            let got = window_active(
                c["daysMask"].as_i64().unwrap(),
                c["startMinute"].as_i64().unwrap(),
                c["endMinute"].as_i64().unwrap(),
                &at,
            );
            assert_eq!(got, c["expected"].as_bool().unwrap(), "{}", c["name"]);
        }
    }

    #[test]
    fn shared_normalize_vectors() {
        let v: serde_json::Value =
            serde_json::from_str(include_str!("../../../../packages/shared-core/vectors/urls.json")).unwrap();
        for n in v["normalize"].as_array().unwrap() {
            assert_eq!(
                normalize_domain(n["input"].as_str().unwrap()),
                n["expected"].as_str().map(String::from),
                "{}",
                n["input"]
            );
        }
        assert!(host_matches("vm.tiktok.com", "tiktok.com"));
        assert!(!host_matches("notreddit.com", "reddit.com"));
    }

    #[test]
    fn matches_apps_and_protects_system_processes() {
        assert!(app_matches("Discord", &["Discord", "/Applications/Discord.app/Contents/MacOS/Discord"]));
        assert!(app_matches("steam", &["steam.exe"]));
        assert!(!app_matches("code", &["codex"]));
        assert!(is_protected("Finder"));
        assert!(is_protected("explorer.exe"));
    }

    #[test]
    fn presets_load_from_shared_json() {
        assert!(presets().iter().any(|p| p.id == "short-feeds" && p.url_patterns.iter().any(|u| u.starts_with("youtube.com/shorts"))));
    }

    #[test]
    fn resolves_focus_quick_block_allow_and_limits() {
        let db = Db::open_in_memory().unwrap();
        let c = db.conn();
        c.execute_batch(
            "INSERT INTO blocklists (id, name, kind, created_at, updated_at) VALUES ('w','Work','block',0,0), ('q','Quick','block',0,0), ('a','Allow','allow',0,0);
             UPDATE blocklists SET block_during_focus = 0 WHERE id = 'q';
             INSERT INTO block_rules (id, list_id, type, value, created_at) VALUES
               ('1','w','domain','reddit.com',0), ('2','w','app','Discord',0), ('3','q','app','Steam',0),
               ('4','w','category','short-feeds',0), ('5','a','domain','old.reddit.com',0), ('6','w','app','Slack',0);
             INSERT INTO block_rules (id, list_id, type, value, platform, created_at) VALUES ('7','w','app','com.x.android','android',0);
             INSERT INTO usage_limits (id, type, value, minutes_per_day, created_at) VALUES ('u','app','Mail',1,0);",
        )
        .unwrap();
        let now = crate::db::now_ms();
        let idle = resolve(&c, now, false, &[]).unwrap();
        assert!(!idle.active);

        let focus = resolve(&c, now, true, &[]).unwrap();
        assert_eq!(focus.apps, vec!["Discord", "Slack"]);
        assert!(focus.domains.contains(&"tiktok.com".to_string()));
        assert_eq!(focus.allow_domains, vec!["old.reddit.com"]);
        assert_eq!(focus.triggers, vec!["focus"]);

        c.execute("INSERT INTO quick_blocks (id, list_id, started_at, ends_at) VALUES ('qb','q',?1,?2)", [now - 1000, now + 60_000]).unwrap();
        c.execute("INSERT INTO exceptions (id, type, value, until_at, created_at) VALUES ('e','app','Slack',?1,0)", [now + 60_000]).unwrap();
        c.execute(
            "INSERT INTO app_usage (id, app_id, app_name, started_at, ended_at, duration_ms, platform, source) VALUES ('x','com.apple.mail','Mail',?1,?1,120000,'macos','test')",
            [now],
        )
        .unwrap();
        let set = resolve(&c, now, true, &[]).unwrap();
        assert!(set.apps.contains(&"Steam".to_string()));
        assert!(set.apps.contains(&"Mail".to_string()));
        assert!(!set.apps.contains(&"Slack".to_string()));
        assert!(set.triggers.contains(&"limit".to_string()));

        // Exceptions cannot weaken a strict session.
        let strict = resolve(&c, now, false, &["w".to_string()]).unwrap();
        assert!(strict.strict);
        assert!(strict.apps.contains(&"Slack".to_string()));
    }
}
