package app.monkmode

import android.app.Application
import app.monkmode.guard.GuardService
import app.monkmode.guard.Notifications
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class MonkApp : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
        scope.launch {
            val monk = Monk.get(this@MonkApp)
            monk.repo.seedIfNeeded()
            // Catch up on anything that happened while the process was dead (exact, timestamp-based).
            monk.focus.tick()
            monk.strict.tick()
        }
    }

    /** Called from the UI (a foreground context), where starting a foreground service is allowed. */
    fun ensureGuard() = GuardService.startIfNeeded(this)
}
