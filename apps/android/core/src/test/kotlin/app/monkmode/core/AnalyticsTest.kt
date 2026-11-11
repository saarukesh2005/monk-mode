package app.monkmode.core

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class AnalyticsTest {
    private val zone = ZoneId.of("Asia/Kolkata")
    private fun at(d: Int, h: Int, m: Int = 0) = LocalDate.of(2026, 11, d).atTime(h, m).atZone(zone).toInstant().toEpochMilli()

    @Test
    fun splitsSessionsAcrossMidnight() {
        val byDay = Analytics.focusByDay(listOf(Analytics.FinishedFocus(at(9, 23, 30), at(10, 0, 30), 60 * 60_000L)), zone)
        assertEquals(30 * 60_000L, byDay[LocalDate.of(2026, 11, 9)])
        assertEquals(30 * 60_000L, byDay[LocalDate.of(2026, 11, 10)])
    }

    @Test
    fun computesStreaks() {
        val m = 60_000L
        val byDay = listOf(1, 2, 3, 8, 9).associate { LocalDate.of(2026, 11, it) to m }
        assertEquals(2 to 3, Analytics.streak(byDay, LocalDate.of(2026, 11, 10)))
        assertEquals(0 to 3, Analytics.streak(byDay, LocalDate.of(2026, 11, 12)))
    }
}
