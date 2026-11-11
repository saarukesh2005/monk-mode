package app.monkmode.data

import app.monkmode.core.BackupCrypto
import org.json.JSONArray
import org.json.JSONObject

/**
 * Exports/imports the same JSON payload as apps/desktop/src-tauri/src/backup.rs, so backups move
 * freely between Android, macOS and Windows. Device-local settings never travel.
 */
class BackupService(private val repo: Repo) {
    companion object {
        val TABLES = listOf(
            "categories", "subjects", "topics", "tasks", "tags", "task_tags", "focus_sessions", "blocklists",
            "block_rules", "schedules", "quick_blocks", "usage_limits", "exceptions", "strict_sessions",
            "strict_session_lists", "strict_events", "block_events", "app_usage", "web_usage", "events",
            "daily_plans", "notifications", "settings",
        )
        val DEVICE_LOCAL = setOf("extensionToken", "hostsBlockingEnabled", "startOnLogin", "usageImportedUntil", "usageLastImportAt", "guardEnabled", "onboardingComplete")
        const val FORMAT_VERSION = 1
    }

    fun exportJson(appVersion: String): JSONObject {
        val tables = JSONObject()
        for (t in TABLES) {
            val arr = JSONArray()
            repo.db.rawQuery("SELECT * FROM $t", null).use { c ->
                while (c.moveToNext()) {
                    val o = JSONObject()
                    for (i in 0 until c.columnCount) {
                        val v: Any? = when (c.getType(i)) {
                            android.database.Cursor.FIELD_TYPE_NULL -> JSONObject.NULL
                            android.database.Cursor.FIELD_TYPE_INTEGER -> c.getLong(i)
                            android.database.Cursor.FIELD_TYPE_FLOAT -> c.getDouble(i)
                            else -> c.getString(i)
                        }
                        o.put(c.getColumnName(i), v)
                    }
                    if (t == "settings" && o.optString("key") in DEVICE_LOCAL) continue
                    arr.put(o)
                }
            }
            tables.put(t, arr)
        }
        val schema = repo.db.rows("PRAGMA user_version") { it.getLong(0) }.first()
        return JSONObject().put("format", "monk-mode-backup").put("formatVersion", FORMAT_VERSION).put("schemaVersion", schema)
            .put("exportedAt", Repo.now()).put("platform", "android").put("appVersion", appVersion).put("tables", tables)
    }

    fun exportEncrypted(passphrase: String, appVersion: String): ByteArray =
        BackupCrypto.encrypt(exportJson(appVersion).toString().toByteArray(Charsets.UTF_8), passphrase)

    data class Report(val rows: Int, val sourcePlatform: String)

    /** Replaces all local data in one transaction; any constraint violation leaves data untouched. */
    fun restore(encrypted: ByteArray, passphrase: String): Report {
        val payload = runCatching { JSONObject(String(BackupCrypto.decrypt(encrypted, passphrase), Charsets.UTF_8)) }
            .getOrElse { throw if (it is BackupCrypto.BackupException) it else BackupCrypto.BackupException("Backup content is not valid") }
        if (payload.optString("format") != "monk-mode-backup") throw BackupCrypto.BackupException("Not a MONK MODE backup")
        if (payload.optInt("formatVersion", 99) > FORMAT_VERSION) throw BackupCrypto.BackupException("This backup was made by a newer version of MONK MODE")
        val tables = payload.getJSONObject("tables")
        tables.keys().forEach { if (it !in TABLES) throw BackupCrypto.BackupException("Backup contains an unknown table: $it") }
        var count = 0
        val db = repo.db
        db.tx {
            delete("timer_state", null, null)
            for (t in TABLES.reversed()) {
                if (t == "settings") delete("settings", "key NOT IN (${DEVICE_LOCAL.joinToString(",") { "'$it'" }})", null) else delete(t, null, null)
            }
            for (t in TABLES) {
                val rows = tables.optJSONArray(t) ?: continue
                val columns = rows("PRAGMA table_info($t)") { it.getString(1) }.toSet()
                for (i in 0 until rows.length()) {
                    val o = rows.getJSONObject(i)
                    if (t == "settings" && o.optString("key") in DEVICE_LOCAL) continue
                    val cv = android.content.ContentValues()
                    for (k in o.keys()) {
                        if (k !in columns) continue
                        when (val v = o.get(k)) {
                            JSONObject.NULL -> cv.putNull(k)
                            is Int -> cv.put(k, v)
                            is Long -> cv.put(k, v)
                            is Double -> cv.put(k, v)
                            is Boolean -> cv.put(k, if (v) 1 else 0)
                            else -> cv.put(k, v.toString())
                        }
                    }
                    insertOrThrow(t, null, cv)
                    count++
                }
            }
            execSQL("UPDATE focus_sessions SET status = 'interrupted', ended_at = COALESCE(paused_at, started_at), paused_at = NULL WHERE status IN ('running','paused')")
            execSQL("UPDATE strict_sessions SET state = 'COMPLETED', ended_at = COALESCE(ended_at, updated_at) WHERE state IN ('ACTIVE','PAUSED','PREPARING')")
            val fk = rows("PRAGMA foreign_key_check") { it.getString(0) }
            if (fk.isNotEmpty()) throw BackupCrypto.BackupException("Backup rejected: foreign key problems in ${fk.distinct().joinToString()}")
        }
        repo.changed()
        return Report(count, payload.optString("platform", "unknown"))
    }

    fun wipe() {
        repo.db.tx {
            delete("timer_state", null, null)
            for (t in TABLES.reversed()) delete(t, null, null)
        }
        repo.seedIfNeeded()
        repo.changed()
    }
}
