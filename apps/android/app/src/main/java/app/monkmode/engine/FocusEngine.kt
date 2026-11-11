package app.monkmode.engine

import android.database.sqlite.SQLiteDatabase
import app.monkmode.core.FocusMath
import app.monkmode.core.FocusMath.MINUTE_MS
import app.monkmode.data.MonkDatabase
import app.monkmode.data.PomodoroConfig
import app.monkmode.data.Repo
import app.monkmode.data.Session
import app.monkmode.data.rows
import app.monkmode.data.tx
import app.monkmode.data.values

sealed interface FocusEvent {
    data class Completed(val session: Session) : FocusEvent
    data class Started(val session: Session) : FocusEvent
}

class FocusException(message: String) : Exception(message)

/**
 * Port of apps/desktop/src-tauri/src/focus.rs. State is persisted instants; remaining time is
 * derived. `tick` completes overdue phases at their true due time, so the timer stays exact
 * across process death, reboots and Doze.
 */
class FocusEngine(private val repo: Repo) {
    private val db: SQLiteDatabase get() = repo.db

    fun active(): Session? = db.rows("SELECT s.* FROM timer_state t JOIN focus_sessions s ON s.id = t.session_id WHERE t.singleton = 1", map = Session::from).firstOrNull()

    private fun get(id: String): Session = db.rows("SELECT * FROM focus_sessions WHERE id = ?", id, map = Session::from).first()

    private fun insertPhase(mode: String, phase: String, plannedMs: Long?, startedAt: Long, cycle: Int, from: Session?, note: String, strict: Boolean): Session {
        val id = MonkDatabase.newId()
        val now = Repo.now()
        db.insertOrThrow("focus_sessions", null, values(
            "id" to id, "mode" to mode, "phase" to phase, "status" to "running", "planned_ms" to plannedMs, "started_at" to startedAt,
            "paused_total_ms" to 0, "cycle_index" to cycle, "category_id" to from?.categoryId, "subject_id" to from?.subjectId,
            "task_id" to from?.taskId, "note" to note, "strict" to strict, "created_at" to now, "updated_at" to now,
        ))
        db.insertOrThrow("timer_state", null, values("singleton" to 1, "session_id" to id, "updated_at" to now))
        return get(id)
    }

    private fun nextCycle(now: Long, cfg: PomodoroConfig): Int {
        val last = db.rows("SELECT phase, cycle_index, ended_at FROM focus_sessions WHERE mode = 'pomodoro' AND status IN ('completed','skipped') ORDER BY started_at DESC LIMIT 1") {
            Triple(it.getString(0), it.getInt(1), if (it.isNull(2)) null else it.getLong(2))
        }.firstOrNull() ?: return 1
        val (phase, idx, ended) = last
        return if (ended != null && now - ended <= FocusMath.CYCLE_CONTINUE_MS && phase != "long_break") (if (idx >= maxOf(1, cfg.longBreakEvery)) 1 else idx + 1) else 1
    }

    fun start(mode: String, durationMin: Int?, subjectId: String?, note: String, strict: Boolean, now: Long = Repo.now()): Session {
        if (mode !in FocusMath.MODES) throw FocusException("Unknown focus mode")
        val cfg = repo.pomodoro
        val planned = if (mode == "stopwatch") null else {
            val min = durationMin ?: FocusMath.defaultMinutes(mode, cfg.focusMin, cfg.shortBreakMin) ?: 25
            if (min !in 1..600) throw FocusException("Duration must be between 1 and 600 minutes")
            min * MINUTE_MS
        }
        return db.tx {
            if (active() != null) throw FocusException("A session is already running. End it before starting another.")
            val cycle = if (mode == "pomodoro") nextCycle(now, cfg) else 0
            val seed = subjectId?.let { Session("", "", "", "", null, 0, null, 0, null, 0, 0, null, it, null, "", false) }
            insertPhase(mode, if (mode == "break") "short_break" else "focus", planned, now, cycle, seed, note.take(2000), strict)
        }.also { repo.changed() }
    }

    private fun require(): Session = active() ?: throw FocusException("No session is running")

    fun pause(now: Long = Repo.now()) {
        db.tx {
            val s = require()
            if (s.status != "running") throw FocusException("Session is not running")
            update("focus_sessions", values("status" to "paused", "paused_at" to maxOf(now, s.startedAt), "updated_at" to now), "id = ?", arrayOf(s.id))
        }
        repo.changed()
    }

    fun resume(now: Long = Repo.now()) {
        db.tx {
            val s = require()
            val p = s.pausedAt?.takeIf { s.status == "paused" } ?: throw FocusException("Session is not paused")
            update("focus_sessions", values("status" to "running", "paused_at" to null, "paused_total_ms" to s.pausedTotalMs + maxOf(0, now - p), "updated_at" to now), "id = ?", arrayOf(s.id))
        }
        repo.changed()
    }

    private fun finalize(s: Session, endedAt: Long, status: String, now: Long): Session {
        val pausedTotal = s.pausedAt?.let { s.pausedTotalMs + maxOf(0, endedAt - it) } ?: s.pausedTotalMs
        val raw = maxOf(0, endedAt - s.startedAt - pausedTotal)
        val focused = s.plannedMs?.let { minOf(raw, it) } ?: minOf(raw, FocusMath.STOPWATCH_MAX_MS)
        db.update("focus_sessions", values("status" to status, "ended_at" to maxOf(endedAt, s.startedAt), "paused_at" to null, "paused_total_ms" to pausedTotal, "focused_ms" to focused, "updated_at" to now), "id = ?", arrayOf(s.id))
        db.delete("timer_state", "session_id = ?", arrayOf(s.id))
        return get(s.id)
    }

    fun end(now: Long = Repo.now()): Session = db.tx {
        val s = require()
        val reached = s.plannedMs?.let { FocusMath.elapsedMs(s.timing, now) >= it } ?: true
        finalize(s, now, when { reached -> "completed"; s.isBreak -> "skipped"; else -> "interrupted" }, now)
    }.also { repo.changed() }

    fun reset() {
        db.tx { delete("focus_sessions", "id = ?", arrayOf(require().id)) }
        repo.changed()
    }

    fun skipBreak(now: Long = Repo.now()): List<FocusEvent> = db.tx {
        val s = require()
        if (!s.isBreak) throw FocusException("Only breaks can be skipped")
        val done = finalize(s, now, "skipped", now)
        val out = mutableListOf<FocusEvent>(FocusEvent.Completed(done))
        val cfg = repo.pomodoro
        if (cfg.autoStartFocus && done.mode == "pomodoro") out += FocusEvent.Started(nextFocus(done, cfg, now))
        out
    }.also { repo.changed() }

    private fun nextFocus(after: Session, cfg: PomodoroConfig, now: Long): Session =
        insertPhase("pomodoro", "focus", cfg.focusMin * MINUTE_MS, now, if (after.phase == "long_break") 1 else after.cycleIndex + 1, after, "", after.strict)

    fun tick(now: Long = Repo.now()): List<FocusEvent> {
        val cfg = repo.pomodoro
        val events = db.tx {
            val out = mutableListOf<FocusEvent>()
            repeat(4) {
                val s = active() ?: return@tx out
                if (s.status == "running" && s.plannedMs == null && FocusMath.elapsedMs(s.timing, now) >= FocusMath.STOPWATCH_MAX_MS) {
                    out += FocusEvent.Completed(finalize(s, s.startedAt + s.pausedTotalMs + FocusMath.STOPWATCH_MAX_MS, "completed", now))
                    return@tx out
                }
                val due = FocusMath.dueAt(s.timing) ?: return@tx out
                if (due > now) return@tx out
                val done = finalize(s, due, "completed", now)
                out += FocusEvent.Completed(done)
                if (done.mode != "pomodoro") return@tx out
                if (done.phase == "focus" && cfg.autoStartBreaks) {
                    val phase = FocusMath.breakAfter(done.cycleIndex, cfg.longBreakEvery)
                    val minutes = if (phase == "long_break") cfg.longBreakMin else cfg.shortBreakMin
                    out += FocusEvent.Started(insertPhase("pomodoro", phase, minutes * MINUTE_MS, due, done.cycleIndex, done, "", done.strict))
                    return@repeat
                }
                if (done.isBreak && cfg.autoStartFocus && now - due <= FocusMath.LIVE_GRACE_MS) out += FocusEvent.Started(nextFocus(done, cfg, now))
                return@tx out
            }
            out
        }
        if (events.isNotEmpty()) repo.changed()
        return events
    }
}
