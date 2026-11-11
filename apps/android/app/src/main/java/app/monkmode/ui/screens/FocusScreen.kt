package app.monkmode.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.monkmode.core.FocusMath
import app.monkmode.data.PomodoroConfig
import app.monkmode.data.Session
import app.monkmode.data.Subject
import app.monkmode.guard.GuardService
import app.monkmode.ui.MonkCard
import app.monkmode.ui.Ring
import app.monkmode.ui.rememberActions
import app.monkmode.ui.rememberData
import app.monkmode.ui.rememberNow

private data class FocusData(val session: Session?, val cfg: PomodoroConfig, val subjects: List<Subject>, val strictOn: Boolean)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FocusScreen(onSettings: () -> Unit) {
    val actions = rememberActions()
    val context = LocalContext.current
    val data by rememberData(FocusData(null, PomodoroConfig(), emptyList(), false)) { FocusData(it.focus.active(), it.repo.pomodoro, it.repo.subjects().filterNot(Subject::archived), it.strict.active() != null) }
    val s = data.session
    val now = rememberNow(if (s?.status == "running") 250 else 2000)
    var mode by rememberSaveable { mutableStateOf("pomodoro") }
    var minutes by rememberSaveable { mutableStateOf("25") }
    var subjectId by rememberSaveable { mutableStateOf<String?>(null) }
    var note by rememberSaveable { mutableStateOf("") }

    // The engine completes due phases; poll it promptly when the display reaches zero.
    if (s != null && s.plannedMs != null && s.status == "running" && (FocusMath.remainingMs(s.timing, now) ?: 1) == 0L) {
        actions.run { focus.tick() }
    }

    Screen("Focus", "The timer keeps exact time even if the app is closed.", onSettings) {
        item {
            MonkCard {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    if (s == null) {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            FocusMath.MODES.forEach { m ->
                                Chip(FocusMath.MODE_LABELS[m] ?: m, mode == m) {
                                    mode = m
                                    minutes = FocusMath.defaultMinutes(m, data.cfg.focusMin, data.cfg.shortBreakMin)?.toString() ?: ""
                                }
                            }
                        }
                    } else {
                        Text(listOfNotNull(if (s.isBreak) "Break" else FocusMath.MODE_LABELS[s.mode], if (s.mode == "pomodoro" && s.cycleIndex > 0) "Round ${s.cycleIndex} of ${data.cfg.longBreakEvery}" else null, if (s.status == "paused") "Paused" else null).joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                    }
                    Spacer(Modifier.height(20.dp))
                    val remaining = s?.let { FocusMath.remainingMs(it.timing, now) }
                    val elapsed = s?.let { FocusMath.elapsedMs(it.timing, now) } ?: 0
                    val display = s?.let { remaining ?: elapsed } ?: ((minutes.toLongOrNull() ?: 0) * 60_000)
                    val progress = s?.plannedMs?.let { elapsed.toFloat() / it } ?: if (s != null) (elapsed % 3_600_000) / 3_600_000f else 0f
                    Ring(progress, 260.dp, muted = s?.isBreak == true || s?.status == "paused") {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(FocusMath.format(display, seconds = true), style = MaterialTheme.typography.displayLarge)
                            Text(if (s == null) "ready" else if (s.plannedMs != null) "remaining" else "elapsed", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Spacer(Modifier.height(20.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (s == null) {
                            Button(onClick = {
                                actions.run {
                                    focus.start(mode, if (mode == "stopwatch") null else minutes.toIntOrNull(), subjectId, note, strict.active() != null)
                                    GuardService.start(context)
                                }
                            }) { Text("Start") }
                        } else {
                            if (s.status == "running") OutlinedButton(onClick = { actions.run { focus.pause() } }) { Text("Pause") }
                            else Button(onClick = { actions.run { focus.resume() } }) { Text("Resume") }
                            if (s.isBreak) OutlinedButton(onClick = { actions.run { focus.skipBreak() } }) { Text("Skip break") }
                            OutlinedButton(onClick = { actions.run("Session saved") { focus.end() } }) { Text("End") }
                            TextButton(onClick = { actions.run { focus.reset() } }) { Text("Reset") }
                        }
                    }
                }
            }
        }
        if (s == null) item {
            MonkCard(title = "Session setup") {
                if (mode != "stopwatch") {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { FocusMath.PRESETS.forEach { p -> Chip("$p", minutes == "$p") { minutes = "$p" } } }
                    OutlinedTextField(minutes, { minutes = it.filter(Char::isDigit).take(3) }, label = { Text("Minutes (1–600)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                }
                if (data.subjects.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Text("Subject", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Chip("None", subjectId == null) { subjectId = null }
                        data.subjects.forEach { sub -> Chip(sub.name, subjectId == sub.id) { subjectId = sub.id } }
                    }
                }
                OutlinedTextField(note, { note = it.take(2000) }, label = { Text("Intention") }, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}
