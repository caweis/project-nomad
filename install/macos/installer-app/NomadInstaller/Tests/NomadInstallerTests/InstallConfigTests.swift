import Testing
@testable import NomadInstaller

@Suite struct InstallConfigTests {
    @Test func buildsArgvWithAllChoices() {
        let cfg = InstallConfig(dataRoot: "/Volumes/Data", tier: .medium, backend: .ollama)
        #expect(cfg.installArguments() ==
            ["install", "--yes", "--data-root", "/Volumes/Data", "--tier", "medium", "--backend", "ollama"])
    }

    @Test func nilTierPassesAuto() {
        let cfg = InstallConfig(dataRoot: "/Users/me/nomad", tier: nil, backend: .omlx)
        #expect(cfg.installArguments() ==
            ["install", "--yes", "--data-root", "/Users/me/nomad", "--tier", "auto", "--backend", "omlx"])
    }
}
