plugins {
    id("org.jetbrains.kotlin.jvm")
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    // org.json ships with Android; on the JVM it is only needed for compiling and tests.
    compileOnly("org.json:json:20240303")
    testImplementation("org.json:json:20240303")
    testImplementation("junit:junit:4.13.2")
}

tasks.test {
    // Shared cross-platform vectors live in packages/shared-core.
    systemProperty("monk.vectors", rootProject.projectDir.resolve("../../packages/shared-core/vectors").absolutePath)
    systemProperty("monk.data", rootProject.projectDir.resolve("../../packages/shared-core/data").absolutePath)
}
