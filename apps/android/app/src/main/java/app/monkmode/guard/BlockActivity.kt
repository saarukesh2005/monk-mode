package app.monkmode.guard

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.monkmode.MainActivity
import app.monkmode.Monk
import app.monkmode.ui.LogoMark
import app.monkmode.ui.theme.MonkTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Full-screen shield shown over a blocked app. Back always leads home, never into the blocked app. */
class BlockActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pkg = intent.getStringExtra(EXTRA_PACKAGE) ?: ""
        val label = intent.getStringExtra(EXTRA_LABEL) ?: pkg
        val strict = intent.getBooleanExtra(EXTRA_STRICT, false)
        val listId = intent.getStringExtra(EXTRA_LIST)
        val pauseSeconds = intent.getIntExtra(EXTRA_PAUSE_SECONDS, 0)
        val allowMin = intent.getIntExtra(EXTRA_PAUSE_ALLOW_MIN, 5)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = if (pauseSeconds > 0) turnBack(label, listId, "") else goHome()
        })
        setContent {
            MonkTheme {
                if (pauseSeconds > 0) {
                    PauseShield(label, pauseSeconds, allowMin, onBack = { turnBack(label, listId, it) }, onContinue = { continueTo(pkg, label, listId, allowMin, it) })
                } else {
                    Shield(label, strict, onHome = ::goHome, onOpenApp = ::openMonk, onAllow = { allow(pkg) })
                }
            }
        }
    }

    private fun turnBack(label: String, listId: String?, intention: String) {
        Thread { runCatching { Monk.get(this).repo.recordPause(label, listId, "turned_back", intention) } }.start()
        goHome()
    }

    /** Records the choice, grants the short allowance and reopens the app. */
    private suspend fun continueTo(pkg: String, label: String, listId: String?, minutes: Int, intention: String): String? {
        val error = withContext(Dispatchers.IO) {
            runCatching {
                val monk = Monk.get(this@BlockActivity)
                monk.guardRules.grantException(pkg, minutes)
                monk.repo.recordPause(label, listId, "continued", intention)
            }.exceptionOrNull()?.message
        }
        if (error != null) return error
        packageManager.getLaunchIntentForPackage(pkg)?.let(::startActivity)
        finish()
        return null
    }

    private fun goHome() {
        startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }

    private fun openMonk() {
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }

    /** Grants a 5-minute exception (refused during strict sessions) and reopens the app. */
    private suspend fun allow(pkg: String): String? {
        val error = withContext(Dispatchers.IO) {
            runCatching { Monk.get(this@BlockActivity).guardRules.grantException(pkg, 5) }.exceptionOrNull()?.message
        }
        if (error != null) return error
        packageManager.getLaunchIntentForPackage(pkg)?.let(::startActivity)
        finish()
        return null
    }

    companion object {
        const val EXTRA_PACKAGE = "pkg"
        const val EXTRA_LABEL = "label"
        const val EXTRA_STRICT = "strict"
        const val EXTRA_LIST = "list"
        const val EXTRA_PAUSE_SECONDS = "pauseSeconds"
        const val EXTRA_PAUSE_ALLOW_MIN = "pauseAllowMin"
    }
}

private val QUOTES = listOf("The work is the reward.", "What you do now is what you become.", "Small steps, every day.", "Return to the breath. Return to the task.")

@Composable
private fun Shield(label: String, strict: Boolean, onHome: () -> Unit, onOpenApp: () -> Unit, onAllow: suspend () -> String?) {
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    val quote = remember { QUOTES.random() }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            LogoMark(Modifier.size(56.dp))
            Spacer(Modifier.height(24.dp))
            Text("$label is blocked", fontSize = 26.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
            Text(if (strict) "You made a commitment. Stay with it." else "MONK MODE is protecting your focus.", color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            Spacer(Modifier.height(28.dp))
            Text("“$quote”", fontSize = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            Spacer(Modifier.height(32.dp))
            Button(onClick = onHome) { Text("Back to what matters") }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onOpenApp) { Text("Open MONK MODE") }
                if (!strict) OutlinedButton(onClick = { scope.launch { error = onAllow() } }) { Text("Allow 5 min") }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp)) }
        }
    }
}

/** Mindful pause: a breathing countdown and an intention, then a free choice (PNAS 2023 friction design). */
@Composable
private fun PauseShield(label: String, seconds: Int, allowMin: Int, onBack: (String) -> Unit, onContinue: suspend (String) -> String?) {
    val scope = rememberCoroutineScope()
    var remaining by remember { mutableStateOf(seconds) }
    var intention by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    androidx.compose.runtime.LaunchedEffect(Unit) {
        while (remaining > 0) {
            kotlinx.coroutines.delay(1000)
            remaining--
        }
    }
    val breath by rememberInfiniteTransition(label = "breath").animateFloat(
        initialValue = 0.55f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(4000), RepeatMode.Reverse),
        label = "orb",
    )
    val accent = MaterialTheme.colorScheme.primary
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Before you open $label", fontSize = 24.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
            Spacer(Modifier.height(28.dp))
            androidx.compose.foundation.layout.Box(Modifier.size(150.dp), contentAlignment = Alignment.Center) {
                androidx.compose.foundation.Canvas(Modifier.size(150.dp)) {
                    drawCircle(accent.copy(alpha = 0.35f * breath), radius = size.minDimension / 2 * breath)
                }
                Text(if (remaining > 0) "$remaining" else "", fontSize = 36.sp, fontWeight = FontWeight.Light)
            }
            Text(if (remaining > 0) (if ((seconds - remaining) / 4 % 2 == 0) "Breathe in…" else "Breathe out…") else "Your choice.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(20.dp))
            androidx.compose.material3.OutlinedTextField(intention, { intention = it.take(200) }, label = { Text("What do you want to do there?") }, singleLine = true)
            Spacer(Modifier.height(16.dp))
            Button(onClick = { onBack(intention) }) { Text("I'll go back") }
            Spacer(Modifier.height(8.dp))
            OutlinedButton(enabled = remaining <= 0, onClick = { scope.launch { error = onContinue(intention) } }) { Text("Continue for $allowMin min") }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp)) }
        }
    }
}
