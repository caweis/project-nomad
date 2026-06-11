import Testing
@testable import NomadInstaller

@Suite struct AIBackendTests {
    // Mirror nomad backend_eligible() (nomad:397-401): arm64 && macOS major >= 15.
    @Test func omlxEligibility() {
        #expect(AIBackend.omlxEligible(arch: "arm64", osMajor: 15) == true)
        #expect(AIBackend.omlxEligible(arch: "arm64", osMajor: 26) == true)
        #expect(AIBackend.omlxEligible(arch: "arm64", osMajor: 14) == false)
        #expect(AIBackend.omlxEligible(arch: "x86_64", osMajor: 15) == false)
    }

    @Test func recommendedFollowsEligibility() {
        #expect(AIBackend.recommended(arch: "arm64", osMajor: 15) == .omlx)
        #expect(AIBackend.recommended(arch: "arm64", osMajor: 14) == .ollama)
        #expect(AIBackend.recommended(arch: "x86_64", osMajor: 26) == .ollama)
    }
}
