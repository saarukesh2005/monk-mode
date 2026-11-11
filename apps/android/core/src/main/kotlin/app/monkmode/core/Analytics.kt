package app.monkmode.core

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Mirrors packages/analytics: per-day focus (split across midnight) and streaks. Never invents data. */
object Analytics {
    data class FinishedFocus(val startedAt: Long, val endedAt: Long, val focusedMs: Long)

    fun focusByDay(sessions: List<FinishedFocus>, zone: ZoneId = ZoneId.systemDefault()): Map<LocalDate, Long> {
        val out = mutableMapOf<LocalDate, Long>()
        for (s in sessions) {
            if (s.focusedMs <= 0) continue
            val span = s.endedAt - s.startedAt
            if (span <= 0) {
                val d = Instant.ofEpochMilli(s.startedAt).atZone(zone).toLocalDate()
                out[d] = (out[d] ?: 0) + s.focusedMs
                continue
            }
            var cursor = s.startedAt
            while (cursor < s.endedAt) {
                val day = Instant.ofEpochMilli(cursor).atZone(zone).toLocalDate()
                val next = day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
                val segEnd = minOf(s.endedAt, next)
                out[day] = (out[day] ?: 0) + Math.round(s.focusedMs.toDouble() * (segEnd - cursor) / span)
                cursor = segEnd
            }
        }
        return out
    }

    /** (current, best) streak of days with at least [minMs] focus; today may still be empty. */
    fun streak(byDay: Map<LocalDate, Long>, today: LocalDate, minMs: Long = 60_000): Pair<Int, Int> {
        fun ok(d: LocalDate) = (byDay[d] ?: 0) >= minMs
        var current = 0
        var cursor = if (ok(today)) today else today.minusDays(1)
        while (ok(cursor)) {
            current++
            cursor = cursor.minusDays(1)
        }
        var best = 0
        var run = 0
        var prev: LocalDate? = null
        for (d in byDay.keys.filter(::ok).sorted()) {
            run = if (prev != null && prev.plusDays(1) == d) run + 1 else 1
            best = maxOf(best, run)
            prev = d
        }
        return current to maxOf(best, current)
    }
}
