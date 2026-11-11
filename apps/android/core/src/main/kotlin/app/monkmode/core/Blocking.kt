package app.monkmode.core

import java.time.LocalDateTime

data class ListRow(
    val id: String, val kind: String, val enabled: Boolean, val blockDuringFocus: Boolean,
    val mode: String = "block", val pauseSeconds: Int = 10, val pauseAllowMin: Int = 5,
)

/** Mindful-pause settings for one list: breathing countdown seconds, minutes allowed after continuing. */
data class PauseCfg(val seconds: Int, val allowMin: Int)
data class RuleRow(val listId: String, val type: String, val value: String, val platform: String)
data class ScheduleRow(val listId: String, val daysMask: Int, val startMinute: Int, val endMinute: Int, val strict: Boolean, val enabled: Boolean)

data class ActiveApps(
    val packages: Set<String>,
    val triggers: Set<String>,
    val strictPackages: Set<String>,
    val triggerFor: Map<String, String>,
    val listFor: Map<String, String>,
    /** Active, non-strict lists in Mindful-pause mode (list id → settings). */
    val pauseLists: Map<String, PauseCfg> = emptyMap(),
) {
    val active get() = packages.isNotEmpty()

    /** Pause settings for a blocked package, or null when it must be hard-blocked. */
    fun pauseFor(pkg: String): PauseCfg? = listFor[pkg]?.let { pauseLists[it] }
    val strict get() = strictPackages.isNotEmpty()
}

/**
 * Android counterpart of shared-core resolveActiveBlockSet, limited to application packages
 * (Android cannot block websites without a browser extension).
 */
object BlockResolver {
    fun resolve(
        at: LocalDateTime,
        nowMs: Long,
        lists: List<ListRow>,
        rules: List<RuleRow>,
        schedules: List<ScheduleRow>,
        quickBlockLists: Set<String>,
        focusActive: Boolean,
        strictLists: Set<String>,
        exceptions: Set<String>,
        limitExceeded: Set<String>,
    ): ActiveApps {
        val enabled = lists.filter { it.enabled && it.kind == "block" }
        val enabledIds = enabled.map { it.id }.toSet()
        val triggers = mutableMapOf<String, MutableSet<String>>()
        fun add(list: String, t: String) = triggers.getOrPut(list) { mutableSetOf() }.add(t)
        if (focusActive) enabled.filter { it.blockDuringFocus }.forEach { add(it.id, "focus") }
        schedules.filter { it.enabled && it.listId in enabledIds && Schedules.isWindowActive(it.daysMask, it.startMinute, it.endMinute, at) }
            .forEach { add(it.listId, if (it.strict) "strict" else "schedule") }
        quickBlockLists.filter { it in enabledIds }.forEach { add(it, "manual") }
        strictLists.filter { id -> lists.any { it.id == id } }.forEach { add(it, "strict") }

        val packages = linkedSetOf<String>()
        val strictPkgs = mutableSetOf<String>()
        val triggerFor = mutableMapOf<String, String>()
        val listFor = mutableMapOf<String, String>()
        val pauseLists = mutableMapOf<String, PauseCfg>()
        for ((listId, ts) in triggers) {
            val primary = if ("strict" in ts) "strict" else ts.first()
            // A commitment always hard-blocks; Mindful pause only applies outside strict enforcement.
            lists.firstOrNull { it.id == listId }?.takeIf { it.mode == "pause" && primary != "strict" }?.let {
                pauseLists[listId] = PauseCfg(it.pauseSeconds.coerceIn(3, 60), it.pauseAllowMin.coerceIn(1, 30))
            }
            rules.filter { it.listId == listId && it.type == "app" && (it.platform == "all" || it.platform == "android") && Matching.isPackageName(it.value) }
                .forEach {
                    packages += it.value
                    triggerFor.putIfAbsent(it.value, primary)
                    listFor.putIfAbsent(it.value, listId)
                    if (primary == "strict") strictPkgs += it.value
                }
        }
        val allTriggers = triggers.values.flatten().toMutableSet()
        limitExceeded.forEach {
            packages += it
            triggerFor.putIfAbsent(it, "limit")
            allTriggers += "limit"
        }
        val allowed = lists.filter { it.enabled && it.kind == "allow" }.map { it.id }.toSet()
        val allowPkgs = rules.filter { it.listId in allowed && it.type == "app" }.map { it.value }.toSet() + exceptions.filter { it !in strictPkgs }
        packages.removeAll(allowPkgs)
        packages.removeAll(Matching.PROTECTED_PACKAGES)
        return ActiveApps(packages, allTriggers, strictPkgs, triggerFor, listFor, pauseLists)
    }
}
