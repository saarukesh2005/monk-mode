package app.monkmode.engine

import app.monkmode.core.StrictPolicy
import app.monkmode.data.MonkDatabase
import app.monkmode.data.Repo
import app.monkmode.data.StrictSession
import app.monkmode.data.rows
import app.monkmode.data.tx
import app.monkmode.data.values
import java.time.LocalDate
import java.time.ZoneId

/** Port of apps/desktop/src-tauri/src/strict.rs. Every level keeps an emergency exit. */
class StrictEngine(private val repo: Repo) {
    private val db get() = repo.db
    private val cooldownSec get() = repo.int("emergencyCooldownSec", 300)

    fun active(): StrictSession? = db.rows("SELECT * FROM strict_sessions WHERE state IN ('ACTIVE','PAUSED') ORDER BY started_at DESC LIMIT 1") { c ->
        val id = c.getString(c.getColumnIndexOrThrow("id"))
        StrictSession.from(c, db.rows("SELECT list_id FROM strict_session_lists WHERE session_id = ?", id) { it.getString(0) })
    }.firstOrNull()

    fun record(sessionId: String?, kind: String, detail: String = "") {
        db.insert("strict_events", null, values("id" to MonkDatabase.newId(), "session_id" to sessionId, "ts" to Repo.now(), "kind" to kind, "detail" to detail.take(500)))
    }

    fun usedTodayMin(now: Long = Repo.now()): Long {
        val dayStart = LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
        return db.rows("SELECT COALESCE(SUM(COALESCE(ended_at, ends_at) - started_at), 0) AS ms FROM strict_sessions WHERE started_at >= ?", dayStart) { it.getLong(0) }.first() / 60_000
    }

    fun start(level: String, durationMin: Int, listIds: List<String>, confirmed: Boolean, now: Long = Repo.now()): StrictSession {
        if (level !in listOf("normal", "strict", "maximum")) throw FocusException("Unknown strictness level")
        if (!confirmed) throw FocusException("Please confirm your commitment first")
        if (durationMin !in StrictPolicy.MIN_DURATION_MIN..StrictPolicy.MAX_DURATION_MIN) throw FocusException("Duration must be ${StrictPolicy.MIN_DURATION_MIN}–${StrictPolicy.MAX_DURATION_MIN} minutes")
        if (listIds.isEmpty()) throw FocusException("Choose at least one blocklist to enforce")
        val limit = repo.int("strictDailyLimitMin", 480)
        return db.tx {
            if (active() != null) throw FocusException("A strict session is already active")
            if (limit > 0 && usedTodayMin(now) + durationMin > limit) throw FocusException("This would exceed your daily strict-mode limit of $limit minutes")
            val id = MonkDatabase.newId()
            insertOrThrow("strict_sessions", null, values("id" to id, "level" to level, "state" to "ACTIVE", "started_at" to now, "ends_at" to now + durationMin * 60_000L, "created_at" to now, "updated_at" to now))
            listIds.forEach { insert("strict_session_lists", null, values("session_id" to id, "list_id" to it)) }
            record(id, "started", "$level for $durationMin min")
            active()!!
        }.also { repo.changed() }
    }

    fun pause(now: Long = Repo.now()) {
        val s = active() ?: throw FocusException("No strict session is active")
        if (!StrictPolicy.exitPolicy(s.level).canPause) {
            record(s.id, "pause_refused")
            throw FocusException("Pausing is not allowed at the ${s.level} level")
        }
        db.update("strict_sessions", values("state" to "PAUSED", "paused_at" to now, "updated_at" to now), "id = ?", arrayOf(s.id))
        record(s.id, "paused")
        repo.changed()
    }

    fun resume(now: Long = Repo.now()) {
        val s = active() ?: throw FocusException("No strict session is active")
        val p = s.pausedAt ?: throw FocusException("Session is not paused")
        db.update("strict_sessions", values("state" to "ACTIVE", "ends_at" to s.endsAt + (now - p), "paused_at" to null, "updated_at" to now), "id = ?", arrayOf(s.id))
        record(s.id, "resumed")
        repo.changed()
    }

    /** Returns true if the session ended immediately (normal level). */
    fun requestExit(reason: String, phrase: String?, now: Long = Repo.now()): Boolean {
        val s = active() ?: throw FocusException("No strict session is active")
        StrictPolicy.validateExit(s.level, reason, phrase, cooldownSec)?.let { throw FocusException(it) }
        db.update("strict_sessions", values("exit_reason" to reason.trim().take(500), "exit_requested_at" to now, "updated_at" to now), "id = ?", arrayOf(s.id))
        record(s.id, "exit_requested", reason)
        val ended = StrictPolicy.exitPolicy(s.level, cooldownSec).cooldownMs == 0L
        if (ended) finish(s.id, "EMERGENCY_EXIT", now)
        repo.changed()
        return ended
    }

    fun abortExit() {
        val s = active() ?: return
        db.update("strict_sessions", values("exit_requested_at" to null, "exit_reason" to ""), "id = ?", arrayOf(s.id))
        record(s.id, "exit_cancelled")
        repo.changed()
    }

    private fun finish(id: String, state: String, now: Long) {
        db.update("strict_sessions", values("state" to state, "ended_at" to now, "updated_at" to now), "id = ?", arrayOf(id))
        record(id, if (state == "COMPLETED") "completed" else "emergency_exit")
    }

    /** Returns "completed" / "exited" when the session ended during this tick. */
    fun tick(now: Long = Repo.now()): String? {
        val s = active() ?: return null
        if (s.state == "ACTIVE" && now >= s.endsAt) {
            finish(s.id, "COMPLETED", now)
            repo.changed()
            return "completed"
        }
        val req = s.exitRequestedAt ?: return null
        if (now - req >= StrictPolicy.exitPolicy(s.level, cooldownSec).cooldownMs) {
            finish(s.id, "EMERGENCY_EXIT", now)
            repo.changed()
            return "exited"
        }
        return null
    }

    fun exitAvailableAt(s: StrictSession): Long? = s.exitRequestedAt?.plus(StrictPolicy.exitPolicy(s.level, cooldownSec).cooldownMs)

    /** Lists whose rules cannot be removed right now. */
    fun protectedLists(): List<String> = active()?.takeIf { !StrictPolicy.exitPolicy(it.level).canRemoveRules }?.listIds.orEmpty()
}
