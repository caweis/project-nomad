import Foundation

/// The user's wizard choices, rendered into `nomad install` arguments.
struct InstallConfig: Equatable, Sendable {
    var dataRoot: String
    var tier: ModelTier?   // nil = let the CLI auto-resolve (--tier auto)
    var backend: AIBackend
    var skipModels: Bool   // true = --no-models (install now, pull models later)

    /// argv for `bash nomad <args>`. Always --yes (unattended). Skipping models
    /// passes --no-models and omits --tier; otherwise --tier auto when unset.
    func installArguments() -> [String] {
        var args = ["install", "--yes", "--data-root", dataRoot]
        if skipModels {
            args.append("--no-models")
        } else {
            args += ["--tier", tier?.rawValue ?? "auto"]
        }
        args += ["--backend", backend.rawValue]
        return args
    }
}
