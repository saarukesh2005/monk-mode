package app.monkmode.core

/** Mirrors packages/shared-core/src/matching.ts (domain normalisation and app matching). */
object Matching {
    private val label = Regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
    private val androidPackage = Regex("^[a-zA-Z][\\w]*(\\.[a-zA-Z][\\w]*)+$")

    fun normalizeDomain(input: String): String? {
        var s = input.trim().lowercase()
        if (s == "*") return s
        s = s.replace(Regex("^[a-z][a-z0-9+.-]*://"), "")
        s = s.split('/', '?', '#').first()
        s = s.substringAfterLast('@').replace(Regex(":\\d+$"), "").trimEnd('.')
        if (s.startsWith("*.")) s = s.removePrefix("*.")
        if (s.startsWith("www.")) s = s.removePrefix("www.")
        if (s.isEmpty() || s.length > 253) return null
        return if (s.split('.').all { label.matches(it) }) s else null
    }

    fun hostMatches(host: String, rule: String): Boolean {
        if (rule == "*") return true
        val h = host.lowercase().trimEnd('.')
        return h == rule || h.endsWith(".$rule")
    }

    fun isPackageName(value: String): Boolean = androidPackage.matches(value)

    /** Packages that are never blocked so the device stays usable. */
    val PROTECTED_PACKAGES = setOf(
        "com.android.systemui", "com.android.settings", "com.android.phone", "com.android.dialer",
        "com.google.android.dialer", "com.android.emergency", "com.google.android.apps.nexuslauncher",
        "com.android.launcher3", "com.sec.android.app.launcher", "com.android.server.telecom",
    )
}
