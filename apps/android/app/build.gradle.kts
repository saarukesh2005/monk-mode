// AGP 9 builds Kotlin itself (built-in Kotlin); only the Compose compiler plugin is added.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

/** Copies the canonical SQL migrations and preset data so Android uses exactly the desktop schema. */
abstract class CopySharedAssets : DefaultTask() {
    @get:InputDirectory abstract val migrations: DirectoryProperty
    @get:InputFile abstract val presets: RegularFileProperty
    @get:OutputDirectory abstract val outputDir: DirectoryProperty

    @TaskAction
    fun copy() {
        val out = outputDir.get().asFile
        out.deleteRecursively()
        val migrationsOut = File(out, "migrations").apply { mkdirs() }
        migrations.get().asFile.listFiles { f -> f.extension == "sql" }.orEmpty().sortedBy { it.name }
            .forEach { it.copyTo(File(migrationsOut, it.name), overwrite = true) }
        presets.get().asFile.copyTo(File(out, "presets.json"), overwrite = true)
    }
}

val copySharedAssets = tasks.register<CopySharedAssets>("copySharedAssets") {
    migrations.set(layout.projectDirectory.dir("../../../packages/database/migrations"))
    presets.set(layout.projectDirectory.file("../../../packages/shared-core/data/presets.json"))
}

android {
    namespace = "app.monkmode"
    // The 2026 AndroidX libraries require compiling against API 37; runtime behaviour targets API 35.
    compileSdk = 37

    defaultConfig {
        applicationId = "app.monkmode.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        // Release signing is configured only when a keystore is supplied (see docs/BUILD_GUIDE.md).
        val ks = System.getenv("MONK_KEYSTORE")
        if (ks != null) {
            create("release") {
                storeFile = file(ks)
                storePassword = System.getenv("MONK_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("MONK_KEY_ALIAS")
                keyPassword = System.getenv("MONK_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copySharedAssets, CopySharedAssets::outputDir)
    }
}

dependencies {
    implementation(project(":core"))
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
