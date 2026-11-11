//! First-run defaults. Only runs when the database has never been seeded.

use crate::db::{new_id, now_ms};
use crate::error::AppResult;
use crate::settings;
use rusqlite::{params, Connection};

pub fn seed_defaults(conn: &Connection) -> AppResult<()> {
    if settings::flag(conn, "seeded", false) {
        return Ok(());
    }
    let now = now_ms();
    for (name, color) in [("Work", "#86B7E0"), ("Study", "#E3A857"), ("Reading", "#8DBF98"), ("Personal", "#A595F5")] {
        conn.execute(
            "INSERT INTO categories (id, name, color, kind, created_at) VALUES (?1, ?2, ?3, 'session', ?4)",
            params![new_id(), name, color, now],
        )?;
    }
    let distractions = new_id();
    conn.execute(
        "INSERT INTO blocklists (id, name, kind, enabled, block_during_focus, created_at, updated_at) VALUES (?1, 'Distractions', 'block', 1, 1, ?2, ?2)",
        params![distractions, now],
    )?;
    for preset in ["short-feeds", "social"] {
        conn.execute(
            "INSERT INTO block_rules (id, list_id, type, value, label, platform, created_at) VALUES (?1, ?2, 'category', ?3, '', 'all', ?4)",
            params![new_id(), distractions, preset, now],
        )?;
    }
    conn.execute(
        "INSERT INTO blocklists (id, name, kind, enabled, block_during_focus, created_at, updated_at) VALUES (?1, 'Always allowed', 'allow', 1, 0, ?2, ?2)",
        params![new_id(), now],
    )?;
    settings::set(conn, "seeded", &true)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn seeds_once() {
        let db = Db::open_in_memory().unwrap();
        let c = db.conn();
        seed_defaults(&c).unwrap();
        seed_defaults(&c).unwrap();
        let n: i64 = c.query_row("SELECT COUNT(*) FROM blocklists", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
    }
}
