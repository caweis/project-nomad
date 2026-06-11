import CPTY
import Darwin
import Foundation

/// Runs `bash nomad install …` inside a pseudo-terminal, streams each parsed
/// output line to `onLine`, and answers the sudo prompt via `passwordProvider`.
/// Stateless and Sendable. The blocking read loop holds one background thread for
/// the install's duration — fine for a single one-shot installer.
struct PTYRunner: Sendable {
    enum PTYError: Error { case spawnFailed }

    func run(
        command: String,
        arguments: [String],
        onLine: @escaping @Sendable (InstallLine) -> Void,
        passwordProvider: @escaping @Sendable () async -> String?
    ) async throws -> Int32 {
        // Build: exec bash '<nomad>' '<arg>' …  (quoted; runs via bash so +x isn't required)
        let quoted = ([command] + arguments)
            .map { "'" + $0.replacingOccurrences(of: "'", with: "'\\''") + "'" }
        let shell = "exec bash " + quoted.joined(separator: " ")

        var master: Int32 = -1
        let pid = shell.withCString { cpty_spawn_bash($0, &master) }
        guard pid > 0, master >= 0 else { throw PTYError.spawnFailed }

        var pending = ""
        let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
        defer { buf.deallocate() }

        loop: while true {
            let n = read(master, buf, 4096)
            if n <= 0 { break loop } // <= 0 includes EIO, which a PTY returns when the child exits

            pending += String(decoding: UnsafeBufferPointer(start: buf, count: n), as: UTF8.self)

            // The PTY emits CRLF, and Swift treats "\r\n" as a single Character — so a
            // Character search for "\n" never matches. Split on the LF *scalar* instead.
            for line in Self.takeCompleteLines(&pending) {
                onLine(InstallOutputParser.classify(line))
            }

            // The sudo prompt has no trailing newline; it sits in the residue.
            if InstallOutputParser.classify(pending).kind == .prompt {
                onLine(InstallLine(kind: .prompt))
                guard let pw = await passwordProvider() else { break loop } // user cancelled
                var line = pw + "\n"
                _ = line.withCString { write(master, $0, strlen($0)) }
                line.removeAll(keepingCapacity: false) // best-effort scrub
                pending = "" // re-arm: a re-prompt (typo) arrives as fresh bytes
            }
        }

        close(master)
        var status: Int32 = 0
        waitpid(pid, &status, 0)
        return Self.exitCode(from: status)
    }

    /// Removes and returns every complete LF-terminated line from `pending`,
    /// stripping a trailing CR (PTYs emit CRLF). The partial remainder stays.
    static func takeCompleteLines(_ pending: inout String) -> [String] {
        let scalars = Array(pending.unicodeScalars)
        var lines: [String] = []
        var start = 0
        var i = 0
        while i < scalars.count {
            if scalars[i] == "\n" {
                var end = i
                if end > start && scalars[end - 1] == "\r" { end -= 1 }
                var line = ""
                line.unicodeScalars.append(contentsOf: scalars[start..<end])
                lines.append(line)
                start = i + 1
            }
            i += 1
        }
        var rest = ""
        rest.unicodeScalars.append(contentsOf: scalars[start...])
        pending = rest
        return lines
    }

    /// WIFEXITED ? WEXITSTATUS : 128 + signal.
    private static func exitCode(from status: Int32) -> Int32 {
        (status & 0x7f) == 0 ? (status >> 8) & 0xff : 128 + (status & 0x7f)
    }
}
