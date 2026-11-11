package app.monkmode.guard

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import app.monkmode.Monk

/** Restores Monk Guard after a reboot or app update. Timers are timestamp-based, so they resume exactly. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val pending = goAsync()
        Thread {
            try {
                val monk = Monk.get(context)
                monk.focus.tick()
                monk.strict.tick()
                GuardService.startIfNeeded(context)
            } finally {
                pending.finish()
            }
        }.start()
    }
}
