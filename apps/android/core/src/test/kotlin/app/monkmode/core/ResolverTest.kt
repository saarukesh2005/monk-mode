package app.monkmode.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDateTime

class ResolverTest {
    private val monday10 = LocalDateTime.of(2026, 11, 9, 10, 0)
    private val lists = listOf(ListRow("w", "block", true, true), ListRow("a", "allow", true, false))
    private val rules = listOf(
        RuleRow("w", "app", "com.instagram.android", "all"),
        RuleRow("w", "app", "com.reddit.frontpage", "android"),
        RuleRow("w", "app", "Discord", "macos"),
        RuleRow("w", "domain", "reddit.com", "all"),
        RuleRow("w", "app", "com.android.systemui", "android"),
        RuleRow("a", "app", "com.reddit.frontpage", "all"),
    )

    private fun resolve(focus: Boolean = false, strict: Set<String> = emptySet(), schedules: List<ScheduleRow> = emptyList(), exceptions: Set<String> = emptySet()) =
        BlockResolver.resolve(monday10, 0, lists, rules, schedules, emptySet(), focus, strict, exceptions, emptySet())

    @Test fun inactiveWithoutTriggers() = assertFalse(resolve().active)

    @Test fun focusBlocksAndroidPackagesButNeverSystemOrAllowlisted() {
        val s = resolve(focus = true)
        assertEquals(setOf("com.instagram.android"), s.packages)
        assertEquals(setOf("focus"), s.triggers)
    }

    @Test fun weekdayScheduleActivates() {
        val s = resolve(schedules = listOf(ScheduleRow("w", Schedules.WEEKDAYS, 540, 1020, strict = false, enabled = true)))
        assertEquals(setOf("schedule"), s.triggers)
    }

    @Test fun exceptionsNeverWeakenStrictLists() {
        val ex = setOf("com.instagram.android")
        assertTrue(resolve(focus = true, exceptions = ex).packages.isEmpty())
        val strict = resolve(strict = setOf("w"), exceptions = ex)
        assertTrue(strict.strict)
        assertEquals(setOf("com.instagram.android"), strict.packages)
    }

    /** backup-v1.monkbak is produced by Node.js (scripts/make-backup-vector.mjs): a third implementation. */
    @Test fun decryptsBackupWrittenByNode() {
        val dir = File(System.getProperty("monk.vectors"))
        val plain = BackupCrypto.decrypt(File(dir, "backup-v1.monkbak").readBytes(), "monk-vector-passphrase").decodeToString()
        assertTrue(plain.contains("Cross-platform backup works"))
    }
}
