package app.monkmode.guard

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import app.monkmode.Monk
import app.monkmode.core.FocusMath
import app.monkmode.data.Repo
import app.monkmode.engine.FocusEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Monk Guard foreground service. Advances the focus/strict engines, detects the foreground app via
 * UsageStatsManager and shows the shield over blocked apps. Polls every ~0.8 s while blocking,
 * slower otherwise. It stops itself when nothing needs watching and always-on guard is off.
 */
class GuardService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var loop: Job? = null
    private val lastShield = mutableMapOf<String, Long>()
    private var lastImport = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val n = Notifications.guard(this, "Monk Guard", "Starting…", null)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(Notifications.GUARD_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(Notifications.GUARD_ID, n)
        }
        if (loop?.isActive != true) loop = scope.launch { run() }
        return START_STICKY
    }

    private suspend fun run() {
        val monk = Monk.get(this)
        while (scope.isActive) {
            val keepGoing = runCatching { step(monk) }.onFailure { Log.w(TAG, "guard step failed", it) }.getOrDefault(POLL_IDLE_MS)
            if (keepGoing < 0) {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return
            }
            delay(keepGoing)
        }
    }

    /** One supervision step. Returns the delay until the next step, or -1 to stop. */
    private fun step(monk: Monk): Long {
        val now = Repo.now()
        for (ev in monk.focus.tick(now)) if (ev is FocusEvent.Completed) {
            val s = ev.session
            if (s.phase == "focus") Notifications.alert(this, "focus", "Focus session complete", "${s.focusedMs / 60_000} minutes of focused work. Take a breath.")
            else Notifications.alert(this, "focus", "Break is over", "Ready for the next focus session?")
        }
        when (monk.strict.tick(now)) {
            "completed" -> Notifications.alert(this, "strict", "Commitment complete", "Your strict session finished. Well done.")
            "exited" -> Notifications.alert(this, "strict", "Strict session ended early", "Emergency exit completed. Restrictions are lifted.")
        }
        if (now - lastImport > IMPORT_EVERY_MS) {
            runCatching { monk.usage.import(now) }
            lastImport = now
        }

        val blocks = monk.resolver.resolve(now)
        val session = monk.focus.active()
        if (blocks.active) {
            val fg = monk.usage.foregroundPackage(now)
            if (fg != null && fg != packageName && fg in blocks.packages) shield(monk, fg, blocks.triggerFor[fg] ?: "manual", blocks.listFor[fg], blocks.strict, now)
        }

        val nm = getSystemService(android.app.NotificationManager::class.java)
        val notification = when {
            session != null -> {
                val label = if (session.phase == "focus") "Focusing · ${FocusMath.MODE_LABELS[session.mode]}" else "On a break"
                val due = FocusMath.dueAt(session.timing)
                val text = when {
                    session.status == "paused" -> "Paused"
                    blocks.active -> "${blocks.packages.size} apps blocked"
                    due == null -> "Stopwatch running"
                    else -> "Ends at ${java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(due)}"
                }
                Notifications.guard(this, label, text, if (session.status == "running") due else null)
            }
            blocks.active -> Notifications.guard(this, if (blocks.strict) "Strict commitment active" else "Monk Guard is on", "${blocks.packages.size} apps blocked · ${blocks.triggers.joinToString()}", monk.strict.active()?.endsAt)
            else -> Notifications.guard(this, "Monk Guard standing by", "Blocks start with focus sessions and schedules.", null)
        }
        nm.notify(Notifications.GUARD_ID, notification)

        val alwaysOn = monk.repo.flag("guardEnabled", true)
        return when {
            blocks.active -> POLL_BLOCKING_MS
            session != null -> POLL_FOCUS_MS
            alwaysOn -> POLL_IDLE_MS
            else -> -1
        }
    }

    private fun shield(monk: Monk, pkg: String, trigger: String, listId: String?, strict: Boolean, now: Long) {
        val label = runCatching { @Suppress("DEPRECATION") packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString() }.getOrDefault(pkg)
        if (now - (lastShield[pkg] ?: 0) > EVENT_DEBOUNCE_MS) monk.repo.recordBlock(label, listId, trigger)
        lastShield[pkg] = now
        if (!Settings.canDrawOverlays(this)) {
            // Without "Display over other apps" Android blocks background activity starts; notify instead.
            Notifications.alert(this, "block", "$label is blocked right now", "Allow “Display over other apps” for MONK MODE to show the block screen automatically.")
            return
        }
        startActivity(
            Intent(this, BlockActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NO_ANIMATION)
                .putExtra(BlockActivity.EXTRA_PACKAGE, pkg)
                .putExtra(BlockActivity.EXTRA_LABEL, label)
                .putExtra(BlockActivity.EXTRA_STRICT, strict),
        )
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "MonkGuard"
        private const val POLL_BLOCKING_MS = 800L
        private const val POLL_FOCUS_MS = 5_000L
        private const val POLL_IDLE_MS = 20_000L
        private const val IMPORT_EVERY_MS = 15 * 60_000L
        private const val EVENT_DEBOUNCE_MS = 30_000L

        fun start(context: Context) {
            runCatching { ContextCompat.startForegroundService(context, Intent(context, GuardService::class.java)) }
                .onFailure { Log.w(TAG, "could not start guard", it) }
        }

        /** Starts the guard if always-on is enabled or something currently needs supervision. */
        fun startIfNeeded(context: Context) {
            val monk = Monk.get(context)
            if (monk.repo.flag("guardEnabled", true) || monk.focus.active() != null || monk.resolver.needsWatching()) start(context)
        }
    }
}
