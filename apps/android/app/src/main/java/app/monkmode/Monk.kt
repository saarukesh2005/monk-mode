package app.monkmode

import android.content.Context
import app.monkmode.data.BackupService
import app.monkmode.data.Repo
import app.monkmode.engine.BlockResolver
import app.monkmode.engine.FocusEngine
import app.monkmode.engine.GuardRules
import app.monkmode.engine.StrictEngine
import app.monkmode.engine.UsageImporter

/** Process-wide engine graph (manual DI; no reflection). */
class Monk private constructor(context: Context) {
    val repo = Repo.get(context)
    val focus = FocusEngine(repo)
    val strict = StrictEngine(repo)
    val resolver = BlockResolver(repo, focus, strict)
    val guardRules = GuardRules(repo, strict)
    val usage = UsageImporter(context.applicationContext, repo)
    val backup = BackupService(repo)

    companion object {
        @Volatile private var instance: Monk? = null
        fun get(context: Context): Monk = instance ?: synchronized(this) { instance ?: Monk(context.applicationContext).also { instance = it } }
    }
}
