pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "MonkMode"
// :core is pure Kotlin (rules, timing, crypto) tested on the JVM against the shared vectors;
// :app is the Android application (UI, database, guard service).
include(":app", ":core")
