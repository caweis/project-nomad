import Foundation

/// Stages the bundled install tree to a writable working dir and hands back the
/// `nomad` script path. The app bundle is read-only, so the installer can't run
/// from inside it; it copies to ~/Library/Application Support first.
enum PayloadProvider {
    enum PayloadError: Error { case payloadMissing }

    static func stage() throws -> URL {
        guard let bundled = Bundle.module.url(forResource: "payload", withExtension: nil) else {
            throw PayloadError.payloadMissing
        }
        let fm = FileManager.default
        let support = try fm.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let work = support.appendingPathComponent("NOMAD-Installer/payload", isDirectory: true)

        try? fm.removeItem(at: work)
        try fm.createDirectory(at: work.deletingLastPathComponent(), withIntermediateDirectories: true)
        try fm.copyItem(at: bundled, to: work)

        // SwiftPM's resource copy can drop the executable bit; restore it so the
        // CLI and its shell scripts run.
        restoreExecutableBits(in: work)

        return work.appendingPathComponent("nomad")
    }

    private static func restoreExecutableBits(in dir: URL) {
        let fm = FileManager.default
        guard let walker = fm.enumerator(at: dir, includingPropertiesForKeys: nil) else { return }
        for case let url as URL in walker {
            let name = url.lastPathComponent
            if name == "nomad" || url.pathExtension == "sh" || url.pathExtension == "command" {
                try? fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
            }
        }
    }
}
