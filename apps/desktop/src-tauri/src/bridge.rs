//! Loopback-only HTTP bridge between the desktop app and the browser extensions.
//! - Binds to 127.0.0.1 only; nothing is reachable from the network.
//! - Every endpoint except /v1/ping requires the per-install token (X-Monk-Token).
//! - CORS headers are only returned to browser-extension origins, so ordinary web pages
//!   cannot read responses even if they guess the port.

use crate::db::{new_id, now_ms, Db};
use crate::error::AppResult;
use crate::repo::query_json;
use crate::rules::{host_matches, normalize_domain, ActiveBlockSet};
use crate::{focus, settings, strict};
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value as Json};
use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex};
use tiny_http::{Header, Method, Request, Response, Server};

pub const DEFAULT_PORT: u16 = 47613;
const MAX_BODY: u64 = 256 * 1024;
const MAX_USAGE_RECORD_MS: i64 = 60 * 60 * 1000;
const MAX_EXCEPTION_MIN: i64 = 30;

/// Browser family ("chromium", "edge", "firefox") → last time its extension synced.
pub type Heartbeats = Arc<Mutex<HashMap<String, i64>>>;

pub struct BridgeState {
    pub db: Db,
    pub block_set: Arc<Mutex<ActiveBlockSet>>,
    pub heartbeats: Heartbeats,
    pub on_change: Box<dyn Fn(&str) + Send + Sync>,
}

/// Maps the extension's self-reported browser name to a family used for enforcement checks.
pub fn browser_family(name: &str) -> Option<&'static str> {
    match name.to_ascii_lowercase().as_str() {
        "chromium" | "chrome" | "brave" => Some("chromium"),
        "edge" => Some("edge"),
        "firefox" => Some("firefox"),
        _ => None,
    }
}

fn allowed_origin(req: &Request) -> Option<String> {
    req.headers()
        .iter()
        .find(|h| h.field.equiv("Origin"))
        .map(|h| h.value.as_str().to_string())
        .filter(|o| o.starts_with("chrome-extension://") || o.starts_with("moz-extension://") || o.starts_with("extension://"))
}

fn header(name: &str, value: &str) -> Option<Header> {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).ok()
}

fn respond(req: Request, status: u16, body: Json) {
    let origin = allowed_origin(&req);
    let mut resp = Response::from_string(body.to_string()).with_status_code(status);
    let mut headers = vec![header("Content-Type", "application/json"), header("Cache-Control", "no-store")];
    if let Some(o) = origin {
        headers.push(header("Access-Control-Allow-Origin", &o));
        headers.push(header("Vary", "Origin"));
        headers.push(header("Access-Control-Allow-Headers", "Content-Type, X-Monk-Token"));
        headers.push(header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"));
    }
    for h in headers.into_iter().flatten() {
        resp.add_header(h);
    }
    if let Err(e) = req.respond(resp) {
        log::debug!("bridge respond failed: {e}");
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn authorized(req: &Request, token: &str) -> bool {
    req.headers()
        .iter()
        .find(|h| h.field.equiv("X-Monk-Token"))
        .is_some_and(|h| constant_time_eq(h.value.as_str().as_bytes(), token.as_bytes()))
}

pub fn spawn(state: BridgeState, port: u16) {
    std::thread::Builder::new()
        .name("monk-bridge".into())
        .spawn(move || {
            let server = match Server::http(("127.0.0.1", port)) {
                Ok(s) => s,
                Err(e) => {
                    log::warn!("extension bridge unavailable on port {port}: {e}");
                    return;
                }
            };
            log::info!("extension bridge listening on 127.0.0.1:{port}");
            for req in server.incoming_requests() {
                handle(&state, req);
            }
        })
        .ok();
}

fn handle(state: &BridgeState, mut req: Request) {
    if req.method() == &Method::Options {
        return respond(req, 204, Json::Null);
    }
    let url = req.url().split('?').next().unwrap_or("").to_string();
    if url == "/v1/ping" {
        return respond(req, 200, json!({ "app": "monk-mode", "version": env!("CARGO_PKG_VERSION") }));
    }
    let token = match settings::extension_token(&state.db.conn()) {
        Ok(t) => t,
        Err(_) => return respond(req, 500, json!({ "error": "unavailable" })),
    };
    if !authorized(&req, &token) {
        return respond(req, 401, json!({ "error": "Pair the extension with the token shown in MONK MODE → Settings → Browser extension." }));
    }
    let mut body = String::new();
    if req.method() == &Method::Post && req.as_reader().take(MAX_BODY).read_to_string(&mut body).is_err() {
        return respond(req, 400, json!({ "error": "Unreadable body" }));
    }
    let browser = req.headers().iter().find(|h| h.field.equiv("X-Monk-Browser")).map(|h| h.value.as_str().to_string());
    let result = match (req.method(), url.as_str()) {
        (Method::Get, "/v1/state") => {
            if let Some(family) = browser.as_deref().and_then(browser_family) {
                if let Ok(mut hb) = state.heartbeats.lock() {
                    hb.insert(family.to_string(), now_ms());
                }
            }
            state_json(state)
        }
        (Method::Post, "/v1/events") => ingest(state, &body),
        (Method::Post, "/v1/exception") => exception(state, &body),
        _ => return respond(req, 404, json!({ "error": "Not found" })),
    };
    match result {
        Ok((status, v)) => respond(req, status, v),
        Err(e) => respond(req, 400, json!({ "error": e.to_string() })),
    }
}

fn state_json(state: &BridgeState) -> AppResult<(u16, Json)> {
    let conn = state.db.conn();
    let now = now_ms();
    let block_set = state.block_set.lock().map(|s| s.clone()).unwrap_or_default();
    let session = focus::active(&conn)?;
    let strict = strict::active(&conn)?;
    let lists = query_json(&conn, "SELECT * FROM blocklists", &[])?;
    let rules = query_json(&conn, "SELECT * FROM block_rules", &[])?;
    let schedules = query_json(&conn, "SELECT * FROM schedules", &[])?;
    Ok((
        200,
        json!({
            "now": now,
            "blockSet": block_set,
            "focus": session.map(|s| json!({ "mode": s.mode, "phase": s.phase, "status": s.status, "endsAt": s.due_at() })),
            "strict": strict.map(|s| json!({ "level": s.level, "endsAt": s.ends_at, "listIds": s.list_ids })),
            "config": { "lists": lists, "rules": rules, "schedules": schedules },
        }),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlockReport {
    ts: i64,
    domain: String,
    trigger: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageReport {
    domain: String,
    started_at: i64,
    ended_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PauseReport {
    ts: i64,
    domain: String,
    outcome: String,
    #[serde(default)]
    intention: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Events {
    #[serde(default)]
    blocks: Vec<BlockReport>,
    #[serde(default)]
    pauses: Vec<PauseReport>,
    #[serde(default)]
    usage: Vec<UsageReport>,
    #[serde(default)]
    browser: String,
}

fn ingest(state: &BridgeState, body: &str) -> AppResult<(u16, Json)> {
    let ev: Events = serde_json::from_str(body)?;
    let now = now_ms();
    let browser: String = ev.browser.chars().filter(|c| c.is_ascii_alphanumeric() || *c == ' ').take(40).collect();
    let block_set = state.block_set.lock().map(|s| s.clone()).unwrap_or_default();
    let mut conn = state.db.conn();
    let tx = conn.transaction()?;
    let (mut nb, mut nu) = (0, 0);
    for b in ev.blocks.iter().take(500) {
        let Some(domain) = normalize_domain(&b.domain) else { continue };
        if b.ts > now + 60_000 || b.ts < now - 7 * 86_400_000 {
            continue;
        }
        let trigger = match b.trigger.as_deref() {
            Some(t @ ("focus" | "schedule" | "strict" | "manual" | "limit")) => t,
            _ => "manual",
        };
        let list = block_set.domains.iter().find(|d| host_matches(&domain, d)).and_then(|d| block_set.source_list.get(d)).cloned();
        tx.execute(
            "INSERT INTO block_events (id, ts, platform, source, target, list_id, action, trigger) VALUES (?1, ?2, 'browser', 'web', ?3, (SELECT id FROM blocklists WHERE id = ?4), 'redirected', ?5)",
            params![new_id(), b.ts, domain, list, trigger],
        )?;
        nb += 1;
    }
    for u in ev.usage.iter().take(2000) {
        let Some(domain) = normalize_domain(&u.domain) else { continue };
        let dur = u.ended_at - u.started_at;
        if dur <= 0 || dur > MAX_USAGE_RECORD_MS || u.ended_at > now + 60_000 {
            continue;
        }
        tx.execute(
            "INSERT INTO web_usage (id, domain, started_at, ended_at, duration_ms, browser) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![new_id(), domain, u.started_at, u.ended_at, dur, browser],
        )?;
        nu += 1;
    }
    let mut np = 0;
    for p in ev.pauses.iter().take(500) {
        let Some(domain) = normalize_domain(&p.domain) else { continue };
        if !matches!(p.outcome.as_str(), "turned_back" | "continued") || p.ts > now + 60_000 || p.ts < now - 7 * 86_400_000 {
            continue;
        }
        let intention: String = p.intention.chars().filter(|c| !c.is_control()).take(200).collect();
        let list = block_set.domains.iter().chain(block_set.url_patterns.iter()).find(|d| host_matches(&domain, d.split('/').next().unwrap_or(d))).and_then(|d| block_set.source_list.get(d)).cloned();
        tx.execute(
            "INSERT INTO pause_events (id, ts, platform, target, list_id, outcome, intention) VALUES (?1, ?2, 'browser', ?3, (SELECT id FROM blocklists WHERE id = ?4), ?5, ?6)",
            params![new_id(), p.ts, domain, list, p.outcome, intention],
        )?;
        np += 1;
    }
    tx.commit()?;
    drop(conn);
    if np > 0 {
        (state.on_change)("pause_events");
    }
    if nb > 0 {
        (state.on_change)("block_events");
    }
    if nu > 0 {
        (state.on_change)("web_usage");
    }
    Ok((200, json!({ "blocks": nb, "usage": nu, "pauses": np })))
}

#[derive(Deserialize)]
struct ExceptionReq {
    domain: String,
    minutes: i64,
    #[serde(default)]
    reason: String,
}

fn exception(state: &BridgeState, body: &str) -> AppResult<(u16, Json)> {
    let r: ExceptionReq = serde_json::from_str(body)?;
    let domain = normalize_domain(&r.domain).filter(|d| d != "*").ok_or_else(|| crate::error::AppError::invalid("Invalid domain"))?;
    let minutes = r.minutes.clamp(1, MAX_EXCEPTION_MIN);
    let reason: String = r.reason.chars().take(200).collect();
    let block_set = state.block_set.lock().map(|s| s.clone()).unwrap_or_default();
    let conn = state.db.conn();
    let protected = block_set.strict
        && (block_set.domains.iter().any(|d| host_matches(&domain, d) && block_set.trigger_for.get(d).map(String::as_str) == Some("strict"))
            || strict::active(&conn)?.is_some_and(|s| s.level != "normal"));
    if protected {
        strict::record_event(&conn, strict::active(&conn)?.as_ref().map(|s| s.id.as_str()), "exception_refused", &domain)?;
        return Ok((403, json!({ "error": "Emergency access is disabled during a strict session." })));
    }
    let until = now_ms() + minutes * 60_000;
    conn.execute(
        "INSERT INTO exceptions (id, type, value, reason, until_at, created_at) VALUES (?1, 'domain', ?2, ?3, ?4, ?5)",
        params![new_id(), domain, reason, until, now_ms()],
    )?;
    drop(conn);
    (state.on_change)("exceptions");
    Ok((200, json!({ "domain": domain, "untilAt": until })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_browser_families() {
        assert_eq!(browser_family("Chromium"), Some("chromium"));
        assert_eq!(browser_family("Edge"), Some("edge"));
        assert_eq!(browser_family("Firefox"), Some("firefox"));
        assert_eq!(browser_family("Netscape"), None);
    }

    #[test]
    fn constant_time_compare() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
    }

    fn state() -> BridgeState {
        BridgeState { db: Db::open_in_memory().unwrap(), block_set: Arc::new(Mutex::new(ActiveBlockSet::default())), heartbeats: Heartbeats::default(), on_change: Box::new(|_| {}) }
    }

    #[test]
    fn ingest_validates_and_stores() {
        let s = state();
        let now = now_ms();
        let body = json!({
            "browser": "Chrome<script>",
            "blocks": [{ "ts": now, "domain": "www.reddit.com", "trigger": "focus" }, { "ts": now, "domain": "bad domain" }],
            "pauses": [
                { "ts": now, "domain": "youtube.com", "outcome": "turned_back", "intention": "check a lecture\u{7}" },
                { "ts": now, "domain": "youtube.com", "outcome": "hacked" }
            ],
            "usage": [
                { "domain": "github.com", "startedAt": now - 60_000, "endedAt": now },
                { "domain": "x.com", "startedAt": now, "endedAt": now - 1 },
                { "domain": "y.com", "startedAt": now - 2 * MAX_USAGE_RECORD_MS, "endedAt": now }
            ]
        });
        let (status, v) = ingest(&s, &body.to_string()).unwrap();
        assert_eq!(status, 200);
        assert_eq!(v, json!({ "blocks": 1, "usage": 1, "pauses": 1 }));
        let intention: String = s.db.conn().query_row("SELECT intention FROM pause_events", [], |r| r.get(0)).unwrap();
        assert_eq!(intention, "check a lecture");
        let browser: String = s.db.conn().query_row("SELECT browser FROM web_usage", [], |r| r.get(0)).unwrap();
        assert_eq!(browser, "Chromescript");
    }

    #[test]
    fn exceptions_refused_during_strict() {
        let s = state();
        {
            let mut c = s.db.conn();
            c.execute("INSERT INTO blocklists (id, name, created_at, updated_at) VALUES ('l','L',0,0)", []).unwrap();
            let req = strict::StartStrict { level: "strict".into(), duration_min: 30, list_ids: vec!["l".into()], confirmed: true };
            strict::start(&mut c, &req, now_ms(), 0, 0).unwrap();
        }
        s.block_set.lock().unwrap().strict = true;
        let (status, _) = exception(&s, r#"{"domain":"reddit.com","minutes":5}"#).unwrap();
        assert_eq!(status, 403);
    }

    #[test]
    fn exceptions_are_capped() {
        let s = state();
        let (status, v) = exception(&s, r#"{"domain":"https://news.ycombinator.com/","minutes":999}"#).unwrap();
        assert_eq!(status, 200);
        assert_eq!(v["domain"], "news.ycombinator.com");
        assert!(v["untilAt"].as_i64().unwrap() <= now_ms() + MAX_EXCEPTION_MIN * 60_000);
    }
}
