import Foundation

/// The uninstall choice, rendered into `nomad uninstall` arguments.
struct UninstallConfig: Equatable, Sendable {
    var keepData: Bool   // true = preserve downloaded content (--keep-data)

    /// argv for `bash nomad uninstall`. Always --yes (unattended). --keep-data
    /// preserves the content drive even under --yes, so "remove NOMAD" never
    /// silently wipes the user's models, maps, and Wikipedia.
    func uninstallArguments() -> [String] {
        var args = ["uninstall", "--yes"]
        if keepData { args.append("--keep-data") }
        return args
    }
}
