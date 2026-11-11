package app.monkmode.core

import java.time.LocalDateTime

/** Mirrors packages/shared-core/src/schedule.ts. daysMask bit 0 = Monday … bit 6 = Sunday. */
object Schedules {
    const val ALL_DAYS = 0b1111111
    const val WEEKDAYS = 0b0011111
    const val WEEKEND = 0b1100000
    val DAY_LABELS = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

    private fun inMask(mask: Int, day: Int) = mask and (1 shl day) != 0

    fun isWindowActive(daysMask: Int, startMinute: Int, endMinute: Int, at: LocalDateTime): Boolean {
        val day = at.dayOfWeek.value - 1
        val minute = at.hour * 60 + at.minute
        if (startMinute == endMinute) return inMask(daysMask, day)
        if (startMinute < endMinute) return inMask(daysMask, day) && minute >= startMinute && minute < endMinute
        val previous = (day + 6) % 7
        return (inMask(daysMask, day) && minute >= startMinute) || (inMask(daysMask, previous) && minute < endMinute)
    }

    fun describeDays(mask: Int): String = when (mask) {
        ALL_DAYS -> "Every day"
        WEEKDAYS -> "Weekdays"
        WEEKEND -> "Weekends"
        else -> DAY_LABELS.filterIndexed { i, _ -> inMask(mask, i) }.joinToString(", ")
    }

    fun clock(minute: Int): String = "%02d:%02d".format(minute / 60, minute % 60)
}
