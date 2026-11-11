//! Generic, whitelisted table access for the UI. Table and column identifiers come only from
//! the static `TABLES` registry; every value is bound as a parameter. Engine-owned tables
//! (sessions, strict state, events, usage) are read-only here and change only through engines.

use crate::db::now_ms;
use crate::error::{AppError, AppResult};
use crate::strict;
use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::Deserialize;
use serde_json::{Map, Value as Json};

pub struct TableSpec {
    pub name: &'static str,
    pub pk: &'static [&'static str],
    pub columns: &'static [&'static str],
    pub writable: bool,
}

pub const TABLES: &[TableSpec] = &[
    TableSpec { name: "categories", pk: &["id"], columns: &["id", "name", "color", "kind", "created_at"], writable: true },
    TableSpec { name: "subjects", pk: &["id"], columns: &["id", "name", "color", "weekly_goal_min", "archived", "created_at", "updated_at"], writable: true },
    TableSpec { name: "topics", pk: &["id"], columns: &["id", "subject_id", "title", "status", "last_reviewed", "next_review", "review_count", "created_at", "updated_at"], writable: true },
    TableSpec { name: "tasks", pk: &["id"], columns: &["id", "parent_id", "title", "notes", "priority", "status", "due_date", "recurrence", "category_id", "subject_id", "sort_order", "completed_at", "created_at", "updated_at"], writable: true },
    TableSpec { name: "tags", pk: &["id"], columns: &["id", "name"], writable: true },
    TableSpec { name: "task_tags", pk: &["task_id", "tag_id"], columns: &["task_id", "tag_id"], writable: true },
    TableSpec { name: "blocklists", pk: &["id"], columns: &["id", "name", "kind", "enabled", "block_during_focus", "mode", "pause_seconds", "pause_allow_min", "created_at", "updated_at"], writable: true },
    TableSpec { name: "block_rules", pk: &["id"], columns: &["id", "list_id", "type", "value", "label", "platform", "created_at"], writable: true },
    TableSpec { name: "schedules", pk: &["id"], columns: &["id", "name", "list_id", "days_mask", "start_minute", "end_minute", "strict", "enabled", "created_at", "updated_at"], writable: true },
    TableSpec { name: "quick_blocks", pk: &["id"], columns: &["id", "list_id", "started_at", "ends_at", "ended_at"], writable: false },
    TableSpec { name: "usage_limits", pk: &["id"], columns: &["id", "type", "value", "label", "minutes_per_day", "platform", "enabled", "created_at"], writable: true },
    TableSpec { name: "exceptions", pk: &["id"], columns: &["id", "type", "value", "reason", "until_at", "created_at"], writable: false },
    TableSpec { name: "events", pk: &["id"], columns: &["id", "title", "kind", "start_at", "end_at", "all_day", "recurrence", "subject_id", "notes", "created_at", "updated_at"], writable: true },
    TableSpec { name: "daily_plans", pk: &["date"], columns: &["date", "intention", "priorities", "focus_target_min", "review", "mood", "reviewed_at", "updated_at"], writable: true },
    TableSpec { name: "notifications", pk: &["id"], columns: &["id", "ts", "kind", "title", "body", "read"], writable: true },
    TableSpec { name: "focus_sessions", pk: &["id"], columns: &["id", "mode", "phase", "status", "planned_ms", "started_at", "paused_at", "paused_total_ms", "ended_at", "focused_ms", "cycle_index", "category_id", "subject_id", "task_id", "note", "strict", "created_at", "updated_at"], writable: false },
    TableSpec { name: "strict_sessions", pk: &["id"], columns: &["id", "level", "state", "started_at", "ends_at", "paused_at", "ended_at", "exit_reason", "exit_requested_at", "created_at", "updated_at"], writable: false },
    TableSpec { name: "strict_events", pk: &["id"], columns: &["id", "session_id", "ts", "kind", "detail"], writable: false },
    TableSpec { name: "block_events", pk: &["id"], columns: &["id", "ts", "platform", "source", "target", "list_id", "action", "trigger"], writable: false },
    TableSpec { name: "pause_events", pk: &["id"], columns: &["id", "ts", "platform", "target", "list_id", "outcome", "intention"], writable: false },
    TableSpec { name: "app_usage", pk: &["id"], columns: &["id", "app_id", "app_name", "started_at", "ended_at", "duration_ms", "platform", "source"], writable: false },
    TableSpec { name: "web_usage", pk: &["id"], columns: &["id", "domain", "started_at", "ended_at", "duration_ms", "browser"], writable: false },
    TableSpec { name: "system_changes", pk: &["id"], columns: &["id", "kind", "target", "backup_path", "applied_at", "reverted_at"], writable: false },
];

pub fn spec(table: &str) -> AppResult<&'static TableSpec> {
    TABLES.iter().find(|t| t.name == table).ok_or_else(|| AppError::invalid(format!("Unknown table {table}")))
}

fn column<'a>(spec: &'a TableSpec, col: &str) -> AppResult<&'static str> {
    spec.columns
        .iter()
        .copied()
        .find(|c| *c == col)
        .ok_or_else(|| AppError::invalid(format!("Unknown column {col}")))
}

pub fn json_to_sql(v: &Json) -> AppResult<Value> {
    Ok(match v {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(*b as i64),
        Json::Number(n) => n
            .as_i64()
            .map(Value::Integer)
            .or_else(|| n.as_f64().map(Value::Real))
            .ok_or_else(|| AppError::invalid("Invalid number"))?,
        Json::String(s) => Value::Text(s.clone()),
        Json::Array(_) | Json::Object(_) => Value::Text(serde_json::to_string(v)?),
    })
}

pub fn sql_to_json(v: ValueRef) -> Json {
    match v {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::from(i),
        ValueRef::Real(f) => Json::from(f),
        ValueRef::Text(t) => Json::from(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(_) => Json::Null,
    }
}

/// Runs a SELECT and returns rows as JSON objects keyed by column name.
pub fn query_json(conn: &Connection, sql: &str, params: &[Value]) -> AppResult<Vec<Map<String, Json>>> {
    let mut stmt = conn.prepare(sql)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt.query_map(params_from_iter(params.iter()), |r| {
        let mut m = Map::new();
        for (i, n) in names.iter().enumerate() {
            m.insert(n.clone(), sql_to_json(r.get_ref(i)?));
        }
        Ok(m)
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[derive(Debug, Clone, Deserialize)]
pub struct Filter {
    pub column: String,
    pub op: String,
    pub value: Option<Json>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    #[serde(default)]
    pub filters: Vec<Filter>,
    pub order_by: Option<String>,
    #[serde(default)]
    pub desc: bool,
    pub limit: Option<i64>,
}

pub fn list(conn: &Connection, table: &str, q: &ListQuery) -> AppResult<Vec<Map<String, Json>>> {
    let spec = spec(table)?;
    let mut sql = format!("SELECT * FROM {}", spec.name);
    let mut params = Vec::new();
    let mut clauses = Vec::new();
    for f in &q.filters {
        let col = column(spec, &f.column)?;
        let op = match f.op.as_str() {
            "eq" => "=",
            "ne" => "!=",
            "gt" => ">",
            "gte" => ">=",
            "lt" => "<",
            "lte" => "<=",
            "isnull" => {
                clauses.push(format!("{col} IS NULL"));
                continue;
            }
            "notnull" => {
                clauses.push(format!("{col} IS NOT NULL"));
                continue;
            }
            _ => return Err(AppError::invalid("Unknown filter operator")),
        };
        clauses.push(format!("{col} {op} ?"));
        params.push(json_to_sql(f.value.as_ref().unwrap_or(&Json::Null))?);
    }
    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }
    if let Some(order) = &q.order_by {
        sql.push_str(&format!(" ORDER BY {} {}", column(spec, order)?, if q.desc { "DESC" } else { "ASC" }));
    }
    let limit = q.limit.unwrap_or(5000).clamp(1, 50_000);
    sql.push_str(&format!(" LIMIT {limit}"));
    query_json(conn, &sql, &params)
}

fn pk_clause(spec: &TableSpec, row: &Map<String, Json>) -> AppResult<(String, Vec<Value>)> {
    let mut parts = Vec::new();
    let mut vals = Vec::new();
    for k in spec.pk {
        let v = row.get(*k).ok_or_else(|| AppError::invalid(format!("Missing key {k}")))?;
        parts.push(format!("{k} = ?"));
        vals.push(json_to_sql(v)?);
    }
    Ok((parts.join(" AND "), vals))
}

fn get_by_pk(conn: &Connection, spec: &TableSpec, row: &Map<String, Json>) -> AppResult<Option<Map<String, Json>>> {
    let (clause, vals) = pk_clause(spec, row)?;
    Ok(query_json(conn, &format!("SELECT * FROM {} WHERE {clause}", spec.name), &vals)?.into_iter().next())
}

fn str_field<'a>(row: &'a Map<String, Json>, k: &str) -> Option<&'a str> {
    row.get(k).and_then(Json::as_str)
}

/// Whether an edit would weaken an active strict session.
fn strict_refuses(conn: &Connection, table: &str, before: Option<&Map<String, Json>>, after: Option<&Map<String, Json>>) -> AppResult<bool> {
    let protected = strict::protected_list_ids(conn)?;
    if protected.is_empty() {
        return Ok(false);
    }
    let is_protected = |id: Option<&str>| id.is_some_and(|i| protected.iter().any(|p| p == i));
    let refused = match table {
        "block_rules" => {
            // Adding rules is always allowed; removing or changing rules of protected lists is not.
            before.is_some_and(|b| is_protected(str_field(b, "list_id")))
        }
        "blocklists" => before.is_some_and(|b| {
            let id = str_field(b, "id");
            is_protected(id)
                && (after.is_none()
                    || after.and_then(|a| a.get("enabled")).and_then(Json::as_i64) == Some(0)
                    || after.and_then(|a| a.get("enabled")).and_then(Json::as_bool) == Some(false)
                    || after.and_then(|a| str_field(a, "kind")) == Some("allow")
                    || after.and_then(|a| str_field(a, "mode")) == Some("pause"))
        }),
        "schedules" => before.is_some_and(|b| b.get("strict").and_then(Json::as_i64) == Some(1)),
        "usage_limits" => before.is_some(),
        _ => false,
    };
    Ok(refused)
}

/// Records the tamper attempt outside the (rolled back) edit transaction.
fn refuse_strict_edit(conn: &Connection, table: &str) -> AppError {
    let session = strict::active(conn).ok().flatten();
    if let Err(e) = strict::record_event(conn, session.as_ref().map(|s| s.id.as_str()), "blocked_edit", &format!("Tried to modify {table}")) {
        log::warn!("could not record tamper event: {e}");
    }
    AppError::refused("This is locked while a strict session is active.")
}

/// Inserts or updates a row (never INSERT OR REPLACE, which would cascade-delete children).
pub fn upsert(conn: &mut Connection, table: &str, row: &Map<String, Json>) -> AppResult<Map<String, Json>> {
    let spec = spec(table)?;
    if !spec.writable {
        return Err(AppError::refused(format!("{table} cannot be edited directly")));
    }
    let tx = conn.transaction()?;
    let existing = get_by_pk(&tx, spec, row)?;
    let mut merged = existing.clone().unwrap_or_default();
    for (k, v) in row {
        column(spec, k)?;
        merged.insert(k.clone(), v.clone());
    }
    let now = Json::from(now_ms());
    if spec.columns.contains(&"updated_at") {
        merged.insert("updated_at".into(), now.clone());
    }
    if spec.columns.contains(&"created_at") && !merged.contains_key("created_at") {
        merged.insert("created_at".into(), now);
    }
    if strict_refuses(&tx, table, existing.as_ref(), Some(&merged))? {
        drop(tx);
        return Err(refuse_strict_edit(conn, table));
    }
    let cols: Vec<&str> = spec.columns.iter().copied().filter(|c| merged.contains_key(*c)).collect();
    let vals: Vec<Value> = cols.iter().map(|c| json_to_sql(&merged[*c])).collect::<AppResult<_>>()?;
    if existing.is_some() {
        let set: Vec<String> = cols.iter().filter(|c| !spec.pk.contains(c)).map(|c| format!("{c} = ?")).collect();
        let (clause, pk_vals) = pk_clause(spec, &merged)?;
        let set_vals: Vec<Value> = cols
            .iter()
            .zip(vals)
            .filter(|(c, _)| !spec.pk.contains(c))
            .map(|(_, v)| v)
            .chain(pk_vals)
            .collect();
        if !set.is_empty() {
            tx.execute(&format!("UPDATE {} SET {} WHERE {clause}", spec.name, set.join(", ")), params_from_iter(set_vals.iter()))?;
        }
    } else {
        let marks = vec!["?"; cols.len()].join(", ");
        tx.execute(&format!("INSERT INTO {} ({}) VALUES ({marks})", spec.name, cols.join(", ")), params_from_iter(vals.iter()))?;
    }
    let out = get_by_pk(&tx, spec, &merged)?.ok_or_else(|| AppError::invalid("Row vanished"))?;
    tx.commit()?;
    Ok(out)
}

pub fn delete(conn: &mut Connection, table: &str, key: &Map<String, Json>) -> AppResult<()> {
    let spec = spec(table)?;
    if !spec.writable {
        return Err(AppError::refused(format!("{table} cannot be edited directly")));
    }
    let tx = conn.transaction()?;
    let existing = get_by_pk(&tx, spec, key)?;
    if strict_refuses(&tx, table, existing.as_ref(), None)? {
        drop(tx);
        return Err(refuse_strict_edit(conn, table));
    }
    let (clause, vals) = pk_clause(spec, key)?;
    tx.execute(&format!("DELETE FROM {} WHERE {clause}", spec.name), params_from_iter(vals.iter()))?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use serde_json::json;

    fn obj(v: Json) -> Map<String, Json> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn upsert_inserts_updates_and_preserves_children() {
        let db = Db::open_in_memory().unwrap();
        let mut c = db.conn();
        upsert(&mut c, "blocklists", &obj(json!({"id": "l", "name": "Work"}))).unwrap();
        upsert(&mut c, "block_rules", &obj(json!({"id": "r", "list_id": "l", "type": "domain", "value": "x.com"}))).unwrap();
        let updated = upsert(&mut c, "blocklists", &obj(json!({"id": "l", "name": "Deep work", "enabled": false}))).unwrap();
        assert_eq!(updated["name"], "Deep work");
        assert_eq!(updated["enabled"], 0);
        let rules = list(&c, "block_rules", &ListQuery::default()).unwrap();
        assert_eq!(rules.len(), 1, "updating a list must not cascade-delete its rules");
    }

    #[test]
    fn rejects_unknown_identifiers_and_engine_tables() {
        let db = Db::open_in_memory().unwrap();
        let mut c = db.conn();
        assert!(upsert(&mut c, "sqlite_master", &obj(json!({"id": "x"}))).is_err());
        assert!(upsert(&mut c, "tasks", &obj(json!({"id": "t", "title": "x", "evil; DROP TABLE tasks": 1}))).is_err());
        assert!(upsert(&mut c, "focus_sessions", &obj(json!({"id": "x"}))).is_err());
        let q = ListQuery { filters: vec![Filter { column: "1=1 OR title".into(), op: "eq".into(), value: None }], ..Default::default() };
        assert!(list(&c, "tasks", &q).is_err());
    }

    #[test]
    fn filters_orders_and_limits() {
        let db = Db::open_in_memory().unwrap();
        let mut c = db.conn();
        for (id, p) in [("a", 1), ("b", 3), ("c", 2)] {
            upsert(&mut c, "tasks", &obj(json!({"id": id, "title": id, "priority": p}))).unwrap();
        }
        let q = ListQuery {
            filters: vec![Filter { column: "priority".into(), op: "gte".into(), value: Some(json!(2)) }],
            order_by: Some("priority".into()),
            desc: true,
            limit: Some(10),
        };
        let rows = list(&c, "tasks", &q).unwrap();
        assert_eq!(rows.iter().map(|r| r["id"].as_str().unwrap()).collect::<Vec<_>>(), vec!["b", "c"]);
    }

    #[test]
    fn strict_session_locks_rule_removal_but_allows_additions() {
        let db = Db::open_in_memory().unwrap();
        let mut c = db.conn();
        upsert(&mut c, "blocklists", &obj(json!({"id": "l", "name": "Work"}))).unwrap();
        upsert(&mut c, "block_rules", &obj(json!({"id": "r", "list_id": "l", "type": "domain", "value": "x.com"}))).unwrap();
        let req = strict::StartStrict { level: "strict".into(), duration_min: 30, list_ids: vec!["l".into()], confirmed: true };
        strict::start(&mut c, &req, now_ms(), 0, 0).unwrap();
        assert!(delete(&mut c, "block_rules", &obj(json!({"id": "r"}))).is_err());
        assert!(upsert(&mut c, "blocklists", &obj(json!({"id": "l", "enabled": false}))).is_err());
        assert!(upsert(&mut c, "blocklists", &obj(json!({"id": "l", "mode": "pause"}))).is_err(), "pause mode would weaken a strict list");
        assert!(delete(&mut c, "blocklists", &obj(json!({"id": "l"}))).is_err());
        assert!(upsert(&mut c, "block_rules", &obj(json!({"id": "r2", "list_id": "l", "type": "domain", "value": "y.com"}))).is_ok());
        assert!(upsert(&mut c, "blocklists", &obj(json!({"id": "l", "name": "Renamed"}))).is_ok());
        let tamper: i64 = c.query_row("SELECT COUNT(*) FROM strict_events WHERE kind = 'blocked_edit'", [], |r| r.get(0)).unwrap();
        assert_eq!(tamper, 4);
    }
}
