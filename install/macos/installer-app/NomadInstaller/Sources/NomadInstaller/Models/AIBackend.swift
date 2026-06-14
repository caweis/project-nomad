import Foundation

/// Mirrors nomad's AI-backend selection (install/macos/nomad:396-425). Pure logic
/// for eligibility; the static `current*` helpers read this machine.
enum AIBackend: String, CaseIterable, Identifiable, Sendable {
    case ollama, omlx

    var id: String { rawValue }
    var displayName: String { self == .ollama ? "Ollama" : "oMLX (Apple MLX)" }

    /// oMLX requirements — mirror nomad backend_eligible(), asserted by parity tests.
    static let requiredArch = "arm64"
    static let omlxMinOSMajor = 15

    /// nomad backend_eligible(): Apple Silicon + macOS 15+.
    static func omlxEligible(arch: String, osMajor: Int) -> Bool {
        arch == requiredArch && osMajor >= omlxMinOSMajor
    }

    /// nomad recommend_backend(): oMLX when eligible, else Ollama.
    static func recommended(arch: String, osMajor: Int) -> AIBackend {
        omlxEligible(arch: arch, osMajor: osMajor) ? .omlx : .ollama
    }

    static var currentArch: String {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { raw -> String in
            String(cString: raw.bindMemory(to: CChar.self).baseAddress!)
        }
    }

    static var currentOSMajor: Int {
        ProcessInfo.processInfo.operatingSystemVersion.majorVersion
    }
}
