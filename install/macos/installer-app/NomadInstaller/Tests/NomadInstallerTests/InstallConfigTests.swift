import Testing
@testable import NomadInstaller

@Suite struct InstallConfigTests {
    @Test func buildsArgvWithAllChoices() {
        let cfg = InstallConfig(dataRoot: "/Volumes/Data", tier: .medium, backend: .ollama, skipModels: false)
        #expect(cfg.installArguments() ==
            ["install", "--yes", "--data-root", "/Volumes/Data", "--tier", "medium", "--backend", "ollama"])
    }

    @Test func nilTierPassesAuto() {
        let cfg = InstallConfig(dataRoot: "/Users/me/nomad", tier: nil, backend: .omlx, skipModels: false)
        #expect(cfg.installArguments() ==
            ["install", "--yes", "--data-root", "/Users/me/nomad", "--tier", "auto", "--backend", "omlx"])
    }

    @Test func skipModelsUsesNoModelsAndOmitsTier() {
        let cfg = InstallConfig(dataRoot: "/Volumes/Data", tier: .medium, backend: .ollama, skipModels: true)
        #expect(cfg.installArguments() ==
            ["install", "--yes", "--data-root", "/Volumes/Data", "--no-models", "--backend", "ollama"])
    }
}
