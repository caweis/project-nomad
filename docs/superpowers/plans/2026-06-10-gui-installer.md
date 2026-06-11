# NOMAD Installer.app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, batched with checkpoints) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A notarized, downloadable macOS app that walks a non-technical user through installing NOMAD with no Terminal — a thin SwiftUI wizard over the proven `nomad install --yes` CLI, containing zero install logic.

**Architecture:** One SwiftPM package at `install/macos/installer-app/NomadInstaller/`. A C target (`CPTY`, forkpty wrapper, promoted from the proven PTYSpike) lets the app run `bash nomad install …` inside a pseudo-terminal and answer its sudo prompt. Pure logic (tier ladder, backend eligibility, CLI-output parsing, arg building) is unit-tested; the SwiftUI wizard and the PTY runner sit on top. The `.app` is assembled by script and signed + notarized in CI; a tagged release hosts the DMG and the in-app update check repoints at the fork's releases.

**Tech Stack:** Swift 6.3 / SwiftUI, macOS 14+ deployment target, SwiftPM (no Xcode project), `forkpty(3)` via a C target, `codesign` + `xcrun notarytool` + `create-dmg`, GitHub Actions on `macos` runners, `gh release create`.

**Feasibility:** The one novel piece (PTY + sudo interception) is already proven — see `install/macos/installer-app/PTYSpike/` and commit `f388235`. The probe ran `sudo -v` inside a PTY, detected `Password:`, and confirmed a written reply reached sudo's `/dev/tty` read.

**Ground truth (verified in `install/macos/nomad`):**
- Install flags (nomad:8-9): `--data-root PATH`, `--tier auto|tiny|small|medium|large|xl|dreamy`, `--models`, `--no-models`, `--yes`, `--backend ollama|omlx`.
- Root guard (nomad:732): the CLI dies if `EUID==0`, so the app must NOT elevate itself — it answers sudo prompts in the PTY instead.
- sudo (nomad:730-736): `sudo_bootstrap()` runs one `sudo -v` early, then a keepalive refreshes the timestamp every 50s. Stock prompt (`Password:`), no `-p`/`SUDO_PROMPT`.
- Output helpers (nomad:474-478): `section()`→ `── TEXT ──`, `log()`→ `==> TEXT`, `ok()`→ ` ✓ TEXT`, `warn()`→ ` ⚠ TEXT`, `die()`→ ` ✗ TEXT` (stderr). All wrapped in ANSI color.
- Tier ladder (nomad:372-382): `<12 GB`→tiny, `<20`→small, `<40`→medium, `<72`→large, `<128`→xl, `≥128`→dreamy. Pull-size GB (nomad:352-362): 3 / 22 / 59 / 90 / 155 / 257.
- Backend gate (nomad:397-401): oMLX eligible iff `arch==arm64 && macOS major ≥ 15`; else Ollama only.

---

## File Structure

```
install/macos/installer-app/
  PTYSpike/                              # committed feasibility proof (kept as reference)
  NomadInstaller/
    Package.swift                        # CPTY + NomadInstaller(exe) + NomadInstallerTests
    Scripts/
      stage-payload.sh                   # copy install/macos tree (minus installer-app) → Resources/payload
      make-app.sh                        # assemble unsigned NomadInstaller.app for local dev
      make-dmg.sh                        # create-dmg wrapper (P2)
      sign-and-notarize.sh               # codesign + notarytool + staple (P2)
    Info.plist                           # bundle metadata (template; version injected at build)
    Sources/
      CPTY/                              # promoted from PTYSpike
        include/cpty.h
        cpty.c
      NomadInstaller/
        NomadInstallerApp.swift          # @main App, single window
        Models/
          InstallConfig.swift            # dataRoot/tier/backend → CLI argv
          ModelTier.swift                # tier enum + RAM ladder + sizes (pure)
          AIBackend.swift                # backend enum + eligibility (pure)
          InstallLine.swift              # parsed CLI output line
        Services/
          InstallOutputParser.swift      # ANSI strip + line classification (pure)
          PTYRunner.swift                # runs bash nomad install in a PTY
          PayloadProvider.swift          # locate + stage bundled install tree
          VolumeScanner.swift            # /Volumes enumeration for the drive picker
        ViewModels/
          WizardViewModel.swift          # @Observable state machine
        Views/
          WizardView.swift               # NavigationStack container + step routing
          WelcomeStep.swift
          DataDriveStep.swift
          ModelTierStep.swift
          BackendStep.swift
          ProgressStep.swift
          SudoPasswordSheet.swift
        Resources/
          AppIcon.icns
          payload/                        # populated by stage-payload.sh at build (gitignored)
    Tests/
      NomadInstallerTests/
        ModelTierTests.swift
        AIBackendTests.swift
        InstallOutputParserTests.swift
        InstallConfigTests.swift
        PTYRunnerTests.swift
.github/workflows/
  build-gui-installer.yml                # P2: build → sign → notarize → DMG (artifact)
  release.yml                            # P3: on v* tag → DMG + gh release create
admin/app/services/system_service.ts     # P3: repoint update check to the fork's releases
```

---

## Phase 1 — The app (fully in our control; produces a working unsigned installer)

### Task 1: Scaffold the SwiftPM app and promote CPTY

**Files:**
- Create: `install/macos/installer-app/NomadInstaller/Package.swift`
- Create: `install/macos/installer-app/NomadInstaller/Sources/CPTY/include/cpty.h` (copy from PTYSpike)
- Create: `install/macos/installer-app/NomadInstaller/Sources/CPTY/cpty.c` (copy from PTYSpike)
- Create: `install/macos/installer-app/NomadInstaller/Sources/NomadInstaller/NomadInstallerApp.swift`
- Create: `install/macos/installer-app/NomadInstaller/.gitignore`

- [ ] **Step 1: Package.swift**

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "NomadInstaller",
    platforms: [.macOS(.v14)],
    targets: [
        .target(name: "CPTY"),
        .executableTarget(
            name: "NomadInstaller",
            dependencies: ["CPTY"],
            resources: [.copy("Resources/payload"), .process("Resources/AppIcon.icns")]
        ),
        .testTarget(name: "NomadInstallerTests", dependencies: ["NomadInstaller"]),
    ]
)
```

- [ ] **Step 2: Promote CPTY** — copy `cpty.h` and `cpty.c` verbatim from `PTYSpike/Sources/CPTY/`. They are unchanged (proven code).

- [ ] **Step 3: Minimal `@main` app**

```swift
import SwiftUI

@main
struct NomadInstallerApp: App {
    var body: some Scene {
        Window("Install NOMAD", id: "main") {
            Text("NOMAD Installer")
                .frame(width: 640, height: 460)
        }
        .windowResizability(.contentSize)
    }
}
```

- [ ] **Step 4: .gitignore**

```
.build/
.swiftpm/
Sources/NomadInstaller/Resources/payload/
*.app
*.dmg
```

- [ ] **Step 5: Seed payload dir** — create an empty placeholder so SwiftPM's `.copy` resource exists before the build phase populates it: `mkdir -p Sources/NomadInstaller/Resources/payload && touch Sources/NomadInstaller/Resources/payload/.keep`. (The real payload is staged by `stage-payload.sh` in Task 6.)

- [ ] **Step 6: Build**

Run: `cd install/macos/installer-app/NomadInstaller && swift build`
Expected: `Build complete!`

- [ ] **Step 7: Commit**

```bash
git add install/macos/installer-app/NomadInstaller
git commit -m "feat(installer): scaffold NomadInstaller SwiftPM app, promote CPTY"
```

---

### Task 2: ModelTier (TDD)

**Files:**
- Create: `Sources/NomadInstaller/Models/ModelTier.swift`
- Test: `Tests/NomadInstallerTests/ModelTierTests.swift`

- [ ] **Step 1: Failing test**

```swift
import Testing
@testable import NomadInstaller

@Suite struct ModelTierTests {
    // Mirror of nomad auto_tier() (nomad:372-382): floor(bytes / 1024^3) → tier.
    @Test func autoLadderMatchesCLI() {
        func gb(_ n: UInt64) -> UInt64 { n * 1_073_741_824 }
        #expect(ModelTier.auto(forPhysicalMemoryBytes: gb(8))   == .tiny)
        #expect(ModelTier.auto(forPhysicalMemoryBytes: gb(12))  == .small)   // 12 is not < 12
        #expect(ModelTier.auto(forPhysicalMemoryBytes: gb(16))  == .small)
        #expect(ModelTier.auto(forPhysicalMemoryBytes: gb(24))  == .medium)
        #expect(ModelTier.auto(forPhysicalMemoryBytes: gb(64))  == .large)
        #expect(ModelTier.auto(forPhysicalMemoryBytes: gb(96))  == .xl)
        #expect(ModelTier.auto(forPhysicalMemoryBytes: gb(128)) == .dreamy)
        #expect(ModelTier.auto(forPhysicalMemoryBytes: gb(192)) == .dreamy)
    }

    @Test func pullSizesMatchCLI() {
        #expect(ModelTier.tiny.approxPullGB == 3)
        #expect(ModelTier.small.approxPullGB == 22)
        #expect(ModelTier.medium.approxPullGB == 59)
        #expect(ModelTier.large.approxPullGB == 90)
        #expect(ModelTier.xl.approxPullGB == 155)
        #expect(ModelTier.dreamy.approxPullGB == 257)
    }
}
```

- [ ] **Step 2: Run, verify it fails** — `swift test --filter ModelTierTests` → FAIL (no `ModelTier`).

- [ ] **Step 3: Implement**

```swift
import Foundation

/// Mirrors nomad's model-tier table (nomad:322-382). Pure; no I/O.
enum ModelTier: String, CaseIterable, Identifiable, Sendable {
    case tiny, small, medium, large, xl, dreamy

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .tiny: "Tiny"; case .small: "Small"; case .medium: "Medium"
        case .large: "Large"; case .xl: "XL"; case .dreamy: "Dreamy"
        }
    }

    /// Approx download total in GB (nomad tier_size_gb, nomad:352-362).
    var approxPullGB: Int {
        switch self {
        case .tiny: 3; case .small: 22; case .medium: 59
        case .large: 90; case .xl: 155; case .dreamy: 257
        }
    }

    /// Mirror of nomad auto_tier(): integer-GB floor of physical memory → tier.
    static func auto(forPhysicalMemoryBytes bytes: UInt64) -> ModelTier {
        let gb = Int(bytes / 1_073_741_824)
        switch gb {
        case ..<12: return .tiny
        case ..<20: return .small
        case ..<40: return .medium
        case ..<72: return .large
        case ..<128: return .xl
        default: return .dreamy
        }
    }

    /// Auto tier for this machine.
    static var auto: ModelTier { auto(forPhysicalMemoryBytes: ProcessInfo.processInfo.physicalMemory) }
}
```

- [ ] **Step 4: Run, verify pass** — `swift test --filter ModelTierTests` → PASS.

- [ ] **Step 5: Commit** — `feat(installer): ModelTier with CLI-matched RAM ladder`.

---

### Task 3: AIBackend + eligibility (TDD)

**Files:**
- Create: `Sources/NomadInstaller/Models/AIBackend.swift`
- Test: `Tests/NomadInstallerTests/AIBackendTests.swift`

- [ ] **Step 1: Failing test**

```swift
import Testing
@testable import NomadInstaller

@Suite struct AIBackendTests {
    // Mirror nomad backend_eligible() (nomad:397-401): arm64 && macOS major >= 15.
    @Test func omlxEligibility() {
        #expect(AIBackend.omlxEligible(arch: "arm64", osMajor: 15) == true)
        #expect(AIBackend.omlxEligible(arch: "arm64", osMajor: 26) == true)
        #expect(AIBackend.omlxEligible(arch: "arm64", osMajor: 14) == false)
        #expect(AIBackend.omlxEligible(arch: "x86_64", osMajor: 15) == false)
    }

    @Test func recommendedFollowsEligibility() {
        #expect(AIBackend.recommended(arch: "arm64", osMajor: 15) == .omlx)
        #expect(AIBackend.recommended(arch: "arm64", osMajor: 14) == .ollama)
    }
}
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

```swift
import Foundation

enum AIBackend: String, CaseIterable, Identifiable, Sendable {
    case ollama, omlx
    var id: String { rawValue }
    var displayName: String { self == .ollama ? "Ollama" : "oMLX (Apple MLX)" }

    /// nomad backend_eligible(): Apple Silicon + macOS 15+.
    static func omlxEligible(arch: String, osMajor: Int) -> Bool {
        arch == "arm64" && osMajor >= 15
    }

    /// nomad recommend_backend(): oMLX when eligible, else Ollama.
    static func recommended(arch: String, osMajor: Int) -> AIBackend {
        omlxEligible(arch: arch, osMajor: osMajor) ? .omlx : .ollama
    }

    static var currentArch: String {
        var info = utsname(); uname(&info)
        let m = withUnsafeBytes(of: &info.machine) { raw -> String in
            String(cString: raw.bindMemory(to: CChar.self).baseAddress!)
        }
        return m
    }
    static var currentOSMajor: Int { ProcessInfo.processInfo.operatingSystemVersion.majorVersion }
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(installer): AIBackend eligibility mirroring the CLI gate`.

---

### Task 4: InstallOutputParser (TDD)

**Files:**
- Create: `Sources/NomadInstaller/Models/InstallLine.swift`
- Create: `Sources/NomadInstaller/Services/InstallOutputParser.swift`
- Test: `Tests/NomadInstallerTests/InstallOutputParserTests.swift`

- [ ] **Step 1: InstallLine type**

```swift
struct InstallLine: Equatable, Identifiable, Sendable {
    enum Kind: Equatable, Sendable {
        case section(String)   // ── TEXT ──  (milestone/phase header)
        case step(String)      // ==> TEXT
        case success(String)   //  ✓ TEXT
        case warning(String)   //  ⚠ TEXT
        case error(String)     //  ✗ TEXT
        case prompt            // sudo Password:
        case raw(String)
    }
    let id = UUID()
    let kind: Kind
    static func == (l: InstallLine, r: InstallLine) -> Bool { l.kind == r.kind }
}
```

- [ ] **Step 2: Failing test** (inputs use the real ANSI-wrapped formats from nomad:474-478)

```swift
import Testing
@testable import NomadInstaller

@Suite struct InstallOutputParserTests {
    let ESC = "\u{1B}"

    @Test func stripsANSI() {
        let s = "\(ESC)[1;34m==>\(ESC)[0m installing Homebrew"
        #expect(InstallOutputParser.stripANSI(s) == "==> installing Homebrew")
    }

    @Test func classifiesSection() {
        let line = "\(ESC)[1;34m── Docker / OrbStack ──\(ESC)[0m"
        #expect(InstallOutputParser.classify(line).kind == .section("Docker / OrbStack"))
    }

    @Test func classifiesStepSuccessWarnError() {
        #expect(InstallOutputParser.classify("==> pulling models").kind == .step("pulling models"))
        #expect(InstallOutputParser.classify(" ✓ Homebrew ready").kind == .success("Homebrew ready"))
        #expect(InstallOutputParser.classify(" ⚠ low disk").kind == .warning("low disk"))
        #expect(InstallOutputParser.classify(" ✗ failed to pull").kind == .error("failed to pull"))
    }

    @Test func classifiesSudoPrompt() {
        #expect(InstallOutputParser.classify("Password:").kind == .prompt)
        #expect(InstallOutputParser.classify("Password: ").kind == .prompt)
    }

    @Test func unrecognizedIsRaw() {
        #expect(InstallOutputParser.classify("just some text").kind == .raw("just some text"))
    }
}
```

- [ ] **Step 3: Run, verify fail.**

- [ ] **Step 4: Implement**

```swift
import Foundation

enum InstallOutputParser {
    private static let ansi = try! NSRegularExpression(pattern: "\u{1B}\\[[0-9;]*m")
    private static let section = try! NSRegularExpression(pattern: "^──\\s*(.+?)\\s*──$")

    static func stripANSI(_ s: String) -> String {
        let r = NSRange(s.startIndex..., in: s)
        return ansi.stringByReplacingMatches(in: s, range: r, withTemplate: "")
    }

    static func classify(_ rawLine: String) -> InstallLine {
        let clean = stripANSI(rawLine).trimmingCharacters(in: .whitespaces)
        if clean.hasPrefix("Password:") { return InstallLine(kind: .prompt) }
        let r = NSRange(clean.startIndex..., in: clean)
        if let m = section.firstMatch(in: clean, range: r), let g = Range(m.range(at: 1), in: clean) {
            return InstallLine(kind: .section(String(clean[g])))
        }
        if clean.hasPrefix("==>") {
            return InstallLine(kind: .step(clean.dropFirst(3).trimmingCharacters(in: .whitespaces)))
        }
        if let rest = strip(prefixGlyph: "✓", from: clean) { return InstallLine(kind: .success(rest)) }
        if let rest = strip(prefixGlyph: "⚠", from: clean) { return InstallLine(kind: .warning(rest)) }
        if let rest = strip(prefixGlyph: "✗", from: clean) { return InstallLine(kind: .error(rest)) }
        return InstallLine(kind: .raw(clean))
    }

    private static func strip(prefixGlyph g: Character, from s: String) -> String? {
        guard let i = s.firstIndex(of: g) else { return nil }
        // glyph must be at the start (after optional whitespace, already trimmed)
        guard s.distance(from: s.startIndex, to: i) == 0 else { return nil }
        return String(s[s.index(after: i)...]).trimmingCharacters(in: .whitespaces)
    }
}
```

- [ ] **Step 5: Run, verify pass.**
- [ ] **Step 6: Commit** — `feat(installer): parse nomad install output into milestones`.

---

### Task 5: InstallConfig → CLI argv (TDD)

**Files:**
- Create: `Sources/NomadInstaller/Models/InstallConfig.swift`
- Test: `Tests/NomadInstallerTests/InstallConfigTests.swift`

- [ ] **Step 1: Failing test**

```swift
import Testing
@testable import NomadInstaller

@Suite struct InstallConfigTests {
    @Test func buildsArgvWithAllChoices() {
        let cfg = InstallConfig(dataRoot: "/Volumes/Data", tier: .medium, backend: .ollama)
        #expect(cfg.installArguments() ==
            ["install", "--yes", "--data-root", "/Volumes/Data", "--tier", "medium", "--backend", "ollama"])
    }

    @Test func autoTierOmitsNothingAndPassesAuto() {
        let cfg = InstallConfig(dataRoot: "/Users/me/nomad", tier: nil, backend: .omlx)
        #expect(cfg.installArguments() ==
            ["install", "--yes", "--data-root", "/Users/me/nomad", "--tier", "auto", "--backend", "omlx"])
    }
}
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

```swift
import Foundation

struct InstallConfig: Equatable, Sendable {
    var dataRoot: String
    var tier: ModelTier?      // nil = auto
    var backend: AIBackend

    /// argv for `bash nomad <args>`. Always --yes (unattended); --tier auto when unset.
    func installArguments() -> [String] {
        ["install", "--yes",
         "--data-root", dataRoot,
         "--tier", tier?.rawValue ?? "auto",
         "--backend", backend.rawValue]
    }
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(installer): InstallConfig → nomad install argv`.

---

### Task 6: PayloadProvider + build-time staging

**Files:**
- Create: `Scripts/stage-payload.sh`
- Create: `Sources/NomadInstaller/Services/PayloadProvider.swift`

- [ ] **Step 1: stage-payload.sh** — copies the install tree (minus the app itself) into the SwiftPM resource dir before build. Run manually (and in CI) prior to `swift build`.

```bash
#!/usr/bin/env bash
set -euo pipefail
# Copy the install/macos tree (excluding installer-app) into the bundled payload.
HERE="$(cd "$(dirname "$0")/.." && pwd)"           # .../installer-app/NomadInstaller
SRC="$(cd "$HERE/../.." && pwd)"                    # .../install/macos
DEST="$HERE/Sources/NomadInstaller/Resources/payload"
rm -rf "$DEST"; mkdir -p "$DEST"
rsync -a --delete \
  --exclude 'installer-app/' \
  --exclude '.git/' \
  "$SRC"/ "$DEST"/
touch "$DEST/.keep"
echo "staged payload: $(du -sh "$DEST" | cut -f1)"
```

- [ ] **Step 2: Verify which files `nomad install` reads relative to its own dir.** Run: `rg -n 'SCRIPT_DIR|dirname|\$0|BASH_SOURCE|compose.yaml|omlx-proxy|scripts/' install/macos/nomad | head -40`. Confirm the staged tree (`nomad`, `compose.yaml`, `scripts/`, `omlx-proxy/`, `man/`, `help/`) is everything the install path touches. Note any absolute paths or curl-fetched assets that don't need bundling (the admin image is pulled from GHCR, so admin source is intentionally absent).

- [ ] **Step 3: PayloadProvider** — stage bundled payload to a writable working dir, return the `nomad` path.

```swift
import Foundation

enum PayloadProvider {
    enum PayloadError: Error { case payloadMissing }

    /// Copy the bundled payload to ~/Library/Application Support/NOMAD-Installer/payload
    /// (writable; the app bundle is read-only) and return the nomad script path.
    static func stage() throws -> URL {
        guard let bundled = Bundle.module.url(forResource: "payload", withExtension: nil) else {
            throw PayloadError.payloadMissing
        }
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let work = support.appendingPathComponent("NOMAD-Installer/payload", isDirectory: true)
        try? FileManager.default.removeItem(at: work)
        try FileManager.default.createDirectory(at: work.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: bundled, to: work)
        let nomad = work.appendingPathComponent("nomad")
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: nomad.path)
        return nomad
    }
}
```

- [ ] **Step 4: Build with real payload** — `bash Scripts/stage-payload.sh && swift build` → `Build complete!`.

- [ ] **Step 5: Commit** — `feat(installer): bundle + stage the install payload`. (`.gitignore` already excludes the copied payload.)

---

### Task 7: PTYRunner (integration-tested with a fake script)

**Files:**
- Create: `Sources/NomadInstaller/Services/PTYRunner.swift`
- Test: `Tests/NomadInstallerTests/PTYRunnerTests.swift`

PTYRunner generalizes the spike: run `bash <nomad> <args…>` in a PTY, stream parsed `InstallLine`s to a callback, and when a `.prompt` appears, ask an async `passwordProvider` and write the reply (then overwrite the buffer). Exit code surfaced on completion.

- [ ] **Step 1: Failing integration test** — drive a fake script through a real PTY (no sudo), asserting milestone streaming and prompt handling.

```swift
import Testing
import Foundation
@testable import NomadInstaller

@Suite struct PTYRunnerTests {
    /// A fake "installer" that prints a section, a step, then mimics a password prompt
    /// and echoes whether it received the reply.
    private func writeFakeScript() throws -> URL {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("ptyrunner-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let script = """
        #!/usr/bin/env bash
        printf '\\033[1;34m── Setup ──\\033[0m\\n'
        printf '==> doing a thing\\n'
        printf 'Password:'
        read -r PW
        printf '\\n ✓ got:%s\\n' "$PW"
        """
        let url = dir.appendingPathComponent("fake")
        try script.write(to: url, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        return url
    }

    @Test func streamsMilestonesAndAnswersPrompt() async throws {
        let fake = try writeFakeScript()
        var lines: [InstallLine] = []
        let runner = PTYRunner()
        let exit = try await runner.run(
            command: fake.path, arguments: [],
            onLine: { lines.append($0) },
            passwordProvider: { "hunter2" }
        )
        #expect(exit == 0)
        #expect(lines.contains(InstallLine(kind: .section("Setup"))))
        #expect(lines.contains(InstallLine(kind: .step("doing a thing"))))
        #expect(lines.contains(where: {
            if case let .success(t) = $0.kind { return t.contains("got:hunter2") }; return false
        }))
    }
}
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement PTYRunner** (uses the proven `cpty_spawn_bash`; reads master fd off the main thread; bridges the password prompt to an async provider).

```swift
import CPTY
import Darwin
import Foundation

final class PTYRunner {
    /// Run `bash <command> <arguments…>` in a PTY. `onLine` is called per parsed line.
    /// When a sudo prompt is seen, `passwordProvider` is awaited and the reply written.
    /// Returns the child's exit code.
    func run(
        command: String,
        arguments: [String],
        onLine: @escaping (InstallLine) -> Void,
        passwordProvider: @escaping () async -> String?
    ) async throws -> Int32 {
        // Build a single bash -c string: exec bash <command> "$@"
        let quoted = ([command] + arguments).map { "'" + $0.replacingOccurrences(of: "'", with: "'\\''") + "'" }
        let shell = "exec bash " + quoted.joined(separator: " ")

        var master: Int32 = -1
        let pid = shell.withCString { cpty_spawn_bash($0, &master) }
        guard pid > 0, master >= 0 else { throw NSError(domain: "PTYRunner", code: 1) }

        var pending = ""          // partial line buffer
        var answeredPrompt = false
        let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
        defer { buf.deallocate() }

        loop: while true {
            let n = read(master, buf, 4096)
            if n <= 0 { break loop }   // EIO on child exit
            let chunk = String(decoding: UnsafeBufferPointer(start: buf, count: n), as: UTF8.self)
            pending += chunk

            // Emit complete lines.
            while let nl = pending.firstIndex(of: "\n") {
                let raw = String(pending[..<nl]); pending.removeSubrange(...nl)
                let line = InstallOutputParser.classify(raw)
                onLine(line)
            }
            // A sudo prompt has no trailing newline; detect it in the residue.
            if !answeredPrompt, InstallOutputParser.classify(pending).kind == .prompt {
                onLine(InstallLine(kind: .prompt))
                if var pw = await passwordProvider() {
                    pw += "\n"
                    _ = pw.withCString { write(master, $0, strlen($0)) }
                    // best-effort scrub of the Swift copy
                    pw.removeAll(keepingCapacity: false)
                }
                answeredPrompt = true
                pending = ""
            }
        }
        close(master)
        var status: Int32 = 0
        waitpid(pid, &status, 0)
        let code: Int32 = (status & 0x7f) == 0 ? (status >> 8) & 0xff : 128 + (status & 0x7f)
        return code
    }
}
```

> **Note (Touch-ID-for-sudo edge):** if a user enabled `pam_tid` for sudo, the prompt may authenticate without a `Password:` line. The runner handles this naturally — no `.prompt` is emitted, the sheet never shows, the install proceeds. No special-casing needed; just don't block on a prompt that never comes.

> **Note (re-prompt):** `sudo_bootstrap`'s keepalive holds the timestamp, so a second prompt is unlikely. If one appears, `answeredPrompt` is reset per prompt detection only once here; for the wizard we re-arm it (the VM can re-present). Acceptable for v1: the keepalive makes re-prompts rare.

- [ ] **Step 4: Run, verify pass** — `swift test --filter PTYRunnerTests` → PASS.
- [ ] **Step 5: Commit** — `feat(installer): PTYRunner streaming nomad install with sudo handling`.

---

### Task 8: VolumeScanner (drive picker data)

**Files:**
- Create: `Sources/NomadInstaller/Services/VolumeScanner.swift`

- [ ] **Step 1: Implement**

```swift
import Foundation

struct InstallVolume: Identifiable, Equatable {
    let id: String          // path
    let name: String
    let path: String
    let freeBytes: Int64
    let totalBytes: Int64
    let isInternal: Bool

    /// Default data-root under this volume (matches the CLI's /project-nomad convention).
    var dataRoot: String { (path as NSString).appendingPathComponent("project-nomad") }
}

enum VolumeScanner {
    static func scan() -> [InstallVolume] {
        let keys: [URLResourceKey] = [
            .volumeNameKey, .volumeAvailableCapacityKey, .volumeTotalCapacityKey,
            .volumeIsReadOnlyKey, .volumeIsInternalKey, .volumeIsBrowsableKey,
        ]
        let mounts = FileManager.default.mountedVolumeURLs(
            includingResourceValuesForKeys: keys, options: [.skipHiddenVolumes]) ?? []
        return mounts.compactMap { url in
            guard let v = try? url.resourceValues(forKeys: Set(keys)),
                  v.volumeIsBrowsable == true, v.volumeIsReadOnly != true else { return nil }
            return InstallVolume(
                id: url.path,
                name: v.volumeName ?? url.lastPathComponent,
                path: url.path,
                freeBytes: Int64(v.volumeAvailableCapacity ?? 0),
                totalBytes: Int64(v.volumeTotalCapacity ?? 0),
                isInternal: v.volumeIsInternal ?? (url.path == "/")
            )
        }
        .sorted { !$0.isInternal && $1.isInternal }   // external volumes first
    }
}
```

- [ ] **Step 2: Build** — `swift build` → green.
- [ ] **Step 3: Commit** — `feat(installer): enumerate writable volumes for the drive picker`.

---

### Task 9: WizardViewModel (@Observable state machine)

**Files:**
- Create: `Sources/NomadInstaller/ViewModels/WizardViewModel.swift`

Holds the wizard step, the in-progress `InstallConfig`, the streamed log, the current milestone, run state, and the sudo-prompt bridge (a `CheckedContinuation` resolved by the password sheet).

- [ ] **Step 1: Implement**

```swift
import Foundation
import Observation

@MainActor
@Observable
final class WizardViewModel {
    enum Step: Int, CaseIterable { case welcome, dataDrive, modelTier, backend, progress }
    enum RunState: Equatable { case idle, running, needsPassword, succeeded, failed(Int32) }

    var step: Step = .welcome

    // Choices
    var volumes: [InstallVolume] = []
    var selectedVolume: InstallVolume?
    var tier: ModelTier = .auto
    var backend: AIBackend = .recommended(arch: AIBackend.currentArch, osMajor: AIBackend.currentOSMajor)

    var omlxEligible: Bool { AIBackend.omlxEligible(arch: AIBackend.currentArch, osMajor: AIBackend.currentOSMajor) }

    // Run
    var runState: RunState = .idle
    var lines: [InstallLine] = []
    var currentSection: String = ""
    private var passwordContinuation: CheckedContinuation<String?, Never>?

    func loadVolumes() { volumes = VolumeScanner.scan(); selectedVolume = volumes.first }

    func canAdvance(from step: Step) -> Bool {
        switch step {
        case .dataDrive: return selectedVolume != nil
        default: return true
        }
    }

    func advance() {
        guard let next = Step(rawValue: step.rawValue + 1) else { return }
        step = next
        if next == .progress { startInstall() }
    }
    func back() { if let p = Step(rawValue: step.rawValue - 1) { step = p } }

    // Sudo bridge — the sheet calls submitPassword(_:)
    func submitPassword(_ pw: String?) {
        passwordContinuation?.resume(returning: pw)
        passwordContinuation = nil
        if runState == .needsPassword { runState = .running }
    }

    func startInstall() {
        guard let vol = selectedVolume else { return }
        let cfg = InstallConfig(dataRoot: vol.dataRoot, tier: tier, backend: backend)
        runState = .running
        lines = []
        Task { [weak self] in
            guard let self else { return }
            do {
                let nomad = try PayloadProvider.stage()
                let runner = PTYRunner()
                let code = try await runner.run(
                    command: nomad.path,
                    arguments: cfg.installArguments(),
                    onLine: { line in Task { @MainActor in self.handle(line) } },
                    passwordProvider: { await self.requestPassword() }
                )
                await MainActor.run { self.runState = code == 0 ? .succeeded : .failed(code) }
            } catch {
                await MainActor.run { self.runState = .failed(-1) }
            }
        }
    }

    private func handle(_ line: InstallLine) {
        if case let .section(s) = line.kind { currentSection = s }
        lines.append(line)
    }

    private func requestPassword() async -> String? {
        await MainActor.run { self.runState = .needsPassword }
        return await withCheckedContinuation { cont in
            Task { @MainActor in self.passwordContinuation = cont }
        }
    }
}
```

- [ ] **Step 2: Build** — `swift build` → green.
- [ ] **Step 3: Commit** — `feat(installer): WizardViewModel state machine + sudo bridge`.

---

### Task 10: SwiftUI wizard views

**Files:** create each under `Sources/NomadInstaller/Views/`, and replace the placeholder body in `NomadInstallerApp.swift` with `WizardView()` holding the VM as `@State`.

Build the views to these specs (real SwiftUI, `@State var vm = WizardViewModel()` injected via the App; child steps take `@Bindable var vm`):

- [ ] **WizardView** — `NavigationStack`; a header with step dots; routes on `vm.step`; a footer with Back / Continue (Continue disabled when `!vm.canAdvance(from:)`); the `.progress` step hides the footer. Presents `SudoPasswordSheet` via `.sheet(isPresented: vm.runState == .needsPassword)`.
- [ ] **WelcomeStep** — what NOMAD is; what gets installed (Homebrew, OrbStack, Ollama/oMLX, containers); disk/network expectations (tens of GB). One "Continue".
- [ ] **DataDriveStep** — `List(vm.volumes)` with name, free/total, an "Internal" or "External" tag; `.onAppear { vm.loadVolumes() }`; selection binds `vm.selectedVolume`; a size warning when the internal disk is chosen.
- [ ] **ModelTierStep** — a picker over `ModelTier.allCases`; the auto default highlighted ("Recommended for your Mac: \(ModelTier.auto.displayName)"); each row shows `~\(tier.approxPullGB) GB download`.
- [ ] **BackendStep** — two options: Ollama (always) and oMLX. oMLX row disabled with the explanation "Requires Apple Silicon + macOS 15+" when `!vm.omlxEligible`. Default = `vm.backend`.
- [ ] **ProgressStep** — a friendly header bound to `vm.currentSection`; a determinate-ish phase list; a `Details` `DisclosureGroup` with a scrolling monospaced view of `vm.lines` (color by kind). On `.succeeded`: an "Open NOMAD" button → `NSWorkspace.shared.open(URL(string: "http://localhost:8080")!)`. On `.failed`: "Install hit a problem", the last ~40 lines, "Try again" (re-run — idempotent) + "Copy full log".
- [ ] **SudoPasswordSheet** — explanatory text ("NOMAD needs your password to install Homebrew — this is macOS's standard admin prompt"), a `SecureField`, Cancel / Continue. Continue calls `vm.submitPassword(field)`; Cancel calls `vm.submitPassword(nil)`. Clears the field on dismiss.

- [ ] **Build + render check** — `swift build` green; assemble and launch locally via `make-app.sh` (Task 11) and click through welcome → drive → tier → backend (do NOT start a real install yet).
- [ ] **Commit** — `feat(installer): SwiftUI wizard (welcome → drive → tier → backend → progress)`.

---

### Task 11: Local .app assembly + end-to-end dev run (operator-gated)

**Files:**
- Create: `Scripts/make-app.sh`
- Create: `Info.plist`

- [ ] **Step 1: Info.plist** (template; `CFBundleShortVersionString` injected at build)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>NOMAD Installer</string>
  <key>CFBundleExecutable</key><string>NomadInstaller</string>
  <key>CFBundleIdentifier</key><string>app.topointel.nomad.installer</string>
  <key>CFBundleShortVersionString</key><string>__VERSION__</string>
  <key>CFBundleVersion</key><string>__VERSION__</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
```

- [ ] **Step 2: make-app.sh** — build release, assemble an unsigned `.app` from the SwiftPM binary + Info.plist + the SwiftPM resource bundle.

```bash
#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-0.0.0-dev}"
bash "$HERE/Scripts/stage-payload.sh"
swift build -c release --package-path "$HERE"
BIN="$HERE/.build/release/NomadInstaller"
APP="$HERE/NomadInstaller.app"
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
sed "s/__VERSION__/$VERSION/g" "$HERE/Info.plist" > "$APP/Contents/Info.plist"
cp "$BIN" "$APP/Contents/MacOS/NomadInstaller"
# SwiftPM bundles resources next to the binary as NomadInstaller_NomadInstaller.bundle
cp -R "$HERE/.build/release/NomadInstaller_NomadInstaller.bundle" "$APP/Contents/Resources/" 2>/dev/null || true
echo "built: $APP"
```

- [ ] **Step 3 (OPERATOR — Chris):** real end-to-end run on a disposable data root. Like the live-on-mini checks, this is handed off — it performs the actual install. Suggested: `open NomadInstaller.app`, pick an external/scratch volume, tiny tier, Ollama; confirm the sudo sheet appears and accepts the password; confirm the milestone stream and the "Open NOMAD" success. Re-run to confirm idempotent repair.
- [ ] **Step 4: Commit** — `feat(installer): local .app assembly script + bundle metadata`.

- [ ] **Step 5: Board + handoff** — file a Supabase `todos` row for the operator validation, and (when P1 lands) note it.

---

## Phase 2 — Signing, notarization, DMG (CI; needs Chris's Apple Developer secrets)

### Task 12: Packaging scripts

**Files:** `Scripts/make-dmg.sh`, `Scripts/sign-and-notarize.sh`

- [ ] **sign-and-notarize.sh** — `codesign --deep --options runtime --timestamp --sign "$DEV_ID_APP" NomadInstaller.app`; zip; `xcrun notarytool submit --key … --key-id … --issuer … --wait`; `xcrun stapler staple NomadInstaller.app`. Verify with `spctl -a -vvv --type exec`.
- [ ] **make-dmg.sh** — `create-dmg` with the app + an `/Applications` symlink + desert background; sign + notarize + staple the DMG too. (Install `create-dmg` via brew in CI.)

### Task 13: build-gui-installer.yml

**Files:** `.github/workflows/build-gui-installer.yml`

- [ ] CI on `macos-latest`, manual dispatch + reusable (`workflow_call`): checkout → import cert from `MACOS_CERT_P12`/`MACOS_CERT_PW` into a temp keychain → `bash Scripts/make-app.sh "$VERSION"` → `sign-and-notarize.sh` → `make-dmg.sh` → upload the `.dmg` artifact. Version from root `package.json`.
- [ ] **Secrets checklist for Chris** (provision once, repo secrets): `MACOS_CERT_P12` (base64 Developer ID Application .p12), `MACOS_CERT_PW`, `NOTARY_KEY_ID`, `NOTARY_ISSUER_ID`, `NOTARY_KEY_P8` (base64 App Store Connect key). Document in the workflow header.

---

## Phase 3 — Release automation + update-check repoint

### Task 14: release.yml

**Files:** `.github/workflows/release.yml`

- [ ] On `v*` tag push: call `build-gui-installer.yml` → download the DMG artifact → `gh release create "$TAG" --title … --notes-file notes.md NomadInstaller-*.dmg`. Release notes drafted from `git log <prev-tag>..HEAD` (release-notes discipline) and run through humanizer + fact-check + don't-be-a-dick before publish; Chris reviews before the release flips from draft.
- [ ] First milestone release: `v0.3.0`, headline "the macOS app + everything since 0.2.5", DMG as payload.

### Task 15: Repoint the in-app update check (closes #27 part 1)

**Files:** `admin/app/services/system_service.ts` (+ its test)

- [ ] Read the current method (queries `api.github.com/repos/Crosstalk-Solutions/project-nomad/releases`, caches `system.latestVersion`). Change the repo to `caweis/project-nomad` and prefer `releases/latest`; compare against the fork's version line. Add/adjust a unit test asserting the fork URL and version comparison. Verify against the fork's `releases/latest` once `v0.3.0` exists.

---

## Phase 4 — Docs + announce (after a clean-Mac validation)

### Task 16: README install path

**Files:** `README.md`, `install/macos/README.md`

- [ ] Add "Or download the installer app" pointing at the latest release DMG; keep the curl one-liner for Terminal users. Run prose through humanizer + don't-be-a-dick + fact-check.

### Task 17: Community mention (gated)

- [ ] Only AFTER Chris validates the DMG on a clean macOS user/Mac (Gatekeeper accepts with no warnings; wizard → working NOMAD; re-run repairs): draft a short upstream show-and-tell update. Humanizer + fact-check + don't-be-a-dick. Chris approves before posting.

---

## Out of scope (YAGNI)
Uninstaller GUI (CLI `nomad uninstall` exists), app self-update (Sparkle), Intel Macs, Windows/Linux.

## Risks
- **PTY/sudo** — retired (spike PASS, commit `f388235`).
- **SwiftPM → notarized .app** — the `.app` is script-assembled, not Xcode-archived; verify hardened-runtime signing + notarization on the assembled bundle early in P2 (a single dry run on a throwaway build before wiring CI).
- **Payload completeness** — Task 6 Step 2 audits exactly what `nomad install` reads from its own dir so nothing essential is missing from the bundle.
- **Notarization secrets** — isolated to P2 so they can't block P1.
```
