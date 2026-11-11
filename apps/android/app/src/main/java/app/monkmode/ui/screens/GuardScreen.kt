package app.monkmode.ui.screens

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.monkmode.core.FocusMath
import app.monkmode.core.Schedules
import app.monkmode.core.StrictPolicy
import app.monkmode.data.ActiveBlocks
import app.monkmode.data.BlockEvent
import app.monkmode.data.Blocklist
import app.monkmode.data.Rule
import app.monkmode.data.Schedule
import app.monkmode.data.StrictSession
import app.monkmode.guard.GuardService
import app.monkmode.ui.MonkCard
import app.monkmode.ui.Perm
import app.monkmode.ui.Permissions
import app.monkmode.ui.rememberActions
import app.monkmode.ui.rememberData
import app.monkmode.ui.rememberNow

private data class GuardData(
    val blocks: ActiveBlocks, val lists: List<Blocklist>, val rules: List<Rule>, val schedules: List<Schedule>,
    val strict: StrictSession?, val exitAt: Long?, val events: List<BlockEvent>, val quick: List<Pair<String, Long>>,
)

@Composable
fun GuardScreen(onSettings: () -> Unit) {
    val actions = rememberActions()
    val context = LocalContext.current
    val now = rememberNow(5000)
    val data by rememberData<GuardData?>(null, now / 15_000) { m ->
        val s = m.strict.active()
        GuardData(m.resolver.resolve(), m.repo.blocklists(), m.repo.rules(), m.repo.schedules(), s, s?.let(m.strict::exitAvailableAt), m.repo.blockEvents(30), m.repo.activeQuickBlocks())
    }
    var picker by remember { mutableStateOf<String?>(null) }
    var scheduleFor by remember { mutableStateOf<String?>(null) }
    var strictOpen by remember { mutableStateOf(false) }
    var exitOpen by remember { mutableStateOf(false) }

    Screen("Monk Guard", "Shields the apps you choose during focus, on schedules or on demand.", onSettings) {
        item { PermissionCard(now) }
        val x = data ?: return@Screen
        val blockLists = x.lists.filter { it.kind == "block" }
        item {
            MonkCard(title = "Status") {
                Text(if (x.blocks.active) (if (x.blocks.strict) "Strict blocking active" else "Blocking now") else "Idle", style = MaterialTheme.typography.titleMedium)
                Text(if (x.blocks.active) "${x.blocks.packages.size} apps · ${x.blocks.triggers.joinToString()}" else "Blocks start with focus sessions, schedules, quick blocks or strict mode.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                x.quick.forEach { (listId, endsAt) -> Text("Quick block · ${x.lists.find { it.id == listId }?.name} · ${FocusMath.format(endsAt - now)} left", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary) }
                if (blockLists.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    Text("Block now", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    @OptIn(ExperimentalLayoutApi::class)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf(15, 30, 60, 120, 240).forEach { m ->
                            OutlinedButton(onClick = { actions.run("Blocking for ${FocusMath.format(m * 60_000L)}") { repo.quickBlock(blockLists.first().id, m); GuardService.start(context) } }) { Text(FocusMath.format(m * 60_000L)) }
                        }
                    }
                }
            }
        }
        item {
            MonkCard(title = "Strict mode") {
                val s = x.strict
                if (s == null) {
                    Text("Commit to a block for a fixed time. There is always an emergency exit — stricter levels add deliberate friction.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(8.dp))
                    Button(onClick = { strictOpen = true }, enabled = blockLists.isNotEmpty()) { Text("Start commitment") }
                } else {
                    Text("${s.level.replaceFirstChar(Char::uppercase)} · ${FocusMath.format(maxOf(0, s.endsAt - now), seconds = true)} left", style = MaterialTheme.typography.titleMedium)
                    x.exitAt?.let { Text(if (it > now) "Exit requested — restrictions lift in ${FocusMath.format(it - now, seconds = true)}." else "Finishing…", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (StrictPolicy.exitPolicy(s.level).canPause) {
                            if (s.state == "ACTIVE") OutlinedButton(onClick = { actions.run { strict.pause() } }) { Text("Pause") } else Button(onClick = { actions.run { strict.resume() } }) { Text("Resume") }
                        }
                        if (x.exitAt != null) Button(onClick = { actions.run { strict.abortExit() } }) { Text("Stay committed") }
                        else TextButton(onClick = { exitOpen = true }) { Text("Emergency exit") }
                    }
                }
            }
        }
        items(x.lists, key = { it.id }) { list ->
            ListCard(list, x.rules.filter { it.listId == list.id }, x.schedules.filter { it.listId == list.id }, onAddApp = { picker = list.id }, onAddSchedule = { scheduleFor = list.id })
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { actions.run { repo.addList("New blocklist", "block") } }) { Text("+ Blocklist") }
                OutlinedButton(onClick = { actions.run { repo.addList("Always allowed", "allow") } }) { Text("+ Allowlist") }
            }
        }
        item {
            MonkCard(title = "Recently blocked") {
                if (x.events.isEmpty()) Text("Nothing blocked yet.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                x.events.take(10).forEach { e ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(e.target, style = MaterialTheme.typography.bodyMedium)
                        Text("${java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(e.ts)} · ${e.trigger}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }

    picker?.let { listId -> AppPicker(onDismiss = { picker = null }, onPick = { pkg, label -> actions.run { repo.addAppRule(listId, pkg, label) }; picker = null }) }
    scheduleFor?.let { listId -> ScheduleDialog(onDismiss = { scheduleFor = null }, onSave = { name, mask, start, end, strict -> actions.run { repo.addSchedule(name, listId, mask, start, end, strict); GuardService.start(context) }; scheduleFor = null }) }
    if (strictOpen) data?.let { StrictDialog(it.lists.filter { l -> l.kind == "block" }, onDismiss = { strictOpen = false }, onStart = { level, min, lists -> actions.run("Commitment started") { strict.start(level, min, lists, true); GuardService.start(context) }; strictOpen = false }) }
    if (exitOpen) data?.strict?.let { s -> ExitDialog(s.level, onDismiss = { exitOpen = false }, onSubmit = { reason, phrase -> actions.run { strict.requestExit(reason, phrase) }; exitOpen = false }) }
}

@Composable
private fun PermissionCard(now: Long) {
    val context = LocalContext.current
    val missing = remember(now / 5000) { Perm.entries.filterNot { Permissions.granted(context, it) } }
    if (missing.isEmpty()) return
    MonkCard(title = "Setup needed") {
        missing.forEachIndexed { i, p ->
            if (i > 0) HorizontalDivider(Modifier.padding(vertical = 8.dp))
            Text(p.title, style = MaterialTheme.typography.titleMedium)
            Text(p.why, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = { runCatching { context.startActivity(Permissions.settingsIntent(context, p)) } }) { Text("Open settings") }
        }
    }
}

@Composable
private fun ListCard(list: Blocklist, rules: List<Rule>, schedules: List<Schedule>, onAddApp: () -> Unit, onAddSchedule: () -> Unit) {
    val actions = rememberActions()
    MonkCard(title = if (list.kind == "allow") "Allowlist" else "Blocklist", action = {
        Switch(checked = list.enabled, onCheckedChange = { v -> actions.run { guardRules.setListEnabled(list.id, v) } })
    }) {
        var name by rememberSaveable(list.id) { mutableStateOf(list.name) }
        OutlinedTextField(name, { name = it.take(80) }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        if (name != list.name && name.isNotBlank()) TextButton(onClick = { actions.run { repo.renameList(list.id, name) } }) { Text("Save name") }
        if (list.kind == "block") Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = list.blockDuringFocus, onCheckedChange = { v -> actions.run { repo.setBlockDuringFocus(list.id, v) } })
            Text("Block during focus sessions", style = MaterialTheme.typography.bodySmall)
        }
        if (list.kind == "block") {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip("Hard block", list.mode != "pause") { actions.run { guardRules.setListMode(list.id, "block", list.pauseSeconds, list.pauseAllowMin) } }
                Chip("Mindful pause", list.mode == "pause") { actions.run { guardRules.setListMode(list.id, "pause", list.pauseSeconds, list.pauseAllowMin) } }
            }
            if (list.mode == "pause") {
                Text("A ${list.pauseSeconds}-second breathing pause and an intention prompt, then you can go back or continue for ${list.pauseAllowMin} min. Strict commitments always hard-block.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                @OptIn(ExperimentalLayoutApi::class)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(5, 10, 20, 30).forEach { sec -> Chip("$sec s", list.pauseSeconds == sec) { actions.run { guardRules.setListMode(list.id, "pause", sec, list.pauseAllowMin) } } }
                    listOf(3, 5, 10).forEach { m -> Chip("then $m min", list.pauseAllowMin == m) { actions.run { guardRules.setListMode(list.id, "pause", list.pauseSeconds, m) } } }
                }
            }
        }
        val apps = rules.filter { it.type == "app" }
        if (apps.isEmpty()) Text("No apps yet.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        apps.forEach { r ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(r.label.ifBlank { r.value }, style = MaterialTheme.typography.bodyMedium)
                    Text(r.value, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = { actions.run { guardRules.deleteRule(list.id, r.id) } }) { Icon(Icons.Outlined.Delete, "Remove ${r.label}") }
            }
        }
        val webRules = rules.count { it.type != "app" }
        if (webRules > 0) Text("$webRules website rules apply in the desktop browser extension (Android browsers cannot be filtered).", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        schedules.forEach { s ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("${s.name} · ${Schedules.describeDays(s.daysMask)} ${Schedules.clock(s.startMinute)}–${Schedules.clock(s.endMinute)}${if (s.strict) " · strict" else ""}", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                IconButton(onClick = { actions.run { guardRules.deleteSchedule(s.id, s.strict) } }) { Icon(Icons.Outlined.Delete, "Delete schedule") }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onAddApp) { Text("+ App") }
            if (list.kind == "block") OutlinedButton(onClick = onAddSchedule) { Text("+ Schedule") }
            TextButton(onClick = { actions.run { guardRules.deleteList(list.id) } }) { Text("Delete list") }
        }
    }
}

@Composable
private fun AppPicker(onDismiss: () -> Unit, onPick: (String, String) -> Unit) {
    val context = LocalContext.current
    var q by remember { mutableStateOf("") }
    val apps by rememberData(emptyList<Pair<String, String>>()) {
        val pm = context.packageManager
        @Suppress("DEPRECATION")
        pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
            .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
            .filter { it.first != context.packageName }.distinctBy { it.first }.sortedBy { it.second.lowercase() }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
        title = { Text("Choose an app") },
        text = {
            Column {
                OutlinedTextField(q, { q = it }, label = { Text("Search") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                LazyColumn(Modifier.heightIn(max = 380.dp)) {
                    items(apps.filter { it.second.contains(q, true) || it.first.contains(q, true) }, key = { it.first }) { (pkg, label) ->
                        Column(Modifier.fillMaxWidth().clickable { onPick(pkg, label) }.padding(vertical = 10.dp)) {
                            Text(label, style = MaterialTheme.typography.bodyMedium)
                            Text(pkg, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        },
    )
}

private fun parseClock(s: String): Int? = Regex("^(\\d{1,2}):(\\d{2})$").find(s.trim())?.let { m ->
    val h = m.groupValues[1].toInt()
    val min = m.groupValues[2].toInt()
    if (h < 24 && min < 60) h * 60 + min else null
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ScheduleDialog(onDismiss: () -> Unit, onSave: (String, Int, Int, Int, Boolean) -> Unit) {
    var name by remember { mutableStateOf("Work hours") }
    var mask by remember { mutableStateOf(Schedules.WEEKDAYS) }
    var start by remember { mutableStateOf("09:00") }
    var end by remember { mutableStateOf("17:00") }
    var strict by remember { mutableStateOf(false) }
    val s = parseClock(start)
    val e = parseClock(end)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New schedule") },
        confirmButton = { TextButton(enabled = s != null && e != null && mask != 0 && name.isNotBlank(), onClick = { onSave(name, mask, s!!, e!!, strict) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it.take(80) }, label = { Text("Name") }, singleLine = true)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Schedules.DAY_LABELS.forEachIndexed { i, d -> Chip(d, mask and (1 shl i) != 0) { mask = mask xor (1 shl i) } }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(start, { start = it.take(5) }, label = { Text("From") }, singleLine = true, isError = s == null, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                    OutlinedTextField(end, { end = it.take(5) }, label = { Text("Until") }, singleLine = true, isError = e == null, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                }
                Text("Earlier end than start = overnight. Same time = all day.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(strict, { strict = it })
                    Text("Strict (no exceptions while active)", style = MaterialTheme.typography.bodySmall)
                }
            }
        },
    )
}

@Composable
private fun StrictDialog(lists: List<Blocklist>, onDismiss: () -> Unit, onStart: (String, Int, List<String>) -> Unit) {
    var level by remember { mutableStateOf("strict") }
    var minutes by remember { mutableStateOf("60") }
    var selected by remember { mutableStateOf(lists.take(1).map { it.id }.toSet()) }
    var confirmed by remember { mutableStateOf(false) }
    val min = minutes.toIntOrNull()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Prepare a commitment") },
        confirmButton = { TextButton(enabled = confirmed && selected.isNotEmpty() && min != null && min in StrictPolicy.MIN_DURATION_MIN..StrictPolicy.MAX_DURATION_MIN, onClick = { onStart(level, min!!, selected.toList()) }) { Text("Commit") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(
                    "normal" to "Normal — pause, edit and leave any time.",
                    "strict" to "Strict — no pausing or removing rules; leaving needs a reason and a 30-second wait.",
                    "maximum" to "Maximum — adds a longer cool-down and a typed commitment phrase.",
                ).forEach { (id, text) ->
                    Row(Modifier.fillMaxWidth().clickable { level = id }, verticalAlignment = Alignment.CenterVertically) {
                        androidx.compose.material3.RadioButton(level == id, { level = id })
                        Text(text, style = MaterialTheme.typography.bodySmall)
                    }
                }
                OutlinedTextField(minutes, { minutes = it.filter(Char::isDigit).take(3) }, label = { Text("Minutes (5–720)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                lists.forEach { l ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(l.id in selected, { v -> selected = if (v) selected + l.id else selected - l.id })
                        Text(l.name)
                    }
                }
                Row(verticalAlignment = Alignment.Top) {
                    Checkbox(confirmed, { confirmed = it })
                    Text("I choose to commit. MONK MODE is a commitment device, not an unbreakable lock: force-stopping the app or revoking permissions ends enforcement, and that is recorded in my history.", style = MaterialTheme.typography.bodySmall)
                }
            }
        },
    )
}

@Composable
private fun ExitDialog(level: String, onDismiss: () -> Unit, onSubmit: (String, String?) -> Unit) {
    val policy = StrictPolicy.exitPolicy(level)
    var reason by remember { mutableStateOf("") }
    var phrase by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Emergency exit") },
        confirmButton = { TextButton(enabled = StrictPolicy.validateExit(level, reason, phrase.ifBlank { null }) == null, onClick = { onSubmit(reason, phrase.ifBlank { null }) }) { Text("Request exit") } },
        dismissButton = { Button(onClick = onDismiss) { Text("Keep going") } },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (policy.cooldownMs == 0L) "The session ends immediately." else "Restrictions lift after a ${FocusMath.format(policy.cooldownMs, seconds = true)} cool-down. The exit is recorded.", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(reason, { reason = it.take(500) }, label = { Text(if (policy.minReasonLength > 0) "Reason (min ${policy.minReasonLength} characters)" else "Reason (optional)") })
                policy.phrase?.let {
                    Text("Type: “$it”", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedTextField(phrase, { phrase = it }, singleLine = true)
                }
            }
        },
    )
}
