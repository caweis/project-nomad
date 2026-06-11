import Testing
@testable import NomadInstaller

@Suite struct ModelTierTests {
    private func gb(_ n: UInt64) -> UInt64 { n * 1_073_741_824 }

    // Mirror of nomad auto_tier() (nomad:372-382): floor(bytes / 1024^3) → tier.
    @Test func autoLadderMatchesCLI() {
        #expect(ModelTier.auto(forPhysicalMemoryBytes: gb(8)) == .tiny)
        #expect(ModelTier.auto(forPhysicalMemoryBytes: gb(12)) == .small) // 12 is not < 12
        #expect(ModelTier.auto(forPhysicalMemoryBytes: gb(16)) == .small)
        #expect(ModelTier.auto(forPhysicalMemoryBytes: gb(24)) == .medium)
        #expect(ModelTier.auto(forPhysicalMemoryBytes: gb(39)) == .medium)
        #expect(ModelTier.auto(forPhysicalMemoryBytes: gb(64)) == .large)
        #expect(ModelTier.auto(forPhysicalMemoryBytes: gb(96)) == .xl)
        #expect(ModelTier.auto(forPhysicalMemoryBytes: gb(128)) == .dreamy)
        #expect(ModelTier.auto(forPhysicalMemoryBytes: gb(192)) == .dreamy)
    }

    @Test func pullSizesMatchCLI() {
        #expect(ModelTier.tiny.approxPullGB == 3)
        #expect(ModelTier.small.approxPullGB == 22)
        #expect(ModelTier.medium.approxPullGB == 59)
        #expect(ModelTier.large.approxPullGB == 90)
        #expect(ModelTier.xl.approxPullGB == 155)
        #expect(ModelTier.dreamy.approxPullGB == 257)
    }
}
