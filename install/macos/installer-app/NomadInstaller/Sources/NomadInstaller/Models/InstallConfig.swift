import Foundation

/// The user's wizard choices, rendered into `nomad install` arguments.
struct InstallConfig: Equatable, Sendable {
    var dataRoot: String
    var tier: ModelTier?   // nil = let the CLI auto-resolve (--tier auto)
    var backend: AIBackend

    /// argv for `bash nomad <args>`. Always --yes (unattended); --tier auto when unset.
    func installArguments() -> [String] {
        ["install", "--yes",
         "--data-root", dataRoot,
         "--tier", tier?.rawValue ?? "auto",
         "--backend", backend.rawValue]
    }
}
