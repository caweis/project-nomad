import Foundation

/// A mounted volume the installer can target for `--data-root`.
struct InstallVolume: Identifiable, Equatable, Sendable {
    let id: String // path
    let name: String
    let path: String
    let freeBytes: Int64
    let totalBytes: Int64
    let isInternal: Bool

    /// Default data-root for this volume, mirroring the CLI's convention exactly
    /// (install/macos/nomad:1334/1357/1360). The internal/boot volume's root is
    /// read-only, so it uses ~/project-nomad-data; external drives use
    /// <volume>/project-nomad.
    var dataRoot: String {
        if isInternal {
            return (NSHomeDirectory() as NSString).appendingPathComponent("project-nomad-data")
        }
        return (path as NSString).appendingPathComponent("project-nomad")
    }
}

enum VolumeScanner {
    static func scan() -> [InstallVolume] {
        let keys: [URLResourceKey] = [
            .volumeNameKey, .volumeAvailableCapacityKey, .volumeTotalCapacityKey,
            .volumeIsReadOnlyKey, .volumeIsInternalKey, .volumeIsBrowsableKey,
        ]
        let mounts = FileManager.default.mountedVolumeURLs(
            includingResourceValuesForKeys: keys, options: [.skipHiddenVolumes]) ?? []

        return mounts.compactMap { url -> InstallVolume? in
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
        .sorted { !$0.isInternal && $1.isInternal } // external volumes first
    }
}
