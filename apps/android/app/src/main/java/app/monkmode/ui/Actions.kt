package app.monkmode.ui

import android.content.Context
import android.widget.Toast
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import app.monkmode.Monk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Runs a database/engine action off the main thread and shows a user-facing message on failure. */
class Actions(private val context: Context, private val launch: (suspend () -> Unit) -> Unit) {
    val monk: Monk get() = Monk.get(context)

    fun run(success: String? = null, block: Monk.() -> Unit) = launch {
        val error = withContext(Dispatchers.IO) { runCatching { monk.block() }.exceptionOrNull() }
        val msg = error?.message ?: success
        if (msg != null) Toast.makeText(context, msg, if (error != null) Toast.LENGTH_LONG else Toast.LENGTH_SHORT).show()
    }
}

@Composable
fun rememberActions(): Actions {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    return Actions(context) { block -> scope.launch { block() } }
}
