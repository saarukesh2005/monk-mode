package app.monkmode.guard

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import app.monkmode.MainActivity
import app.monkmode.R
import app.monkmode.data.MonkDatabase
import app.monkmode.data.Repo
import app.monkmode.data.values

object Notifications {
    const val CHANNEL_GUARD = "guard"
    const val CHANNEL_ALERTS = "alerts"
    const val GUARD_ID = 1

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL_GUARD, "Focus timer & Monk Guard", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Ongoing notification while a focus timer or blocks are active."
            setShowBadge(false)
        })
        nm.createNotificationChannel(NotificationChannel(CHANNEL_ALERTS, "Session alerts", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "When a focus session or break ends, or a commitment finishes."
        })
    }

    private fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(
        context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** Ongoing notification; a countdown chronometer stays exact without frequent updates. */
    fun guard(context: Context, title: String, text: String, countdownTo: Long?): Notification {
        val b = Notification.Builder(context, CHANNEL_GUARD)
            .setSmallIcon(R.drawable.ic_stat_monk)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openApp(context))
            .setCategory(Notification.CATEGORY_PROGRESS)
        if (countdownTo != null) {
            b.setUsesChronometer(true).setWhen(countdownTo).setShowWhen(true)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) b.setChronometerCountDown(true)
        }
        return b.build()
    }

    fun alert(context: Context, kind: String, title: String, body: String) {
        Repo.get(context).db.insert("notifications", null, values("id" to MonkDatabase.newId(), "ts" to Repo.now(), "kind" to kind, "title" to title, "body" to body))
        val n = Notification.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_monk)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(openApp(context))
            .build()
        runCatching { context.getSystemService(NotificationManager::class.java).notify((Repo.now() % 100_000).toInt() + 10, n) }
    }
}
