package app.monkmode.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CoreTest {
    @Test
    fun backupRoundTripAndTamperDetection() {
        val ct = BackupCrypto.encrypt("hello monk".toByteArray(), "correct horse", 100_000)
        assertArrayEquals("hello monk".toByteArray(), BackupCrypto.decrypt(ct, "correct horse"))
        val tampered = ct.copyOf().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() }
        assertThrows(BackupCrypto.BackupException::class.java) { BackupCrypto.decrypt(tampered, "correct horse") }
        assertThrows(BackupCrypto.BackupException::class.java) { BackupCrypto.encrypt(ByteArray(1), "short") }
        assertThrows(BackupCrypto.BackupException::class.java) { BackupCrypto.decrypt("nope".toByteArray(), "correct horse") }
    }

    @Test
    fun pbkdf2MatchesRfc7914TestVector() {
        // RFC 7914 §11: PBKDF2-HMAC-SHA256("passwd", "salt", 1, 64) — first 32 bytes.
        val key = BackupCrypto.deriveKey("passwd", "salt".toByteArray(), 1)
        assertEquals("55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc", key.joinToString("") { "%02x".format(it) })
    }

    @Test
    fun strictExitValidation() {
        assertNull(StrictPolicy.validateExit("normal", "", null))
        assertTrue(StrictPolicy.validateExit("strict", "short", null)!!.contains("reason"))
        assertTrue(StrictPolicy.validateExit("maximum", "x".repeat(30), "wrong")!!.contains("phrase"))
        assertNull(StrictPolicy.validateExit("maximum", "x".repeat(30), StrictPolicy.MAXIMUM_EXIT_PHRASE))
    }

    @Test
    fun helpers() {
        assertEquals("Weekdays", Schedules.describeDays(Schedules.WEEKDAYS))
        assertEquals("1h 30m", FocusMath.format(90 * 60_000L))
        assertEquals("01:05", FocusMath.format(65_000L, seconds = true))
        assertTrue(Matching.isPackageName("com.instagram.android"))
        assertTrue(!Matching.isPackageName("Instagram"))
        assertTrue(Matching.hostMatches("m.youtube.com", "youtube.com"))
    }
}
