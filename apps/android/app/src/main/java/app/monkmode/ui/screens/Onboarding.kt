package app.monkmode.ui.screens

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.monkmode.ui.LogoMark
import app.monkmode.ui.MonkCard
import app.monkmode.ui.Perm
import app.monkmode.ui.Permissions
import app.monkmode.ui.rememberActions
import app.monkmode.ui.rememberNow

/** First run: what MONK MODE is, then each permission explained in plain words before asking. */
@Composable
fun Onboarding() {
    val actions = rememberActions()
    val context = LocalContext.current
    var step by rememberSaveable { mutableIntStateOf(0) }
    val now = rememberNow(2000)
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.safeDrawingPadding().padding(24.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (step == 0) {
                Spacer(Modifier.height(48.dp))
                LogoMark(Modifier.size(72.dp).align(Alignment.CenterHorizontally))
                Text("MONK MODE", fontSize = 30.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 4.sp, modifier = Modifier.align(Alignment.CenterHorizontally))
                Text("Discipline is a system.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.align(Alignment.CenterHorizontally))
                Spacer(Modifier.height(12.dp))
                MonkCard { Text("A focus timer, app blocker and planner that lives only on this phone. No account, no cloud, no ads, no tracking. MONK MODE does not even have permission to use the internet.") }
                MonkCard { Text("Blocking is a commitment you choose, not a lock. You can always stop it, and every stricter setting just asks you to pause and think first.") }
                Button(onClick = { step = 1 }, modifier = Modifier.fillMaxWidth()) { Text("Continue") }
            } else {
                Text("Permissions", style = MaterialTheme.typography.headlineMedium)
                Text("Each one is optional. Grant them in system settings; MONK MODE never turns anything on by itself.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                Perm.entries.forEach { p ->
                    val granted = remember(now) { Permissions.granted(context, p) }
                    MonkCard(title = if (granted) "${p.title} · allowed" else p.title) {
                        Text(p.why, style = MaterialTheme.typography.bodySmall)
                        if (!granted) OutlinedButton(onClick = {
                            if (p == Perm.NOTIFICATIONS && Build.VERSION.SDK_INT >= 33) notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                            else runCatching { context.startActivity(Permissions.settingsIntent(context, p)) }
                        }) { Text("Allow") }
                    }
                }
                Button(onClick = { actions.run { repo.putFlag("onboardingComplete", true) } }, modifier = Modifier.fillMaxWidth()) { Text("Begin") }
                TextButton(onClick = { step = 0 }) { Text("Back") }
            }
        }
    }
}
