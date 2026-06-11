import Testing
import Foundation
@testable import NomadInstaller

/// Thread-safe line collector (PTYRunner calls onLine off the test's thread).
private final class LineCollector: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [InstallLine] = []
    func add(_ l: InstallLine) { lock.lock(); items.append(l); lock.unlock() }
    var all: [InstallLine] { lock.lock(); defer { lock.unlock() }; return items }
}

@Suite struct PTYRunnerTests {
    /// A fake "installer": prints a section + a step, mimics a password prompt,
    /// then echoes whether it received the reply.
    private func writeFakeScript() throws -> URL {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("ptyrunner-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let script = """
        #!/usr/bin/env bash
        printf '\\033[1;34m── Setup ──\\033[0m\\n'
        printf '==> doing a thing\\n'
        printf 'Password:'
        read -r PW
        printf '\\n ✓ got:%s\\n' "$PW"
        """
        let url = dir.appendingPathComponent("fake")
        try script.write(to: url, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        return url
    }

    // Regression: PTYs emit CRLF and Swift treats "\r\n" as one Character, so a
    // Character search for "\n" misses it. Splitting must work on the LF scalar.
    @Test func splitsCRLFAndKeepsPartialResidue() {
        var buf = "── Setup ──\r\n==> step\r\nPassw"
        let lines = PTYRunner.takeCompleteLines(&buf)
        #expect(lines == ["── Setup ──", "==> step"])
        #expect(buf == "Passw") // partial (no newline) retained as residue
    }

    @Test func splitsBareLF() {
        var buf = "a\nb\n"
        let lines = PTYRunner.takeCompleteLines(&buf)
        #expect(lines == ["a", "b"])
        #expect(buf == "")
    }

    @Test func streamsMilestonesAndAnswersPrompt() async throws {
        let fake = try writeFakeScript()
        let collector = LineCollector()
        let runner = PTYRunner()

        let exit = try await runner.run(
            command: fake.path,
            arguments: [],
            onLine: { collector.add($0) },
            passwordProvider: { "hunter2" }
        )

        let lines = collector.all
        #expect(exit == 0)
        #expect(lines.contains(InstallLine(kind: .section("Setup"))))
        #expect(lines.contains(InstallLine(kind: .step("doing a thing"))))
        #expect(lines.contains(InstallLine(kind: .prompt)))
        #expect(lines.contains(where: {
            if case let .success(t) = $0.kind { return t.contains("got:hunter2") }
            return false
        }))
    }
}
