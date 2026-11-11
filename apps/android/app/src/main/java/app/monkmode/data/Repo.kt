package app.monkmode.data

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

data class PomodoroConfig(
    val focusMin: Int = 25, val shortBreakMin: Int = 5, val longBreakMin: Int = 15, val longBreakEvery: Int = 4,
    val autoStartBreaks: Boolean = true, val autoStartFocus: Boolean = false,
) {
    fun toJson(): String = JSONObject().put("focusMin", focusMin).put("shortBreakMin", shortBreakMin).put("longBreakMin", longBreakMin)
        .put("longBreakEvery", longBreakEvery).put("autoStartBreaks", autoStartBreaks).put("autoStartFocus", autoStartFocus).toString()

    companion object {
        fun parse(s: String?): PomodoroConfig = runCatching {
            val o = JSONObject(s ?: "{}")
            val d = PomodoroConfig()
            PomodoroConfig(
                o.optInt("focusMin", d.focusMin).coerceIn(1, 600), o.optInt("shortBreakMin", d.shortBreakMin).coerceIn(1, 120),
                o.optInt("longBreakMin", d.longBreakMin).coerceIn(1, 180), o.optInt("longBreakEvery", d.longBreakEvery).coerceIn(1, 12),
                o.optBoolean("autoStartBreaks", d.autoStartBreaks), o.optBoolean("autoStartFocus", d.autoStartFocus),
            )
        }.getOrDefault(PomodoroConfig())
    }
}

/** Single access point to the local database. All calls are synchronous; callers use Dispatchers.IO. */
class Repo private constructor(context: Context) {
    private val helper = MonkDatabase(context.applicationContext)
    val db: SQLiteDatabase get() = helper.writableDatabase

    /** Bumped after every write so Compose screens reload. */
    private val _version = MutableStateFlow(0L)
    val version: StateFlow<Long> = _version
    fun changed() {
        _version.value = _version.value + 1
    }

    // ---------- Settings (JSON values, same keys as desktop) ----------

    fun setting(key: String): String? = db.rows("SELECT value FROM settings WHERE key = ?", key) { it.str("value") }.firstOrNull()

    fun putSetting(key: String, jsonValue: String) {
        db.insertWithOnConflict("settings", null, values("key" to key, "value" to jsonValue, "updated_at" to now()), SQLiteDatabase.CONFLICT_REPLACE)
        changed()
    }

    fun flag(key: String, default: Boolean) = setting(key)?.toBooleanStrictOrNull() ?: default
    fun int(key: String, default: Int) = setting(key)?.toIntOrNull() ?: default
    fun string(key: String, default: String) = setting(key)?.let { runCatching { JSONArray("[$it]").getString(0) }.getOrNull() } ?: default
    fun putFlag(key: String, v: Boolean) = putSetting(key, v.toString())
    fun putInt(key: String, v: Int) = putSetting(key, v.toString())
    fun putString(key: String, v: String) = putSetting(key, JSONObject.quote(v))

    var pomodoro: PomodoroConfig
        get() = PomodoroConfig.parse(setting("pomodoro"))
        set(v) = putSetting("pomodoro", v.toJson())

    // ---------- Tasks ----------

    fun tasks(): List<Task> = db.rows("SELECT * FROM tasks ORDER BY status, priority DESC, COALESCE(due_date,'9999'), sort_order", map = Task::from)

    fun tasksDue(date: String): List<Task> = db.rows("SELECT * FROM tasks WHERE due_date = ? AND parent_id IS NULL", date, map = Task::from)

    fun addTask(title: String, dueDate: String?, priority: Int = 0, recurrence: String = "none", parentId: String? = null, subjectId: String? = null): String {
        val clean = title.trim().take(300)
        require(clean.isNotEmpty()) { "Title is required" }
        require(recurrence == "none" || dueDate != null) { "Recurring tasks need a due date" }
        val id = MonkDatabase.newId()
        db.insertOrThrow("tasks", null, values("id" to id, "parent_id" to parentId, "title" to clean, "priority" to priority.coerceIn(0, 3), "due_date" to dueDate, "recurrence" to recurrence, "subject_id" to subjectId, "sort_order" to (now() % 1_000_000_000), "created_at" to now(), "updated_at" to now()))
        changed()
        return id
    }

    fun setTaskDone(task: Task, done: Boolean) {
        db.tx {
            update("tasks", values("status" to if (done) "done" else "todo", "completed_at" to if (done) now() else null, "updated_at" to now()), "id = ?", arrayOf(task.id))
            if (done && task.recurrence != "none" && task.dueDate != null) {
                val today = LocalDate.now()
                val from = LocalDate.parse(task.dueDate).let { if (it.isBefore(today)) today else it }
                val next = when (task.recurrence) {
                    "daily" -> from.plusDays(1)
                    "weekly" -> from.plusWeeks(1)
                    "monthly" -> from.plusMonths(1)
                    else -> generateSequence(from.plusDays(1)) { it.plusDays(1) }.first { it.dayOfWeek.value <= 5 }
                }
                insertOrThrow("tasks", null, values("id" to MonkDatabase.newId(), "title" to task.title, "notes" to task.notes, "priority" to task.priority, "due_date" to next.toString(), "recurrence" to task.recurrence, "subject_id" to task.subjectId, "created_at" to now(), "updated_at" to now()))
            }
        }
        changed()
    }

    fun deleteTask(id: String) {
        db.delete("tasks", "id = ?", arrayOf(id))
        changed()
    }

    // ---------- Blocking configuration ----------

    fun blocklists(): List<Blocklist> = db.rows("SELECT * FROM blocklists ORDER BY created_at", map = Blocklist::from)
    fun rules(): List<Rule> = db.rows("SELECT * FROM block_rules ORDER BY created_at", map = Rule::from)
    fun schedules(): List<Schedule> = db.rows("SELECT * FROM schedules ORDER BY start_minute", map = Schedule::from)

    fun addList(name: String, kind: String): String {
        val id = MonkDatabase.newId()
        db.insertOrThrow("blocklists", null, values("id" to id, "name" to name.trim().take(80).ifEmpty { "List" }, "kind" to kind, "enabled" to true, "block_during_focus" to (kind == "block"), "created_at" to now(), "updated_at" to now()))
        changed()
        return id
    }

    fun renameList(listId: String, name: String) {
        val clean = name.trim().take(80)
        require(clean.isNotEmpty()) { "Name is required" }
        db.update("blocklists", values("name" to clean, "updated_at" to now()), "id = ?", arrayOf(listId))
        changed()
    }

    fun setBlockDuringFocus(listId: String, on: Boolean) {
        db.update("blocklists", values("block_during_focus" to on, "updated_at" to now()), "id = ?", arrayOf(listId))
        changed()
    }

    fun addAppRule(listId: String, packageName: String, label: String) {
        db.insertWithOnConflict("block_rules", null, values("id" to MonkDatabase.newId(), "list_id" to listId, "type" to "app", "value" to packageName, "label" to label.take(120), "platform" to "android", "created_at" to now()), SQLiteDatabase.CONFLICT_IGNORE)
        changed()
    }

    fun addSchedule(name: String, listId: String, daysMask: Int, start: Int, end: Int, strict: Boolean) {
        require(name.isNotBlank()) { "Name is required" }
        require(daysMask in 1..127) { "Pick at least one day" }
        require(start in 0..1439 && end in 0..1439) { "Times are invalid" }
        db.insertOrThrow("schedules", null, values("id" to MonkDatabase.newId(), "name" to name.trim().take(80), "list_id" to listId, "days_mask" to daysMask, "start_minute" to start, "end_minute" to end, "strict" to strict, "enabled" to true, "created_at" to now(), "updated_at" to now()))
        changed()
    }

    fun quickBlock(listId: String, minutes: Int) {
        require(minutes in 1..1440) { "Choose between 1 minute and 24 hours" }
        db.insertOrThrow("quick_blocks", null, values("id" to MonkDatabase.newId(), "list_id" to listId, "started_at" to now(), "ends_at" to now() + minutes * 60_000L))
        changed()
    }

    fun activeQuickBlocks(): List<Pair<String, Long>> =
        db.rows("SELECT list_id, ends_at FROM quick_blocks WHERE ended_at IS NULL AND started_at <= ? AND ends_at > ?", now(), now()) { it.str("list_id") to it.long("ends_at") }

    fun recordBlock(target: String, listId: String?, trigger: String) {
        db.insert("block_events", null, values("id" to MonkDatabase.newId(), "ts" to now(), "platform" to "android", "source" to "app", "target" to target, "list_id" to listId, "action" to "shield_shown", "trigger" to trigger))
        changed()
    }

    fun recordPause(target: String, listId: String?, outcome: String, intention: String) {
        require(outcome == "turned_back" || outcome == "continued") { "Unknown outcome" }
        db.insert("pause_events", null, values("id" to MonkDatabase.newId(), "ts" to now(), "platform" to "android", "target" to target.take(200), "list_id" to listId, "outcome" to outcome, "intention" to intention.filterNot(Char::isISOControl).take(200)))
        changed()
    }

    fun pauseStats(since: Long): PauseStats = db.rows("SELECT COUNT(*) AS n, COALESCE(SUM(outcome = 'turned_back'), 0) AS back FROM pause_events WHERE ts >= ?", since) {
        PauseStats(it.getInt(0), it.getInt(1))
    }.first()

    fun blockEvents(limit: Int = 300): List<BlockEvent> =
        db.rows("SELECT * FROM block_events ORDER BY ts DESC LIMIT $limit") { BlockEvent(it.str("id"), it.long("ts"), it.str("target"), it.str("action"), it.str("trigger")) }

    fun strictEvents(limit: Int = 300): List<StrictEvent> =
        db.rows("SELECT * FROM strict_events ORDER BY ts DESC LIMIT $limit") { StrictEvent(it.str("id"), it.long("ts"), it.str("kind"), it.str("detail")) }

    // ---------- Sessions & usage ----------

    fun sessionsSince(since: Long): List<Session> = db.rows("SELECT * FROM focus_sessions WHERE started_at >= ? ORDER BY started_at DESC", since, map = Session::from)

    fun deleteSession(id: String) {
        db.delete("focus_sessions", "id = ? AND status NOT IN ('running','paused')", arrayOf(id))
        changed()
    }

    fun topApps(since: Long, limit: Int = 8): List<UsageTotal> =
        db.rows("SELECT app_id, MAX(app_name) AS name, SUM(duration_ms) AS ms FROM app_usage WHERE started_at >= ? GROUP BY app_id ORDER BY ms DESC LIMIT $limit", since) {
            UsageTotal(it.str("app_id"), it.str("name"), it.long("ms"))
        }

    fun screenTimeMs(since: Long): Long = db.rows("SELECT COALESCE(SUM(duration_ms),0) AS ms FROM app_usage WHERE started_at >= ?", since) { it.long("ms") }.first()

    // ---------- Study & planning ----------

    fun subjects(): List<Subject> = db.rows("SELECT * FROM subjects ORDER BY name", map = Subject::from)
    fun topics(): List<Topic> = db.rows("SELECT * FROM topics ORDER BY created_at", map = Topic::from)

    fun addSubject(name: String, weeklyGoalMin: Int, color: String) {
        require(name.isNotBlank()) { "Name is required" }
        db.insertOrThrow("subjects", null, values("id" to MonkDatabase.newId(), "name" to name.trim().take(80), "color" to color, "weekly_goal_min" to weeklyGoalMin.coerceAtLeast(0), "archived" to false, "created_at" to now(), "updated_at" to now()))
        changed()
    }

    fun addTopic(subjectId: String, title: String) {
        if (title.isBlank()) return
        db.insertOrThrow("topics", null, values("id" to MonkDatabase.newId(), "subject_id" to subjectId, "title" to title.trim().take(200), "status" to "not_started", "created_at" to now(), "updated_at" to now()))
        changed()
    }

    private val reviewIntervals = listOf(1L, 3, 7, 14, 30, 60)

    fun reviewTopic(t: Topic) {
        val n = t.reviewCount + 1
        val today = LocalDate.now()
        val next = today.plusDays(reviewIntervals[minOf(n, reviewIntervals.size - 1)])
        db.update("topics", values("review_count" to n, "status" to "done", "last_reviewed" to today.toString(), "next_review" to next.toString(), "updated_at" to now()), "id = ?", arrayOf(t.id))
        changed()
    }

    fun dailyPlan(date: String): DailyPlan? = db.rows("SELECT * FROM daily_plans WHERE date = ?", date) { c ->
        val pr = runCatching { JSONArray(c.str("priorities")) }.getOrDefault(JSONArray())
        DailyPlan(c.str("date"), c.str("intention"), List(pr.length()) { pr.getString(it) }, c.int("focus_target_min"), c.str("review"), c.longOrNull("mood")?.toInt())
    }.firstOrNull()

    fun saveDailyPlan(p: DailyPlan, reviewed: Boolean = false) {
        val cv = values("date" to p.date, "intention" to p.intention.take(500), "priorities" to JSONArray(p.priorities.filter { it.isNotBlank() }.map { it.take(200) }).toString(), "focus_target_min" to p.focusTargetMin.coerceIn(0, 1440), "review" to p.review.take(5000), "mood" to p.mood, "updated_at" to now())
        if (reviewed) cv.put("reviewed_at", now())
        db.insertWithOnConflict("daily_plans", null, cv, SQLiteDatabase.CONFLICT_REPLACE)
        changed()
    }

    fun seedIfNeeded() {
        if (flag("seeded", false)) return
        db.tx {
            for ((n, c) in listOf("Work" to "#86B7E0", "Study" to "#E3A857", "Reading" to "#8DBF98", "Personal" to "#A595F5")) {
                insert("categories", null, values("id" to MonkDatabase.newId(), "name" to n, "color" to c, "kind" to "session", "created_at" to now()))
            }
            insert("blocklists", null, values("id" to MonkDatabase.newId(), "name" to "Distractions", "kind" to "block", "enabled" to true, "block_during_focus" to true, "created_at" to now(), "updated_at" to now()))
        }
        putFlag("seeded", true)
    }

    companion object {
        @Volatile private var instance: Repo? = null
        fun get(context: Context): Repo = instance ?: synchronized(this) { instance ?: Repo(context).also { instance = it } }
        fun now(): Long = System.currentTimeMillis()
    }
}
