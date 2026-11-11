package app.monkmode

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import app.monkmode.ui.rememberData
import app.monkmode.ui.screens.FocusScreen
import app.monkmode.ui.screens.GuardScreen
import app.monkmode.ui.screens.InsightsScreen
import app.monkmode.ui.screens.Onboarding
import app.monkmode.ui.screens.PlanScreen
import app.monkmode.ui.screens.SettingsScreen
import app.monkmode.ui.screens.TodayScreen
import app.monkmode.ui.theme.MonkPrefs
import app.monkmode.ui.theme.MonkTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

enum class Tab(val label: String, val icon: ImageVector) {
    TODAY("Today", Icons.Outlined.WbSunny),
    FOCUS("Focus", Icons.Outlined.Timer),
    GUARD("Guard", Icons.Outlined.Shield),
    PLAN("Plan", Icons.Outlined.CheckCircle),
    INSIGHTS("Insights", Icons.Outlined.BarChart),
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Whenever the app is in the foreground: catch the engines up and (re)start Monk Guard.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch(Dispatchers.IO) {
                    val monk = Monk.get(this@MainActivity)
                    monk.focus.tick()
                    monk.strict.tick()
                    runCatching { monk.usage.import() }
                    (application as MonkApp).ensureGuard()
                }
            }
        }
        setContent { App() }
    }
}

@Composable
private fun App() {
    val prefs by rememberData(MonkPrefs()) { MonkPrefs(it.repo.string("themeMode", "system"), it.repo.string("accent", "saffron")) }
    val onboarded by rememberData<Boolean?>(null) { it.repo.flag("onboardingComplete", false) }
    var tab by rememberSaveable { mutableStateOf(Tab.TODAY) }
    var settings by rememberSaveable { mutableStateOf(false) }
    MonkTheme(prefs) {
        when {
            onboarded == null -> Box(Modifier.fillMaxSize())
            onboarded == false -> Onboarding()
            settings -> {
                BackHandler { settings = false }
                SettingsScreen(onBack = { settings = false })
            }
            else -> Scaffold(
                containerColor = MaterialTheme.colorScheme.background,
                bottomBar = {
                    NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                        Tab.entries.forEach { t ->
                            NavigationBarItem(
                                selected = tab == t,
                                onClick = { tab = t },
                                icon = { Icon(t.icon, contentDescription = null) },
                                label = { Text(t.label) },
                                colors = NavigationBarItemDefaults.colors(indicatorColor = MaterialTheme.colorScheme.secondaryContainer, selectedIconColor = MaterialTheme.colorScheme.primary),
                            )
                        }
                    }
                },
            ) { pad ->
                Box(Modifier.padding(pad)) {
                    val openSettings = { settings = true }
                    when (tab) {
                        Tab.TODAY -> TodayScreen(onNavigate = { tab = it }, onSettings = openSettings)
                        Tab.FOCUS -> FocusScreen(onSettings = openSettings)
                        Tab.GUARD -> GuardScreen(onSettings = openSettings)
                        Tab.PLAN -> PlanScreen(onSettings = openSettings)
                        Tab.INSIGHTS -> InsightsScreen(onSettings = openSettings)
                    }
                }
            }
        }
    }
}
