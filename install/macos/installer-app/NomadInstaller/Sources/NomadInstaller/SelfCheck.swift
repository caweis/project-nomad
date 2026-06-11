import Foundation

/// Headless smoke test: exercise the bundle → payload → stage chain and the
/// machine-detection logic without launching the GUI or installing anything.
/// Triggered by `NomadInstaller --selfcheck`; useful for CI verification of the
/// signed/notarized DMG (P2).
enum SelfCheck {
    static func runAndExit() -> Never {
        do {
            let nomad = try PayloadProvider.stage()
            let executable = FileManager.default.isExecutableFile(atPath: nomad.path)
            let compose = FileManager.default.fileExists(
                atPath: nomad.deletingLastPathComponent().appendingPathComponent("compose.yaml").path)

            let tier = ModelTier.autoDetected.rawValue
            let backend = AIBackend.recommended(
                arch: AIBackend.currentArch, osMajor: AIBackend.currentOSMajor).rawValue

            print("selfcheck: nomad=\(nomad.path)")
            print("selfcheck: executable=\(executable) compose.yaml=\(compose)")
            print("selfcheck: arch=\(AIBackend.currentArch) os=\(AIBackend.currentOSMajor) tier=\(tier) backend=\(backend)")
            print(executable && compose ? "selfcheck: PASS" : "selfcheck: FAIL")
            exit(executable && compose ? 0 : 1)
        } catch {
            print("selfcheck: FAIL — \(error)")
            exit(2)
        }
    }
}
