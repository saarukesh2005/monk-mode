package app.monkmode.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.monkmode.Tab
import app.monkmode.core.Analytics
import app.monkmode.core.FocusMath
import app.monkmode.data.ActiveBlocks
import app.monkmode.ui.MonkCard
import app.monkmode.ui.ProgressBar
import app.monkmode.ui.Stat
import app.monkmode.ui.WeekBars
import app.monkmode.ui.rememberActions
import app.monkmode.ui.rememberData
import app.monkmode.ui.rememberNow
import java.time.format.TextStyle
import java.util.Locale

private data class TodayData(
    val byDay: Map<java.time.LocalDate, Long>, val target: Int, val blocks: ActiveBlocks, val tasks: List<app.monkmode.data.Task>,
    val plan: app.monkmode.data.DailyPlan?, val liveFocusStart: Long?, val blockedToday: Int,
)

@Composable
fun TodayScreen(onNavigate: (Tab) -> Unit, onSettings: () -> Unit) {
    val actions = rememberActions()
    val now = rememberNow(30_000)
    val d = today()
    val data by rememberData<TodayData?>(null, d) { m ->
        val session = m.focus.active()
        TodayData(
            focusByDay(m.repo.sessionsSince(startOfDayMs(d.minusDays(400)))),
            m.repo.dailyPlan(d.toString())?.focusTargetMin?.takeIf { it > 0 } ?: m.repo.int("dailyTargetMin", 120),
            m.resolver.resolve(),
            m.repo.tasks().filter { it.status == "todo" && it.parentId == null && (it.dueDate == null || it.dueDate <= d.toString()) }.take(5),
            m.repo.dailyPlan(d.toString()),
            session?.takeIf { it.phase == "focus" }?.let { now - FocusMath.elapsedMs(it.timing, now) },
            m.repo.blockEvents(500).count { it.ts >= startOfDayMs(d) },
        )
    }
    val hour = java.time.LocalTime.now().hour
    val greeting = when { hour < 5 -> "Still up"; hour < 12 -> "Good morning"; hour < 18 -> "Good afternoon"; else -> "Good evening" }
    Screen("$greeting.", d.format(java.time.format.DateTimeFormatter.ofPattern("EEEE, d MMMM")), onSettings) {
        val x = data ?: return@Screen
        val live = x.liveFocusStart?.let { now - it } ?: 0
        val todayMs = (x.byDay[d] ?: 0) + live
        val (streak, best) = Analytics.streak(x.byDay, d)
        item {
            MonkCard {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Stat("Focused today", FocusMath.format(todayMs), "of ${FocusMath.format(x.target * 60_000L)}", accent = true)
                    Stat("Streak", "$streak d", "best $best")
                }
                Spacer(Modifier.height(14.dp))
                ProgressBar(todayMs.toFloat() / (x.target * 60_000f))
                Spacer(Modifier.height(14.dp))
                Button(onClick = { onNavigate(Tab.FOCUS) }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.PlayArrow, null)
                    Text(if (x.liveFocusStart != null) "Return to focus" else "Start focus")
                }
            }
        }
        item {
            MonkCard(title = "This week") {
                val days = (6 downTo 0).map { d.minusDays(it.toLong()) }
                WeekBars(days.map { it.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.getDefault()) to ((x.byDay[it] ?: 0) + if (it == d) live else 0) })
            }
        }
        item {
            MonkCard(title = "Monk Guard", action = { TextButton(onClick = { onNavigate(Tab.GUARD) }) { Text("Open") } }) {
                Text(if (x.blocks.active) "Blocking ${x.blocks.packages.size} apps · ${x.blocks.triggers.joinToString()}" else "Not blocking right now", style = MaterialTheme.typography.bodyMedium)
                Text("${x.blockedToday} distractions blocked today", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        item {
            MonkCard(title = "Today's intention", action = { TextButton(onClick = { onNavigate(Tab.PLAN) }) { Text("Plan") } }) {
                if (x.plan == null || (x.plan.intention.isBlank() && x.plan.priorities.isEmpty())) {
                    Text("No plan yet. Set an intention and three priorities.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    if (x.plan.intention.isNotBlank()) Text(x.plan.intention, style = MaterialTheme.typography.bodyMedium)
                    x.plan.priorities.forEachIndexed { i, p -> Text("${i + 1}. $p", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
        item {
            MonkCard(title = "Up next") {
                if (x.tasks.isEmpty()) Text("Nothing due. Add tasks in Plan.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                x.tasks.forEach { t ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = false, onCheckedChange = { actions.run { repo.setTaskDone(t, true) } })
                        Text(t.title, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = 4.dp))
                    }
                }
            }
        }
    }
}
