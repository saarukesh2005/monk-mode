package app.monkmode.core

import org.json.JSONObject
import java.nio.ByteBuffer
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Encrypted backup container, byte-compatible with apps/desktop/src-tauri/src/backup.rs:
 * b"MONKBAK1" | u32 BE header length | header JSON | AES-256-GCM(ciphertext ‖ tag), header as AAD.
 */
object BackupCrypto {
    private val MAGIC = "MONKBAK1".toByteArray(Charsets.US_ASCII)
    const val ITERATIONS = 600_000
    const val MIN_PASSPHRASE = 8

    class BackupException(message: String) : Exception(message)

    /** PBKDF2-HMAC-SHA256 → 32-byte AES key (public for the RFC 7914 known-answer test). */
    fun deriveKey(pass: String, salt: ByteArray, iterations: Int): ByteArray {
        val spec = PBEKeySpec(pass.toCharArray(), salt, iterations, 256)
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }

    private fun key(pass: String, salt: ByteArray, iterations: Int): SecretKeySpec = SecretKeySpec(deriveKey(pass, salt, iterations), "AES")

    fun encrypt(plain: ByteArray, passphrase: String, iterations: Int = ITERATIONS): ByteArray {
        if (passphrase.length < MIN_PASSPHRASE) throw BackupException("Passphrase must be at least $MIN_PASSPHRASE characters")
        val rnd = SecureRandom()
        val salt = ByteArray(16).also(rnd::nextBytes)
        val nonce = ByteArray(12).also(rnd::nextBytes)
        val b64 = Base64.getEncoder()
        val header = JSONObject()
            .put("magic", "MONKBAK1").put("kdf", "PBKDF2-HMAC-SHA256").put("iterations", iterations)
            .put("salt", b64.encodeToString(salt)).put("nonce", b64.encodeToString(nonce)).put("cipher", "AES-256-GCM")
            .toString().toByteArray(Charsets.UTF_8)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(passphrase, salt, iterations), GCMParameterSpec(128, nonce))
        cipher.updateAAD(header)
        val ct = cipher.doFinal(plain)
        return ByteBuffer.allocate(12 + header.size + ct.size).put(MAGIC).putInt(header.size).put(header).put(ct).array()
    }

    fun decrypt(data: ByteArray, passphrase: String): ByteArray {
        val bad = BackupException("This is not a MONK MODE backup file")
        if (data.size < 12 || !data.copyOfRange(0, 8).contentEquals(MAGIC)) throw bad
        val len = ByteBuffer.wrap(data, 8, 4).int
        if (len <= 0 || len > 4096 || data.size < 12 + len) throw bad
        val headerBytes = data.copyOfRange(12, 12 + len)
        val h = try { JSONObject(String(headerBytes, Charsets.UTF_8)) } catch (e: Exception) { throw bad }
        val iterations = h.optInt("iterations")
        if (h.optString("kdf") != "PBKDF2-HMAC-SHA256" || h.optString("cipher") != "AES-256-GCM" || iterations !in 100_000..10_000_000) {
            throw BackupException("Unsupported backup encryption parameters")
        }
        val dec = Base64.getDecoder()
        val salt = dec.decode(h.optString("salt"))
        val nonce = dec.decode(h.optString("nonce"))
        if (nonce.size != 12) throw bad
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(passphrase, salt, iterations), GCMParameterSpec(128, nonce))
        cipher.updateAAD(headerBytes)
        return try {
            cipher.doFinal(data, 12 + len, data.size - 12 - len)
        } catch (e: Exception) {
            throw BackupException("Wrong passphrase, or the file is damaged")
        }
    }

    /** Tables in foreign-key-safe order. Mirrors BACKUP_TABLES in shared-core and backup.rs. */
    val TABLES = listOf(
        "categories", "subjects", "topics", "tasks", "tags", "task_tags", "focus_sessions", "blocklists",
        "block_rules", "schedules", "quick_blocks", "usage_limits", "exceptions", "strict_sessions",
        "strict_session_lists", "strict_events", "block_events", "app_usage", "web_usage", "events",
        "daily_plans", "notifications", "settings",
    )
    val DEVICE_LOCAL_SETTINGS = setOf("extensionToken", "hostsBlockingEnabled", "startOnLogin")
}
