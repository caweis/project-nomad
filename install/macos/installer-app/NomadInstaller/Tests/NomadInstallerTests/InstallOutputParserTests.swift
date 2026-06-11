import Testing
@testable import NomadInstaller

@Suite struct InstallOutputParserTests {
    let ESC = "\u{1B}"

    @Test func stripsANSI() {
        let s = "\(ESC)[1;34m==>\(ESC)[0m installing Homebrew"
        #expect(InstallOutputParser.stripANSI(s) == "==> installing Homebrew")
    }

    @Test func classifiesSection() {
        let line = "\(ESC)[1;34m── Docker / OrbStack ──\(ESC)[0m"
        #expect(InstallOutputParser.classify(line).kind == .section("Docker / OrbStack"))
    }

    @Test func classifiesStepSuccessWarnError() {
        #expect(InstallOutputParser.classify("==> pulling models").kind == .step("pulling models"))
        #expect(InstallOutputParser.classify(" ✓ Homebrew ready").kind == .success("Homebrew ready"))
        #expect(InstallOutputParser.classify(" ⚠ low disk").kind == .warning("low disk"))
        #expect(InstallOutputParser.classify(" ✗ failed to pull").kind == .error("failed to pull"))
    }

    @Test func classifiesSudoPrompt() {
        #expect(InstallOutputParser.classify("Password:").kind == .prompt)
        #expect(InstallOutputParser.classify("Password: ").kind == .prompt)
    }

    @Test func unrecognizedIsRaw() {
        #expect(InstallOutputParser.classify("just some text").kind == .raw("just some text"))
    }
}
