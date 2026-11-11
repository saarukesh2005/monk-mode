package app.monkmode.engine

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Process
import app.monkmode.data.MonkDatabase
import app.monkmode.data.Repo
import app.monkmode.data.tx
import app.monkmode.data.values

/** Reads measured foreground usage from UsageStatsManager (requires the user-granted Usage access). */
class UsageImporter(private val context: Context, private val repo: Repo) {
    private val usm = context.getSystemService(UsageStatsManager::class.java)

    fun hasAccess(): Boolean {
        val ops = context.getSystemService(AppOpsManager::class.java)
        @Suppress("DEPRECATION")
        val mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        return mode == AppOpsManager.MODE_ALLOWED
    }

    /** Package currently in the foreground, from the latest resume event (last ~15 minutes). */
    fun foregroundPackage(now: Long = System.currentTimeMillis()): String? {
        if (!hasAccess()) return null
        val events = usm.queryEvents(now - 15 * 60_000, now)
        val e = UsageEvents.Event()
        var current: String? = null
        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            when (e.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> current = e.packageName
                UsageEvents.Event.ACTIVITY_PAUSED -> if (e.packageName == current) current = null
            }
        }
        return current
    }

    private fun label(pkg: String): String = runCatching {
        val pm = context.packageManager
        @Suppress("DEPRECATION")
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    }.getOrDefault(pkg)

    /** Imports resumed→paused intervals since the last import. Idempotent via the stored watermark. */
    fun import(now: Long = System.currentTimeMillis()): Int {
        if (!hasAccess()) return 0
        val since = maxOf(repo.setting("usageImportedUntil")?.toLongOrNull() ?: 0L, now - 7L * 24 * 3600_000)
        // Intervals that ended before the previous import were already stored.
        val lastImport = repo.setting("usageLastImportAt")?.toLongOrNull() ?: 0L
        val events = usm.queryEvents(since, now)
        val e = UsageEvents.Event()
        val open = mutableMapOf<String, Long>()
        val intervals = mutableListOf<Triple<String, Long, Long>>()
        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            if (e.packageName == context.packageName) continue
            when (e.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> open[e.packageName] = e.timeStamp
                UsageEvents.Event.ACTIVITY_PAUSED, UsageEvents.Event.ACTIVITY_STOPPED -> open.remove(e.packageName)?.let { start ->
                    if (e.timeStamp > start && e.timeStamp > lastImport) intervals += Triple(e.packageName, start, e.timeStamp)
                }
            }
        }
        // Still-open intervals are imported next time, so the watermark stops at the earliest one.
        val watermark = open.values.minOrNull() ?: now
        val labels = mutableMapOf<String, String>()
        repo.db.tx {
            intervals.forEach { (pkg, s, end) ->
                insert("app_usage", null, values("id" to MonkDatabase.newId(), "app_id" to pkg, "app_name" to labels.getOrPut(pkg) { label(pkg) }, "started_at" to s, "ended_at" to end, "duration_ms" to end - s, "platform" to "android", "source" to "usage_stats"))
            }
        }
        repo.putSetting("usageImportedUntil", watermark.toString())
        repo.putSetting("usageLastImportAt", now.toString())
        return intervals.size
    }
}
