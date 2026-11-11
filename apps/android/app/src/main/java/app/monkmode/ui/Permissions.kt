package app.monkmode.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import app.monkmode.Monk

/** Each permission MONK MODE can use, with a plain-language explanation shown before asking. */
enum class Perm(val title: String, val why: String) {
    NOTIFICATIONS("Notifications", "So MONK MODE can tell you when a focus session or break ends, and show the running timer."),
    USAGE("Usage access", "Lets Monk Guard see which app is open, so it can block the apps you chose, and lets you see your own screen time. The data never leaves your phone."),
    OVERLAY("Display over other apps", "Lets Monk Guard put the block screen in front of a blocked app. Without it, you only get a notification."),
    BATTERY("Unrestricted battery", "Some phones stop background apps aggressively. Allowing MONK MODE to run unrestricted keeps blocks and timers reliable."),
}

object Permissions {
    fun granted(context: Context, p: Perm): Boolean = when (p) {
        Perm.NOTIFICATIONS -> Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        Perm.USAGE -> Monk.get(context).usage.hasAccess()
        Perm.OVERLAY -> Settings.canDrawOverlays(context)
        Perm.BATTERY -> context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)
    }

    /** Opens the system screen where the user decides. Nothing is ever enabled silently. */
    fun settingsIntent(context: Context, p: Perm): Intent = when (p) {
        Perm.NOTIFICATIONS -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        Perm.USAGE -> Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
        Perm.OVERLAY -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
        Perm.BATTERY -> Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
    }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}
