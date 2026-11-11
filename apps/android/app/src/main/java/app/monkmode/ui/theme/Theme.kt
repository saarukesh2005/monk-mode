package app.monkmode.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Mirrors packages/design-system/src/index.ts (Graphite + Paper themes, accent palette).
data class Accent(val id: String, val name: String, val dark: Color, val light: Color)

val ACCENTS = listOf(
    Accent("saffron", "Saffron", Color(0xFFE3A857), Color(0xFFB06E12)),
    Accent("sage", "Sage", Color(0xFF8DBF98), Color(0xFF3F7A4C)),
    Accent("ice", "Ice", Color(0xFF86B7E0), Color(0xFF2F6EA3)),
    Accent("iris", "Iris", Color(0xFFA595F5), Color(0xFF5B47C9)),
    Accent("rose", "Rose", Color(0xFFE895AA), Color(0xFFB23A5B)),
    Accent("mono", "Mono", Color(0xFFE8E8EA), Color(0xFF1A1B1E)),
)

data class MonkPrefs(val mode: String = "system", val accent: String = "saffron")

val LocalPrefs = staticCompositionLocalOf { MonkPrefs() }

@Composable
fun MonkTheme(prefs: MonkPrefs = MonkPrefs(), content: @Composable () -> Unit) {
    val dark = when (prefs.mode) {
        "dark" -> true
        "light" -> false
        else -> isSystemInDarkTheme()
    }
    val accent = ACCENTS.firstOrNull { it.id == prefs.accent } ?: ACCENTS.first()
    val scheme = if (dark) {
        darkColorScheme(
            primary = accent.dark, onPrimary = Color(0xFF111111), background = Color(0xFF0E0F11), onBackground = Color(0xFFECECEE),
            surface = Color(0xFF151619), onSurface = Color(0xFFECECEE), surfaceVariant = Color(0xFF1B1C20), onSurfaceVariant = Color(0xFF9A9CA3),
            surfaceContainer = Color(0xFF151619), surfaceContainerHigh = Color(0xFF1B1C20), surfaceContainerHighest = Color(0xFF232429),
            outline = Color(0x1FFFFFFF), outlineVariant = Color(0x0FFFFFFF), error = Color(0xFFE5484D), secondaryContainer = accent.dark.copy(alpha = 0.16f),
            onSecondaryContainer = accent.dark,
        )
    } else {
        lightColorScheme(
            primary = accent.light, onPrimary = Color.White, background = Color(0xFFF6F5F2), onBackground = Color(0xFF1A1B1E),
            surface = Color.White, onSurface = Color(0xFF1A1B1E), surfaceVariant = Color(0xFFF0EFEB), onSurfaceVariant = Color(0xFF62646B),
            surfaceContainer = Color.White, surfaceContainerHigh = Color(0xFFF0EFEB), surfaceContainerHighest = Color(0xFFE7E5E0),
            outline = Color(0x29141414), outlineVariant = Color(0x14141414), error = Color(0xFFCE2C31), secondaryContainer = accent.light.copy(alpha = 0.12f),
            onSecondaryContainer = accent.light,
        )
    }
    val type = Typography(
        displayLarge = TextStyle(fontSize = 64.sp, fontWeight = FontWeight.Light, letterSpacing = (-2).sp),
        headlineMedium = TextStyle(fontSize = 26.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.4).sp),
        titleMedium = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
        labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.8.sp),
        bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
        bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 17.sp),
    )
    MaterialTheme(colorScheme = scheme, typography = type, content = content)
}
