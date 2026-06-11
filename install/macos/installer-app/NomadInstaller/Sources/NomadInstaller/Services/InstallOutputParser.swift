import Foundation

/// Classifies `nomad install` output lines into milestones/steps/status. Pure.
/// Keys on the CLI's stable output helpers (install/macos/nomad:474-478):
/// section()→ `── TEXT ──`, log()→ `==> TEXT`, ok/warn/die→ ` ✓/⚠/✗ TEXT`.
enum InstallOutputParser {
    private static let ansi = try! NSRegularExpression(pattern: "\u{1B}\\[[0-9;]*m")
    private static let section = try! NSRegularExpression(pattern: "^──\\s*(.+?)\\s*──$")

    static func stripANSI(_ s: String) -> String {
        let r = NSRange(s.startIndex..., in: s)
        return ansi.stringByReplacingMatches(in: s, range: r, withTemplate: "")
    }

    static func classify(_ rawLine: String) -> InstallLine {
        let clean = stripANSI(rawLine).trimmingCharacters(in: .whitespaces)

        if clean.hasPrefix("Password:") { return InstallLine(kind: .prompt) }

        let r = NSRange(clean.startIndex..., in: clean)
        if let m = section.firstMatch(in: clean, range: r), let g = Range(m.range(at: 1), in: clean) {
            return InstallLine(kind: .section(String(clean[g])))
        }
        if clean.hasPrefix("==>") {
            return InstallLine(kind: .step(clean.dropFirst(3).trimmingCharacters(in: .whitespaces)))
        }
        if let rest = leadingGlyphBody("✓", clean) { return InstallLine(kind: .success(rest)) }
        if let rest = leadingGlyphBody("⚠", clean) { return InstallLine(kind: .warning(rest)) }
        if let rest = leadingGlyphBody("✗", clean) { return InstallLine(kind: .error(rest)) }
        return InstallLine(kind: .raw(clean))
    }

    /// Returns the text after `glyph` only when the (already-trimmed) line starts with it.
    private static func leadingGlyphBody(_ glyph: Character, _ s: String) -> String? {
        guard let first = s.first, first == glyph else { return nil }
        return String(s.dropFirst()).trimmingCharacters(in: .whitespaces)
    }
}
