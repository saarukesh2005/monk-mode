package app.monkmode.data

import android.database.Cursor
import app.monkmode.core.Timing

data class Session(
    val id: String, val mode: String, val phase: String, val status: String, val plannedMs: Long?,
    val startedAt: Long, val pausedAt: Long?, val pausedTotalMs: Long, val endedAt: Long?, val focusedMs: Long,
    val cycleIndex: Int, val categoryId: String?, val subjectId: String?, val taskId: String?, val note: String, val strict: Boolean,
) {
    val timing get() = Timing(startedAt, pausedAt, pausedTotalMs, plannedMs, endedAt, running = status == "running")
    val isBreak get() = phase != "focus"

    companion object {
        fun from(c: Cursor) = Session(
            c.str("id"), c.str("mode"), c.str("phase"), c.str("status"), c.longOrNull("planned_ms"), c.long("started_at"),
            c.longOrNull("paused_at"), c.long("paused_total_ms"), c.longOrNull("ended_at"), c.long("focused_ms"), c.int("cycle_index"),
            c.strOrNull("category_id"), c.strOrNull("subject_id"), c.strOrNull("task_id"), c.str("note"), c.bool("strict"),
        )
    }
}

data class Task(
    val id: String, val parentId: String?, val title: String, val notes: String, val priority: Int, val status: String,
    val dueDate: String?, val recurrence: String, val subjectId: String?, val completedAt: Long?,
) {
    companion object {
        fun from(c: Cursor) = Task(
            c.str("id"), c.strOrNull("parent_id"), c.str("title"), c.str("notes"), c.int("priority"), c.str("status"),
            c.strOrNull("due_date"), c.str("recurrence"), c.strOrNull("subject_id"), c.longOrNull("completed_at"),
        )
    }
}

data class Blocklist(
    val id: String, val name: String, val kind: String, val enabled: Boolean, val blockDuringFocus: Boolean,
    val mode: String = "block", val pauseSeconds: Int = 10, val pauseAllowMin: Int = 5,
) {
    companion object {
        fun from(c: Cursor) = Blocklist(
            c.str("id"), c.str("name"), c.str("kind"), c.bool("enabled"), c.bool("block_during_focus"),
            c.str("mode"), c.int("pause_seconds"), c.int("pause_allow_min"),
        )
    }
}

data class Rule(val id: String, val listId: String, val type: String, val value: String, val label: String, val platform: String) {
    companion object {
        fun from(c: Cursor) = Rule(c.str("id"), c.str("list_id"), c.str("type"), c.str("value"), c.str("label"), c.str("platform"))
    }
}

data class Schedule(
    val id: String, val name: String, val listId: String, val daysMask: Int, val startMinute: Int, val endMinute: Int,
    val strict: Boolean, val enabled: Boolean,
) {
    companion object {
        fun from(c: Cursor) = Schedule(c.str("id"), c.str("name"), c.str("list_id"), c.int("days_mask"), c.int("start_minute"), c.int("end_minute"), c.bool("strict"), c.bool("enabled"))
    }
}

data class StrictSession(
    val id: String, val level: String, val state: String, val startedAt: Long, val endsAt: Long, val pausedAt: Long?,
    val exitReason: String, val exitRequestedAt: Long?, val listIds: List<String>,
) {
    companion object {
        fun from(c: Cursor, lists: List<String>) = StrictSession(
            c.str("id"), c.str("level"), c.str("state"), c.long("started_at"), c.long("ends_at"), c.longOrNull("paused_at"),
            c.str("exit_reason"), c.longOrNull("exit_requested_at"), lists,
        )
    }
}

data class Subject(val id: String, val name: String, val color: String, val weeklyGoalMin: Int, val archived: Boolean) {
    companion object {
        fun from(c: Cursor) = Subject(c.str("id"), c.str("name"), c.str("color"), c.int("weekly_goal_min"), c.bool("archived"))
    }
}

data class Topic(val id: String, val subjectId: String, val title: String, val status: String, val nextReview: String?, val reviewCount: Int) {
    companion object {
        fun from(c: Cursor) = Topic(c.str("id"), c.str("subject_id"), c.str("title"), c.str("status"), c.strOrNull("next_review"), c.int("review_count"))
    }
}

data class DailyPlan(val date: String, val intention: String, val priorities: List<String>, val focusTargetMin: Int, val review: String, val mood: Int?)

data class BlockEvent(val id: String, val ts: Long, val target: String, val action: String, val trigger: String)

data class StrictEvent(val id: String, val ts: Long, val kind: String, val detail: String)

data class UsageTotal(val key: String, val label: String, val ms: Long)

/** What Monk Guard must enforce right now. */
data class ActiveBlocks(
    val packages: Set<String>, val triggers: Set<String>, val strict: Boolean, val triggerFor: Map<String, String>, val listFor: Map<String, String>,
    val pauseLists: Map<String, app.monkmode.core.PauseCfg> = emptyMap(),
) {
    val active get() = packages.isNotEmpty()
    fun pauseFor(pkg: String) = listFor[pkg]?.let { pauseLists[it] }

    companion object {
        val NONE = ActiveBlocks(emptySet(), emptySet(), false, emptyMap(), emptyMap())
    }
}

data class PauseStats(val total: Int, val turnedBack: Int)
