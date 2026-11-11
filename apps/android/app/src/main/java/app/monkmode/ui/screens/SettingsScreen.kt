package app.monkmode.ui.screens

import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.monkmode.Monk
import app.monkmode.core.BackupCrypto
import app.monkmode.data.PomodoroConfig
import app.monkmode.ui.MonkCard
import app.monkmode.ui.rememberActions
import app.monkmode.ui.rememberData
import app.monkmode.ui.theme.ACCENTS
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private data class SettingsData(
    val mode: String, val accent: String, val pomodoro: PomodoroConfig, val dailyTarget: Int, val guardAlwaysOn: Boolean,
    val strictLimit: Int, val cooldown: Int,
)

private val CAPABILITIES = listOf(
    Triple("Focus timer & restart recovery", "Supported", "Timestamps in SQLite, foreground service, boot receiver. Battery savers can delay alerts; the time stays exact."),
    Triple("App usage statistics", "Needs permission", "Usage access (UsageStatsManager)."),
    Triple("Block apps with a shield", "Needs permission", "Usage access + Display over other apps. A blocked app may show for up to ~1 s."),
    Triple("Accessibility-service blocking", "Not used", "Deliberately avoided to respect Google Play policy."),
    Triple("Website blocking", "Not supported", "Android browsers have no extension support (except Firefox). Block the browser app instead."),
    Triple("Feeds inside apps (Reels, Shorts)", "Not supported", "No supported API. Block the whole app."),
    Triple("Restore after reboot", "Supported", "Starts after the phone is unlocked once."),
)

@Composable
fun SettingsScreen(onBack: () -> Unit) {
    val actions = rememberActions()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val s by rememberData<SettingsData?>(null) { m ->
        SettingsData(m.repo.string("themeMode", "system"), m.repo.string("accent", "saffron"), m.repo.pomodoro, m.repo.int("dailyTargetMin", 120),
            m.repo.flag("guardEnabled", true), m.repo.int("strictDailyLimitMin", 480), m.repo.int("emergencyCooldownSec", 300))
    }
    var passphrase by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var wipe by remember { mutableStateOf(false) }
    val version = remember { runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "?" }

    fun toast(msg: String) = Toast.makeText(context, msg, Toast.LENGTH_LONG).show()

    val createDoc = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val pass = passphrase
        busy = true
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val bytes = Monk.get(context).backup.exportEncrypted(pass, version)
                    context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("Could not write the file")
                }
            }
            busy = false
            toast(result.exceptionOrNull()?.message ?: "Encrypted backup saved")
        }
    }
    val openDoc = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val pass = passphrase
        busy = true
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error("Could not read the file")
                    require(bytes.size < 512 * 1024 * 1024) { "Backup file is too large" }
                    val monk = Monk.get(context)
                    require(monk.strict.active()?.let { it.level == "normal" } ?: true) { "Restore is unavailable during a strict session." }
                    monk.backup.restore(bytes, pass)
                }
            }
            busy = false
            toast(result.exceptionOrNull()?.message ?: "Restored ${result.getOrNull()?.rows} records from ${result.getOrNull()?.sourcePlatform}")
        }
    }

    Screen("Settings") {
        item { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back") } }
        val x = s ?: return@Screen
        item {
            MonkCard(title = "Appearance") {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("system" to "System", "dark" to "Dark", "light" to "Light").forEach { (k, l) -> Chip(l, x.mode == k) { actions.run { repo.putString("themeMode", k) } } }
                }
                Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ACCENTS.forEach { a ->
                        Box(
                            Modifier.size(32.dp).clip(CircleShape).background(a.dark)
                                .border(2.dp, if (x.accent == a.id) MaterialTheme.colorScheme.onBackground else MaterialTheme.colorScheme.background, CircleShape)
                                .clickable { actions.run { repo.putString("accent", a.id) } },
                        )
                    }
                }
            }
        }
        item {
            MonkCard(title = "Focus") {
                NumberRow("Focus length (min)", x.pomodoro.focusMin, 1..600) { v -> actions.run { repo.pomodoro = repo.pomodoro.copy(focusMin = v) } }
                NumberRow("Short break (min)", x.pomodoro.shortBreakMin, 1..120) { v -> actions.run { repo.pomodoro = repo.pomodoro.copy(shortBreakMin = v) } }
                NumberRow("Long break (min)", x.pomodoro.longBreakMin, 1..180) { v -> actions.run { repo.pomodoro = repo.pomodoro.copy(longBreakMin = v) } }
                NumberRow("Long break every (rounds)", x.pomodoro.longBreakEvery, 1..12) { v -> actions.run { repo.pomodoro = repo.pomodoro.copy(longBreakEvery = v) } }
                ToggleRow("Start breaks automatically", x.pomodoro.autoStartBreaks) { v -> actions.run { repo.pomodoro = repo.pomodoro.copy(autoStartBreaks = v) } }
                ToggleRow("Start next focus automatically (only if you are here)", x.pomodoro.autoStartFocus) { v -> actions.run { repo.pomodoro = repo.pomodoro.copy(autoStartFocus = v) } }
                NumberRow("Daily focus target (min)", x.dailyTarget, 0..1440) { v -> actions.run { repo.putInt("dailyTargetMin", v) } }
            }
        }
        item {
            MonkCard(title = "Monk Guard") {
                ToggleRow("Keep Monk Guard running so schedules start on time", x.guardAlwaysOn) { v -> actions.run { repo.putFlag("guardEnabled", v) } }
                NumberRow("Daily strict-mode limit (min, 0 = none)", x.strictLimit, 0..1440) { v -> actions.run { requireNoStrict(); repo.putInt("strictDailyLimitMin", v) } }
                NumberRow("Maximum-level exit cool-down (sec)", x.cooldown, 60..1800) { v -> actions.run { requireNoStrict(); repo.putInt("emergencyCooldownSec", v) } }
            }
        }
        item {
            MonkCard(title = "Backup & transfer") {
                Text("Encrypted backups (AES-256-GCM) move everything between Android, macOS and Windows. The passphrase is never saved — if you lose it, the backup cannot be opened.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(passphrase, { passphrase = it }, label = { Text("Passphrase (8+ characters)") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = !busy && passphrase.length >= BackupCrypto.MIN_PASSPHRASE, onClick = { createDoc.launch("monk-mode-${today()}.monkbak") }) { Text(if (busy) "Working…" else "Create backup") }
                    OutlinedButton(enabled = !busy && passphrase.length >= BackupCrypto.MIN_PASSPHRASE, onClick = { openDoc.launch(arrayOf("*/*")) }) { Text("Restore") }
                }
                Text("Restoring replaces all data on this phone.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        item {
            MonkCard(title = "Privacy") {
                Text("Everything stays in MONK MODE's private storage on this phone. No account, no internet permission, no analytics, and Android cloud backup is turned off for this app.", style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { wipe = true }) { Text("Delete all data…", color = MaterialTheme.colorScheme.error) }
            }
        }
        item {
            MonkCard(title = "What this phone can enforce") {
                CAPABILITIES.forEachIndexed { i, (name, status, how) ->
                    if (i > 0) HorizontalDivider(Modifier.padding(vertical = 6.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                        Text(status, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                    }
                    Text(how, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        item {
            MonkCard(title = "About") {
                Text("MONK MODE $version · MIT licence", style = MaterialTheme.typography.bodyMedium)
                Text("Built with Kotlin, Jetpack Compose and SQLite. Source and documentation: docs/ folder of the project.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }

    if (wipe) {
        var typed by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { wipe = false },
            title = { Text("Delete all data?") },
            text = {
                Column {
                    Text("Removes every session, task, list and setting from this phone. This cannot be undone. Type DELETE to confirm.")
                    OutlinedTextField(typed, { typed = it }, singleLine = true)
                }
            },
            confirmButton = {
                TextButton(enabled = typed == "DELETE", onClick = {
                    actions.run("Local data deleted") { requireNoStrict(); backup.wipe() }
                    wipe = false
                }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { wipe = false }) { Text("Cancel") } },
        )
    }
}

private fun Monk.requireNoStrict() {
    if (strict.active()?.let { it.level != "normal" } == true) {
        strict.record(strict.active()?.id, "blocked_edit", "Tried to change a protected setting")
        throw IllegalStateException("This is locked while a strict session is active.")
    }
}

@Composable
private fun NumberRow(label: String, value: Int, range: IntRange, onCommit: (Int) -> Unit) {
    var text by remember(value) { mutableStateOf(value.toString()) }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        OutlinedTextField(text, { text = it.filter(Char::isDigit).take(4) }, singleLine = true, modifier = Modifier.size(width = 88.dp, height = 56.dp), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
        TextButton(enabled = text.toIntOrNull()?.let { it in range && it != value } == true, onClick = { text.toIntOrNull()?.let(onCommit) }) { Text("Set") }
    }
}

@Composable
private fun ToggleRow(label: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Switch(value, onChange)
    }
}
