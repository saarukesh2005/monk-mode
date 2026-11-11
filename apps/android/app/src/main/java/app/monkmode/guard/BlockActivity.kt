package app.monkmode.guard

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
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
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = goHome()
        })
        setContent { MonkTheme { Shield(label, strict, onHome = ::goHome, onOpenApp = ::openMonk, onAllow = { allow(pkg) }) } }
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
