package app.monkmode.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import app.monkmode.core.FocusMath
import app.monkmode.data.DailyPlan
import app.monkmode.data.Subject
import app.monkmode.data.Task
import app.monkmode.data.Topic
import app.monkmode.ui.MonkCard
import app.monkmode.ui.ProgressBar
import app.monkmode.ui.rememberActions
import app.monkmode.ui.rememberData
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters

private enum class PlanTab(val label: String) { TASKS("Tasks"), DAY("Daily plan"), STUDY("Study") }

private val SUBJECT_COLORS = listOf("#E3A857", "#8DBF98", "#86B7E0", "#A595F5", "#E895AA")
private val RECURRENCES = listOf("none" to "Once", "daily" to "Daily", "weekdays" to "Weekdays", "weekly" to "Weekly", "monthly" to "Monthly")

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PlanScreen(onSettings: () -> Unit) {
    var tab by rememberSaveable { mutableStateOf(PlanTab.TASKS) }
    Screen("Plan", "Tasks, today's plan and your studies.", onSettings) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { PlanTab.entries.forEach { t -> Chip(t.label, tab == t) { tab = t } } }
        }
        when (tab) {
            PlanTab.TASKS -> tasks()
            PlanTab.DAY -> item { DailyPlanCard() }
            PlanTab.STUDY -> item { StudyCards() }
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.tasks() {
    item { TaskList() }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TaskList() {
    val actions = rememberActions()
    val all by rememberData(emptyList<Task>()) { it.repo.tasks() }
    var showDone by rememberSaveable { mutableStateOf(false) }
    var title by rememberSaveable { mutableStateOf("") }
    var due by rememberSaveable { mutableStateOf("today") }
    var priority by rememberSaveable { mutableStateOf(0) }
    var recurrence by rememberSaveable { mutableStateOf("none") }
    val today = today()
    val dueDate = when (due) {
        "today" -> today.toString()
        "tomorrow" -> today.plusDays(1).toString()
        "week" -> today.with(TemporalAdjusters.nextOrSame(DayOfWeek.FRIDAY)).toString()
        else -> null
    }
    val add = {
        if (title.isNotBlank()) {
            val t = title
            actions.run { repo.addTask(t, dueDate, priority, if (dueDate == null) "none" else recurrence) }
            title = ""
        }
    }
    MonkCard(title = "New task") {
        OutlinedTextField(
            title, { title = it.take(300) }, label = { Text("What needs doing?") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { add() }),
        )
        Spacer(Modifier.height(8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("today" to "Today", "tomorrow" to "Tomorrow", "week" to "This week", "none" to "No date").forEach { (k, l) -> Chip(l, due == k) { due = k } }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("Normal", "Low", "High", "Urgent").forEachIndexed { i, l -> Chip(l, priority == i) { priority = i } }
        }
        if (dueDate != null) FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) { RECURRENCES.forEach { (k, l) -> Chip(l, recurrence == k) { recurrence = k } } }
        Button(onClick = add, enabled = title.isNotBlank()) { Text("Add task") }
    }
    Spacer(Modifier.height(14.dp))
    val parents = all.filter { it.parentId == null && (showDone || it.status == "todo") }
    MonkCard(title = if (showDone) "All tasks" else "Open tasks", action = { TextButton(onClick = { showDone = !showDone }) { Text(if (showDone) "Hide done" else "Show done") } }) {
        if (parents.isEmpty()) Text("Nothing here. Add a task above.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        parents.forEach { t ->
            TaskRow(t, today, indent = false)
            all.filter { it.parentId == t.id }.forEach { TaskRow(it, today, indent = true) }
            if (t.status == "todo") SubtaskInput(t.id)
        }
    }
}

@Composable
private fun TaskRow(t: Task, today: LocalDate, indent: Boolean) {
    val actions = rememberActions()
    Row(Modifier.fillMaxWidth().padding(start = if (indent) 32.dp else 0.dp), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked = t.status == "done", onCheckedChange = { v -> actions.run { repo.setTaskDone(t, v) } })
        Column(Modifier.weight(1f)) {
            Text(t.title, style = MaterialTheme.typography.bodyMedium, textDecoration = if (t.status == "done") TextDecoration.LineThrough else null)
            val meta = listOfNotNull(
                t.dueDate?.let { d -> when { d == today.toString() -> "Today"; d < today.toString() && t.status == "todo" -> "Overdue · $d"; else -> d } },
                listOf(null, "Low", "High", "Urgent")[t.priority.coerceIn(0, 3)],
                t.recurrence.takeIf { it != "none" }?.let { "Repeats $it" },
            )
            if (meta.isNotEmpty()) Text(meta.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = if (meta.first().startsWith("Overdue")) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
        }
        IconButton(onClick = { actions.run { repo.deleteTask(t.id) } }) { Icon(Icons.Outlined.Delete, "Delete ${t.title}") }
    }
}

@Composable
private fun SubtaskInput(parentId: String) {
    val actions = rememberActions()
    var text by remember { mutableStateOf("") }
    OutlinedTextField(
        text, { text = it.take(300) }, placeholder = { Text("+ subtask") }, singleLine = true,
        modifier = Modifier.fillMaxWidth().padding(start = 32.dp, bottom = 6.dp),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = {
            val t = text
            if (t.isNotBlank()) actions.run { repo.addTask(t, null, parentId = parentId) }
            text = ""
        }),
    )
}

@Composable
private fun DailyPlanCard() {
    val actions = rememberActions()
    val date = today()
    val stored by rememberData<DailyPlan?>(null, date) { it.repo.dailyPlan(date.toString()) }
    val target by rememberData(120) { it.repo.int("dailyTargetMin", 120) }
    var intention by rememberSaveable { mutableStateOf("") }
    var p1 by rememberSaveable { mutableStateOf("") }
    var p2 by rememberSaveable { mutableStateOf("") }
    var p3 by rememberSaveable { mutableStateOf("") }
    var minutes by rememberSaveable { mutableStateOf("") }
    var review by rememberSaveable { mutableStateOf("") }
    var mood by rememberSaveable { mutableStateOf<Int?>(null) }
    var loaded by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(stored) {
        if (!loaded) {
            stored?.let { s ->
                intention = s.intention
                p1 = s.priorities.getOrElse(0) { "" }
                p2 = s.priorities.getOrElse(1) { "" }
                p3 = s.priorities.getOrElse(2) { "" }
                minutes = s.focusTargetMin.takeIf { it > 0 }?.toString() ?: ""
                review = s.review
                mood = s.mood
                loaded = true
            }
        }
    }
    fun plan() = DailyPlan(date.toString(), intention, listOf(p1, p2, p3), minutes.toIntOrNull() ?: target, review, mood)
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        MonkCard(title = "Morning planning") {
            OutlinedTextField(intention, { intention = it.take(500) }, label = { Text("Today I will…") }, modifier = Modifier.fillMaxWidth())
            listOf(p1 to { v: String -> p1 = v }, p2 to { v: String -> p2 = v }, p3 to { v: String -> p3 = v }).forEachIndexed { i, (v, set) ->
                OutlinedTextField(v, { set(it.take(200)) }, label = { Text("Priority ${i + 1}") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }
            OutlinedTextField(minutes, { minutes = it.filter(Char::isDigit).take(4) }, label = { Text("Focus target (minutes, default $target)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
            Button(onClick = { actions.run("Plan saved") { repo.saveDailyPlan(plan()) } }) { Text("Save plan") }
        }
        MonkCard(title = "End-of-day review") {
            OutlinedTextField(review, { review = it.take(5000) }, label = { Text("What went well? What will change tomorrow?") }, modifier = Modifier.fillMaxWidth().height(120.dp))
            @OptIn(ExperimentalLayoutApi::class)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("Rough", "Meh", "Okay", "Good", "Great").forEachIndexed { i, m -> Chip(m, mood == i + 1) { mood = if (mood == i + 1) null else i + 1 } }
            }
            OutlinedButton(onClick = { actions.run("Day closed") { repo.saveDailyPlan(plan(), reviewed = true) } }) { Text("Close the day") }
        }
    }
}

private data class StudyData(val subjects: List<Subject>, val topics: List<Topic>, val weekMs: Map<String, Long>)

@Composable
private fun StudyCards() {
    val actions = rememberActions()
    val weekStart = today().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    val data by rememberData(StudyData(emptyList(), emptyList(), emptyMap()), weekStart) { m ->
        val sessions = m.repo.sessionsSince(startOfDayMs(weekStart)).filter { it.phase == "focus" && it.subjectId != null }
        StudyData(m.repo.subjects().filterNot(Subject::archived), m.repo.topics(), sessions.groupBy { it.subjectId!! }.mapValues { (_, v) -> v.sumOf { it.focusedMs } })
    }
    var name by rememberSaveable { mutableStateOf("") }
    var goal by rememberSaveable { mutableStateOf("180") }
    val todayStr = today().toString()
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        val due = data.topics.filter { it.nextReview != null && it.nextReview <= todayStr }
        if (due.isNotEmpty()) MonkCard(title = "Due for revision") {
            due.forEach { t ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(t.title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    TextButton(onClick = { actions.run { repo.reviewTopic(t) } }) { Text("Reviewed") }
                }
            }
        }
        data.subjects.forEach { s ->
            val topics = data.topics.filter { it.subjectId == s.id }
            val week = data.weekMs[s.id] ?: 0
            MonkCard(title = s.name) {
                Text("${FocusMath.format(week)} this week" + if (s.weeklyGoalMin > 0) " of ${FocusMath.format(s.weeklyGoalMin * 60_000L)}" else "", style = MaterialTheme.typography.bodyMedium)
                if (s.weeklyGoalMin > 0) ProgressBar(week / (s.weeklyGoalMin * 60_000f), Modifier.padding(vertical = 8.dp))
                if (topics.isNotEmpty()) Text("${topics.count { it.status == "done" }}/${topics.size} topics learned", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                topics.forEach { t ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = t.status == "done", onCheckedChange = { actions.run { repo.reviewTopic(t) } }, enabled = t.status != "done")
                        Text(t.title + (t.nextReview?.let { " · review $it" } ?: ""), style = MaterialTheme.typography.bodySmall)
                    }
                }
                var topic by remember { mutableStateOf("") }
                OutlinedTextField(
                    topic, { topic = it.take(200) }, placeholder = { Text("+ topic") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { val t = topic; actions.run { repo.addTopic(s.id, t) }; topic = "" }),
                )
            }
        }
        MonkCard(title = "New subject") {
            OutlinedTextField(name, { name = it.take(80) }, label = { Text("Subject") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(goal, { goal = it.filter(Char::isDigit).take(4) }, label = { Text("Weekly goal (minutes)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
            Button(onClick = {
                val n = name
                val g = goal.toIntOrNull() ?: 0
                actions.run { repo.addSubject(n, g, SUBJECT_COLORS[(n.hashCode() and 0x7fffffff) % SUBJECT_COLORS.size]) }
                name = ""
            }, enabled = name.isNotBlank()) { Text("Add subject") }
        }
    }
}
