package app.monkmode.core

/** Persisted timing fields of a focus phase. All values are epoch milliseconds. */
data class Timing(
    val startedAt: Long,
    val pausedAt: Long?,
    val pausedTotalMs: Long,
    val plannedMs: Long?,
    val endedAt: Long?,
    val running: Boolean,
)

/** Mirrors packages/shared-core/src/focus.ts and apps/desktop/src-tauri/src/focus.rs. */
object FocusMath {
    const val MINUTE_MS = 60_000L
    const val STOPWATCH_MAX_MS = 12 * 60 * MINUTE_MS
    /** A break only auto-starts the next focus if it ended this recently (the user is present). */
    const val LIVE_GRACE_MS = 15_000L
    /** Pomodoro rounds continue if the previous phase ended within this window. */
    const val CYCLE_CONTINUE_MS = 2 * 60 * MINUTE_MS
    val PRESETS = listOf(5, 15, 25, 45, 60, 90)
    val MODES = listOf("pomodoro", "deep_work", "study", "reading", "custom", "stopwatch", "break")
    val MODE_LABELS = mapOf(
        "pomodoro" to "Pomodoro", "stopwatch" to "Stopwatch", "custom" to "Custom", "deep_work" to "Deep Work",
        "study" to "Study", "reading" to "Reading", "break" to "Break",
    )

    fun elapsedMs(t: Timing, now: Long): Long = maxOf(0, (t.endedAt ?: t.pausedAt ?: now) - t.startedAt - t.pausedTotalMs)
    fun remainingMs(t: Timing, now: Long): Long? = t.plannedMs?.let { maxOf(0, it - elapsedMs(t, now)) }
    fun dueAt(t: Timing): Long? = if (!t.running) null else t.plannedMs?.let { t.startedAt + t.pausedTotalMs + it }

    fun defaultMinutes(mode: String, focusMin: Int, shortBreakMin: Int): Int? = when (mode) {
        "stopwatch" -> null
        "pomodoro" -> focusMin
        "deep_work" -> 90
        "study" -> 50
        "reading" -> 30
        "break" -> shortBreakMin
        else -> 45
    }

    /** Break phase that follows focus round `cycleIndex` (1-based). */
    fun breakAfter(cycleIndex: Int, longBreakEvery: Int): String =
        if (cycleIndex > 0 && cycleIndex % maxOf(1, longBreakEvery) == 0) "long_break" else "short_break"

    fun format(ms: Long, seconds: Boolean = false): String {
        val total = maxOf(0, ms / 1000)
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        if (seconds) return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s)
        return when {
            h > 0 && m > 0 -> "${h}h ${m}m"
            h > 0 -> "${h}h"
            else -> "${m}m"
        }
    }
}
