package app.monkmode.engine

import app.monkmode.core.ListRow
import app.monkmode.core.RuleRow
import app.monkmode.core.ScheduleRow
import app.monkmode.core.BlockResolver as CoreResolver
import app.monkmode.data.ActiveBlocks
import app.monkmode.data.Repo
import app.monkmode.data.rows
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/**
 * Resolves which packages must be shielded now: lists triggered by focus, schedules, quick blocks
 * or strict sessions, plus apps over their daily limit; minus allowlisted apps and temporary
 * exceptions (exceptions never weaken a strict session). Mirrors blockset.ts / rules.rs.
 */
class BlockResolver(private val repo: Repo, private val focus: FocusEngine, private val strict: StrictEngine) {

    /** Gathers the current state from the database and delegates to the unit-tested core resolver. */
    fun resolve(now: Long = Repo.now()): ActiveBlocks {
        val dayStart = LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
        val limitExceeded = repo.db.rows(
            "SELECT l.value, l.minutes_per_day, (SELECT COALESCE(SUM(duration_ms),0) FROM app_usage u WHERE u.app_id = l.value AND u.started_at >= ?) AS used FROM usage_limits l WHERE l.enabled = 1 AND l.type = 'app' AND l.platform IN ('all','android')",
            dayStart,
        ) { Triple(it.getString(0), it.getLong(1), it.getLong(2)) }.filter { (_, minutes, used) -> used >= minutes * 60_000 }.map { it.first }.toSet()
        val result = CoreResolver.resolve(
            at = LocalDateTime.now(),
            nowMs = now,
            lists = repo.blocklists().map { ListRow(it.id, it.kind, it.enabled, it.blockDuringFocus, it.mode, it.pauseSeconds, it.pauseAllowMin) },
            rules = repo.rules().map { RuleRow(it.listId, it.type, it.value, it.platform) },
            schedules = repo.schedules().map { ScheduleRow(it.listId, it.daysMask, it.startMinute, it.endMinute, it.strict, it.enabled) },
            quickBlockLists = repo.activeQuickBlocks().map { it.first }.toSet(),
            focusActive = focus.active()?.phase == "focus",
            strictLists = strict.active()?.takeIf { it.state == "ACTIVE" }?.listIds.orEmpty().toSet(),
            exceptions = repo.db.rows("SELECT value FROM exceptions WHERE type = 'app' AND until_at > ?", now) { it.getString(0) }.toSet(),
            limitExceeded = limitExceeded,
        )
        return ActiveBlocks(result.packages, result.triggers, result.strict, result.triggerFor, result.listFor, result.pauseLists)
    }

    /** Whether Monk Guard needs to watch the foreground right now. */
    fun needsWatching(now: Long = Repo.now()): Boolean = resolve(now).active
}

/** Rule edits that respect strict-session locks (and record refused attempts). */
class GuardRules(private val repo: Repo, private val strict: StrictEngine) {
    private fun guard(listId: String, what: String) {
        if (listId in strict.protectedLists()) {
            strict.record(strict.active()?.id, "blocked_edit", what)
            throw FocusException("This list is locked while a strict session is active.")
        }
    }

    /** Switching a strict-protected list to Mindful pause would weaken it, so that is refused. */
    fun setListMode(listId: String, mode: String, pauseSeconds: Int, pauseAllowMin: Int) {
        require(mode == "block" || mode == "pause") { "Unknown mode" }
        if (mode == "pause") guard(listId, "Tried to switch a list to Mindful pause")
        repo.db.update("blocklists", app.monkmode.data.values("mode" to mode, "pause_seconds" to pauseSeconds.coerceIn(3, 60), "pause_allow_min" to pauseAllowMin.coerceIn(1, 30), "updated_at" to Repo.now()), "id = ?", arrayOf(listId))
        repo.changed()
    }

    fun deleteRule(listId: String, ruleId: String) {
        guard(listId, "Tried to remove a rule")
        repo.db.delete("block_rules", "id = ?", arrayOf(ruleId))
        repo.changed()
    }

    fun setListEnabled(listId: String, enabled: Boolean) {
        if (!enabled) guard(listId, "Tried to disable a list")
        repo.db.update("blocklists", app.monkmode.data.values("enabled" to enabled, "updated_at" to Repo.now()), "id = ?", arrayOf(listId))
        repo.changed()
    }

    fun deleteList(listId: String) {
        guard(listId, "Tried to delete a list")
        repo.db.delete("blocklists", "id = ?", arrayOf(listId))
        repo.changed()
    }

    fun deleteSchedule(id: String, isStrict: Boolean) {
        if (isStrict && strict.active() != null) {
            strict.record(strict.active()?.id, "blocked_edit", "Tried to delete a strict schedule")
            throw FocusException("Strict schedules are locked while a strict session is active.")
        }
        repo.db.delete("schedules", "id = ?", arrayOf(id))
        repo.changed()
    }

    fun grantException(pkg: String, minutes: Int) {
        if (strict.active()?.let { it.level != "normal" } == true) {
            strict.record(strict.active()?.id, "exception_refused", pkg)
            throw FocusException("Temporary exceptions are disabled during a strict session.")
        }
        repo.db.insert("exceptions", null, app.monkmode.data.values("id" to app.monkmode.data.MonkDatabase.newId(), "type" to "app", "value" to pkg, "reason" to "", "until_at" to Repo.now() + minutes.coerceIn(1, 30) * 60_000L, "created_at" to Repo.now()))
        repo.changed()
    }
}
