import Testing
@testable import NomadInstaller

@Suite struct UninstallConfigTests {
    @Test func keepDataAddsKeepDataFlag() {
        let cfg = UninstallConfig(keepData: true)
        #expect(cfg.uninstallArguments() == ["uninstall", "--yes", "--keep-data"])
    }

    @Test func wipeOmitsKeepData() {
        let cfg = UninstallConfig(keepData: false)
        #expect(cfg.uninstallArguments() == ["uninstall", "--yes"])
    }
}
