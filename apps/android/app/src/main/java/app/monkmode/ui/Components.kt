package app.monkmode.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.monkmode.Monk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** Loads data off the main thread and reloads whenever the repository reports a change. */
@Composable
fun <T> rememberData(initial: T, vararg keys: Any?, load: (Monk) -> T): State<T> {
    val monk = Monk.get(LocalContext.current)
    val version by monk.repo.version.collectAsState()
    return produceState(initial, version, *keys) { value = withContext(Dispatchers.IO) { runCatching { load(monk) }.getOrDefault(initial) } }
}

@Composable
fun rememberNow(periodMs: Long = 1000): Long {
    val now = remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(periodMs) {
        while (true) {
            now.longValue = System.currentTimeMillis()
            delay(periodMs)
        }
    }
    return now.longValue
}

@Composable
fun LogoMark(modifier: Modifier = Modifier) {
    val accent = MaterialTheme.colorScheme.primary
    val dot = MaterialTheme.colorScheme.onBackground
    Canvas(modifier.semantics { contentDescription = "MONK MODE" }) {
        val s = size.minDimension / 64f
        val r = 15.75f * s
        drawArc(accent, startAngle = -73f, sweepAngle = 326f, useCenter = false, topLeft = Offset(32 * s - r, 32 * s - r), size = androidx.compose.ui.geometry.Size(2 * r, 2 * r), style = Stroke(3.5f * s, cap = StrokeCap.Round))
        drawCircle(dot, radius = 3.5f * s, center = Offset(32 * s, 32 * s))
    }
}

@Composable
fun MonkCard(modifier: Modifier = Modifier, title: String? = null, action: (@Composable () -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(18.dp)).padding(18.dp),
    ) {
        if (title != null || action != null) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                title?.let { Text(it.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                action?.invoke()
            }
            Spacer(Modifier.height(10.dp))
        }
        content()
    }
}

@Composable
fun Stat(label: String, value: String, hint: String? = null, accent: Boolean = false) {
    Column {
        Text(label.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.titleMedium.copy(fontSize = MaterialTheme.typography.headlineMedium.fontSize), color = if (accent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
        hint?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
fun ProgressBar(value: Float, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest)) {
        Box(Modifier.fillMaxWidth(value.coerceIn(0f, 1f)).height(6.dp).clip(RoundedCornerShape(3.dp)).background(MaterialTheme.colorScheme.primary))
    }
}

@Composable
fun Ring(progress: Float, size: Dp, muted: Boolean, content: @Composable () -> Unit) {
    val track = MaterialTheme.colorScheme.surfaceContainerHighest
    val color = if (muted) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(size)) {
            val stroke = 5.dp.toPx()
            drawCircle(track, style = Stroke(stroke))
            drawArc(color, -90f, 360f * progress.coerceIn(0f, 1f), false, topLeft = Offset(stroke / 2, stroke / 2), size = androidx.compose.ui.geometry.Size(this.size.width - stroke, this.size.height - stroke), style = Stroke(stroke, cap = StrokeCap.Round))
        }
        content()
    }
}

@Composable
fun EmptyNote(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 8.dp))
}

@Composable
fun WeekBars(days: List<Pair<String, Long>>, highlightLast: Boolean = true, height: Dp = 120.dp) {
    val max = maxOf(1L, days.maxOfOrNull { it.second } ?: 1L)
    val accent = MaterialTheme.colorScheme.primary
    val muted = MaterialTheme.colorScheme.surfaceContainerHighest
    Row(Modifier.fillMaxWidth().height(height), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Bottom) {
        days.forEachIndexed { i, (label, ms) ->
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.fillMaxWidth().height(((height.value - 18) * ms / max).coerceAtLeast(if (ms > 0) 2f else 0f).dp).clip(RoundedCornerShape(4.dp)).background(if (highlightLast && i == days.lastIndex) accent else muted))
                Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
