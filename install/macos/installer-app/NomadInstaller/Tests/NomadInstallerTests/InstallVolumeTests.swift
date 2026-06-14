import Testing
import Foundation
@testable import NomadInstaller

@Suite struct InstallVolumeTests {
    // Regression: the internal/boot volume's root is read-only, so the data root
    // must not be <root>/project-nomad. Mirror the CLI's ~/project-nomad-data.
    @Test func internalVolumeUsesHomeDataDir() {
        let v = InstallVolume(id: "/", name: "Macintosh HD", path: "/",
                              freeBytes: 0, totalBytes: 0, isInternal: true)
        #expect(v.dataRoot == (NSHomeDirectory() as NSString).appendingPathComponent("project-nomad-data"))
        #expect(v.dataRoot.hasPrefix(NSHomeDirectory()))
        #expect(v.dataRoot != "/project-nomad")
        #expect(!v.dataRoot.hasPrefix("//"))
    }

    @Test func externalVolumeUsesProjectNomadSubdir() {
        let v = InstallVolume(id: "/Volumes/Field", name: "Field", path: "/Volumes/Field",
                              freeBytes: 0, totalBytes: 0, isInternal: false)
        #expect(v.dataRoot == "/Volumes/Field/project-nomad")
    }
}
