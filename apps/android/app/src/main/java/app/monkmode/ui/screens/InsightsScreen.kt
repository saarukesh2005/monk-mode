package app.monkmode.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.monkmode.core.Analytics
import app.monkmode.core.FocusMath
import app.monkmode.data.BlockEvent
import app.monkmode.data.Session
import app.monkmode.data.StrictEvent
import app.monkmode.data.UsageTotal
import app.monkmode.ui.MonkCard
import app.monkmode.ui.ProgressBar
import app.monkmode.ui.Stat
import app.monkmode.ui.WeekBars
import app.monkmode.ui.rememberActions
import app.monkmode.ui.rememberData
import java.text.DateFormat
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

private data class Insights(
    val sessions: List<Session>, val byDay: Map<LocalDate, Long>, val topApps: List<UsageTotal>, val screenMs: Long,
    val usageAccess: Boolean, val blocks: List<BlockEvent>, val strictEvents: List<StrictEvent>, val target: Int,
)

private enum class Range(val label: String, val days: Long) { TODAY("Today", 1), WEEK("7 days", 7), MONTH("30 days", 30) }

@Composable
fun InsightsScreen(onSettings: () -> Unit) {
    val actions = rememberActions()
    var range by rememberSaveable { mutableStateOf(Range.WEEK) }
    var history by rememberSaveable { mutableStateOf(false) }
    val d = today()
    val from = d.minusDays(range.days - 1)
    // Usage is imported when the app opens and by Monk Guard; importing here would bump the data
    // version and reload this loader in a loop.
    val data by rememberData<Insights?>(null, range, d) { m ->
        val all = m.repo.sessionsSince(startOfDayMs(d.minusDays(400)))
        Insights(
            all, focusByDay(all), m.repo.topApps(startOfDayMs(from)), m.repo.screenTimeMs(startOfDayMs(from)), m.usage.hasAccess(),
            m.repo.blockEvents(500), m.repo.strictEvents(100), m.repo.int("dailyTargetMin", 120),
        )
    }
    Screen("Insights", "Computed on this phone from data it recorded.", onSettings) {
        item { Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { Range.entries.forEach { r -> Chip(r.label, range == r) { range = r } } } }
        val x = data ?: return@Screen
        val inRange = x.sessions.filter { it.phase == "focus" && it.startedAt >= startOfDayMs(from) && (it.status == "completed" || it.status == "interrupted") }
        val focusMs = (0 until range.days).sumOf { x.byDay[from.plusDays(it)] ?: 0L }
        val completed = inRange.count { it.status == "completed" }
        val (streak, best) = Analytics.streak(x.byDay, d)
        item {
            MonkCard(title = "Focus · recorded") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Stat("Focus time", FocusMath.format(focusMs), accent = true)
                    Stat("Sessions", "${inRange.size}", if (inRange.isEmpty()) "no data yet" else "${completed * 100 / inRange.size}% completed")
                    Stat("Streak", "$streak d", "best $best")
                }
                Spacer(Modifier.height(10.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Stat("Longest", FocusMath.format(inRange.maxOfOrNull { it.focusedMs } ?: 0))
                    Stat("Average", if (inRange.isEmpty()) "—" else FocusMath.format(inRange.sumOf { it.focusedMs } / inRange.size))
                    Stat("Daily target", "${x.target}m")
                }
                if (range != Range.TODAY) {
                    Spacer(Modifier.height(14.dp))
                    val days = (0 until minOf(range.days, 14)).map { d.minusDays(minOf(range.days, 14) - 1 - it) }
                    WeekBars(days.map { (if (range == Range.WEEK) it.dayOfWeek.getDisplayName(TextStyle.NARROW, Locale.getDefault()) else "${it.dayOfMonth}") to (x.byDay[it] ?: 0) })
                }
            }
        }
        item {
            MonkCard(title = "Screen time · measured") {
                if (!x.usageAccess) {
                    Text("Grant Usage access (Guard tab) to see how you use your phone. Nothing is estimated.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else if (x.topApps.isEmpty()) {
                    Text("No usage recorded yet for this period.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    Stat("Total", FocusMath.format(x.screenMs))
                    Spacer(Modifier.height(8.dp))
                    val max = x.topApps.maxOf { it.ms }.coerceAtLeast(1)
                    x.topApps.forEach { a ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(a.label, style = MaterialTheme.typography.bodyMedium)
                            Text(FocusMath.format(a.ms), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        ProgressBar(a.ms.toFloat() / max, Modifier.padding(bottom = 8.dp))
                    }
                }
            }
        }
        item {
            val blocked = x.blocks.filter { it.ts >= startOfDayMs(from) }
            MonkCard(title = "Blocked attempts · measured") {
                Text("${blocked.size}", style = MaterialTheme.typography.headlineMedium)
                blocked.groupingBy { it.target }.eachCount().entries.sortedByDescending { it.value }.take(5).forEach { (t, n) ->
                    Text("$t · $n×", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        item {
            MonkCard(title = "History", action = { TextButton(onClick = { history = !history }) { Text(if (history) "Hide" else "Show") } }) {
                if (!history) {
                    Text("${x.sessions.size} sessions, ${x.blocks.size} blocks and ${x.strictEvents.size} strict-mode events stored on this phone.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    val fmt = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
                    x.sessions.take(40).forEach { s ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("${fmt.format(s.startedAt)} · ${if (s.isBreak) "Break" else FocusMath.MODE_LABELS[s.mode]}", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                            Text("${FocusMath.format(s.focusedMs)} · ${s.status}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (s.status != "running" && s.status != "paused") TextButton(onClick = { actions.run { repo.deleteSession(s.id) } }) { Text("Delete") }
                        }
                    }
                    if (x.strictEvents.isNotEmpty()) {
                        Spacer(Modifier.height(10.dp))
                        Text("Strict mode", style = MaterialTheme.typography.titleMedium)
                        x.strictEvents.take(30).forEach { e -> Text("${fmt.format(e.ts)} · ${e.kind.replace('_', ' ')} ${e.detail}", style = MaterialTheme.typography.bodySmall) }
                    }
                }
            }
        }
    }
}
