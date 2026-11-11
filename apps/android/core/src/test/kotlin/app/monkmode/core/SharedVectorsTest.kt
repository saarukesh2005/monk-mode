package app.monkmode.core

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.File
import java.time.LocalDateTime

/** Runs the same JSON vectors as the TypeScript (vitest) and Rust (cargo test) suites. */
class SharedVectorsTest {
    private val dir = File(System.getProperty("monk.vectors") ?: "../../../packages/shared-core/vectors")
    private fun json(name: String) = JSONObject(File(dir, name).readText())

    @Test
    fun scheduleVectors() {
        val cases = json("schedules.json").getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val at = LocalDateTime.parse(c.getString("at"))
            assertEquals(c.getString("name"), c.getBoolean("expected"), Schedules.isWindowActive(c.getInt("daysMask"), c.getInt("startMinute"), c.getInt("endMinute"), at))
        }
    }

    @Test
    fun domainNormalizationVectors() {
        val cases = json("urls.json").getJSONArray("normalize")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val expected = if (c.isNull("expected")) null else c.getString("expected")
            assertEquals(c.getString("input"), expected, Matching.normalizeDomain(c.getString("input")))
        }
    }

    @Test
    fun focusTimingVectors() {
        val v = json("focus.json")
        val cases = v.getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val pausedAt = if (c.isNull("pausedAt")) null else c.getLong("pausedAt")
            val t = Timing(c.getLong("startedAt"), pausedAt, c.getLong("pausedTotalMs"), if (c.isNull("plannedMs")) null else c.getLong("plannedMs"), null, running = pausedAt == null)
            val now = c.getLong("now")
            val name = c.getString("name")
            assertEquals(name, c.getLong("elapsed"), FocusMath.elapsedMs(t, now))
            assertEquals(name, if (c.isNull("remaining")) null else c.getLong("remaining"), FocusMath.remainingMs(t, now))
            assertEquals(name, if (c.isNull("due")) null else c.getLong("due"), FocusMath.dueAt(t))
        }
        val breaks = v.getJSONArray("breaks")
        for (i in 0 until breaks.length()) {
            val b = breaks.getJSONObject(i)
            assertEquals(b.getString("phase"), FocusMath.breakAfter(b.getInt("completed"), b.getInt("every")))
        }
    }

    @Test
    fun strictPolicyVectors() {
        val v = json("strict.json")
        assertEquals(v.getString("phrase"), StrictPolicy.MAXIMUM_EXIT_PHRASE)
        val policies = v.getJSONArray("policies")
        for (i in 0 until policies.length()) {
            val p = policies.getJSONObject(i)
            val pol = StrictPolicy.exitPolicy(p.getString("level"))
            assertEquals(p.getInt("minReasonLength"), pol.minReasonLength)
            assertEquals(p.getLong("cooldownMs"), pol.cooldownMs)
            assertEquals(p.getBoolean("requiresPhrase"), pol.phrase != null)
            assertEquals(p.getBoolean("canPause"), pol.canPause)
            assertEquals(p.getBoolean("canRemoveRules"), pol.canRemoveRules)
        }
    }

    @Test
    fun decryptsBackupCreatedByDesktop() {
        val data = File(dir, "backup-fixture.monkbak").readBytes()
        val plain = BackupCrypto.decrypt(data, "monk-mode-fixture")
        assertEquals("""{"format":"monk-mode-backup","hello":"monk"}""", String(plain, Charsets.UTF_8))
        assertThrows(BackupCrypto.BackupException::class.java) { BackupCrypto.decrypt(data, "wrong-passphrase") }
    }
}
