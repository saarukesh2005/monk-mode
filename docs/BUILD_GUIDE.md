# Build guide

## Tool versions used and verified on the development Mac (MacBook Air M4, macOS 26)

| Tool | Version |
|---|---|
| Node.js / npm | 24.18 / 11.21 (Node 22.5+ required for `node:sqlite` tests) |
| Rust | 1.95.0 (stable) |
| JDK | Temurin 17.0.21 (`~/.local/jdk`) |
| Android SDK | platform 37 (compile), build-tools 36; app targets API 35, minimum API 26 |
| Gradle / AGP / Kotlin | 9.8.1 / 9.4.1 / 2.4.21 (AGP compiles Kotlin itself) |
| Xcode | not needed (Command Line Tools are enough for the Tauri build) |

Nothing needs a paid service, API key or account.

## Repository layout

```
apps/desktop        Tauri 2 app: src/ (React + TypeScript + Tailwind), src-tauri/ (Rust)
apps/android        Kotlin + Jetpack Compose app (Gradle)
packages/           shared TypeScript: types, core logic, analytics, validation, design tokens,
                    database migrations (also used by Rust and Android), test vectors
extensions/         browser extension source (shared/) and build output (browser-*/dist)
scripts/            icon generation, extension build, backup test-vector generator
.github/workflows   CI (tests), desktop builds, Android builds
```

## Everyday commands (repository root)

```bash
npm install                 # once
npm test                    # TypeScript unit tests (vitest)
npm run typecheck           # shared packages + desktop UI
npm run test:rust           # Rust unit tests (desktop core)
npm run extensions:build    # Chromium + Firefox extensions → artifacts/*.zip
npm run icons               # re-render icons from assets/brand/icon.svg
npm run desktop:dev         # run the desktop app in development
npm run desktop:build       # build installable desktop app for this OS
```

## macOS

```bash
npm install
npm run desktop:build
# → apps/desktop/src-tauri/target/release/bundle/macos/MONK MODE.app
# → apps/desktop/src-tauri/target/release/bundle/dmg/MONK MODE_1.0.0_aarch64.dmg
```

Intel build on an Apple Silicon Mac: `rustup target add x86_64-apple-darwin`, then
`cd apps/desktop && npx tauri build --target x86_64-apple-darwin`. A universal app:
`--target universal-apple-darwin` (needs both targets).

## Windows (on the Windows PC — a Windows build cannot be verified from a Mac)

1. Install: Node.js 22 LTS, Rust (`rustup`, MSVC toolchain), *Visual Studio Build Tools* with
   "Desktop development with C++", and WebView2 (already in Windows 11).
2. In the repository folder:
   ```powershell
   npm install
   npm run desktop:build
   ```
3. Output: `apps\desktop\src-tauri\target\release\bundle\nsis\*.exe` and `...\msi\*.msi`.
   The portable executable is `apps\desktop\src-tauri\target\release\monk-mode.exe`.
4. Tests: `npm test` and `npm run test:rust`.

Or use GitHub Actions → *Desktop builds* → Run workflow (builds macOS arm64, macOS x64 and
Windows x64).

## Android

```bash
cd apps/android
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties
export JAVA_HOME=~/.local/jdk/jdk-17.0.21+9/Contents/Home   # any JDK 17
./gradlew test               # unit tests
./gradlew assembleDebug      # app/build/outputs/apk/debug/*.apk
./gradlew assembleRelease    # unsigned unless a keystore is configured
./gradlew bundleRelease      # App Bundle (.aab)
```

See INSTALLATION_ANDROID.md for installing on the phone.

## Signing (not done in this repository)

No certificates are included or invented. To distribute signed builds:

- **macOS:** Apple Developer Program membership; a *Developer ID Application* certificate;
  set `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
  `APPLE_PASSWORD`, `APPLE_TEAM_ID` for `tauri build` to sign and notarize. Screen Time
  (FamilyControls) shielding additionally needs Apple's Family Controls entitlement.
- **Windows:** a code-signing certificate (OV/EV); configure `bundle.windows.certificateThumbprint`
  or a sign command in `tauri.conf.json`.
- **Android:** create a keystore with `keytool` (keep it out of git); set `MONK_KEYSTORE`,
  `MONK_KEYSTORE_PASSWORD`, `MONK_KEY_ALIAS`, `MONK_KEY_PASSWORD` when building, or store them as
  GitHub secrets.
- **Firefox extension:** sign it for free at addons.mozilla.org (unlisted is fine) to install it
  permanently. **Chrome Web Store:** one-time developer fee to publish.

## Versioning

Version `1.0.0` is set in `package.json`, `apps/desktop/src-tauri/tauri.conf.json`,
`apps/desktop/src-tauri/Cargo.toml` and `apps/android/app/build.gradle.kts`
(`versionName`/`versionCode`). Update all four together. Build numbers come from
`MONK_BUILD_NUMBER` (CI uses the run number).
