import Foundation

/// One classified line of `nomad install` output.
struct InstallLine: Identifiable, Sendable, Equatable {
    enum Kind: Equatable, Sendable {
        case section(String)   // ── TEXT ──  (milestone / phase header)
        case step(String)      // ==> TEXT
        case success(String)   //  ✓ TEXT
        case warning(String)   //  ⚠ TEXT
        case error(String)     //  ✗ TEXT
        case prompt            // sudo "Password:"
        case raw(String)
    }

    let id = UUID()
    let kind: Kind

    init(kind: Kind) { self.kind = kind }

    // Identity for display is the line content, not the generated UUID.
    static func == (lhs: InstallLine, rhs: InstallLine) -> Bool { lhs.kind == rhs.kind }
}
