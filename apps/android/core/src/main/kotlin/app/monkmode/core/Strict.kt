package app.monkmode.core

/** Mirrors packages/shared-core/src/strict.ts. Every level keeps an emergency exit. */
data class ExitPolicy(
    val minReasonLength: Int,
    val cooldownMs: Long,
    val phrase: String?,
    val canPause: Boolean,
    val canRemoveRules: Boolean,
)

object StrictPolicy {
    const val MAXIMUM_EXIT_PHRASE = "I choose to end this commitment early"
    const val MIN_DURATION_MIN = 5
    const val MAX_DURATION_MIN = 12 * 60

    fun exitPolicy(level: String, maximumCooldownSec: Int = 300): ExitPolicy = when (level) {
        "strict" -> ExitPolicy(10, 30_000, null, canPause = false, canRemoveRules = false)
        "maximum" -> ExitPolicy(25, maximumCooldownSec.coerceIn(60, 1800) * 1000L, MAXIMUM_EXIT_PHRASE, canPause = false, canRemoveRules = false)
        else -> ExitPolicy(0, 0, null, canPause = true, canRemoveRules = true)
    }

    /** Returns a user-facing error, or null if the exit request is acceptable. */
    fun validateExit(level: String, reason: String, phrase: String?, maximumCooldownSec: Int = 300): String? {
        val policy = exitPolicy(level, maximumCooldownSec)
        if (reason.trim().length < policy.minReasonLength) return "Please describe the reason (at least ${policy.minReasonLength} characters)"
        if (policy.phrase != null && phrase?.trim() != policy.phrase) return "The confirmation phrase does not match"
        return null
    }
}
