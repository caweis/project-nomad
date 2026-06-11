import Testing
@testable import NomadInstaller

@Suite struct SmokeTests {
    @Test func packageImports() {
        // Proves the test target can @testable import the app target.
        #expect(Bool(true))
    }
}
