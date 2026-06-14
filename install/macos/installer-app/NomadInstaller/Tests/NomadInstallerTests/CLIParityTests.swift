import Testing
import Foundation
@testable import NomadInstaller

/// Cascade alarm for the canonical-data audit (Maxim 4/5). The installer mirrors
/// data from the canonical CLI (install/macos/nomad) into Swift; these tests read
/// the real CLI and fail the build the moment a Swift constant drifts from it.
@Suite struct CLIParityTests {

    // MARK: - Locate + read the canonical CLI

    /// Walk up from this test's source file to the install/macos dir (the one that
    /// holds both `nomad` and `compose.yaml`) and return the nomad path.
    static func nomadSource() throws -> String {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        for _ in 0..<12 {
            let nomad = dir.appendingPathComponent("nomad")
            let compose = dir.appendingPathComponent("compose.yaml")
            if FileManager.default.fileExists(atPath: nomad.path),
               FileManager.default.fileExists(atPath: compose.path) {
                return try String(contentsOf: nomad, encoding: .utf8)
            }
            dir = dir.deletingLastPathComponent()
        }
        Issue.record("Could not locate the canonical install/macos/nomad from \(#filePath)")
        throw CLIParityError.cliNotFound
    }

    enum CLIParityError: Error { case cliNotFound }

    /// Extract a bash function body: from `name() {` to the next line-leading `}`.
    static func functionBody(_ name: String, in source: String) -> String? {
        guard let re = try? NSRegularExpression(pattern: "\(NSRegularExpression.escapedPattern(for: name))\\(\\)\\s*\\{") else { return nil }
        let ns = source as NSString
        guard let m = re.firstMatch(in: source, range: NSRange(location: 0, length: ns.length)) else { return nil }
        let after = ns.substring(from: m.range.location + m.range.length)
        if let end = after.range(of: "\n}") { return String(after[..<end.lowerBound]) }
        return after
    }

    static func ints(matching pattern: String, in text: String) -> [Int] {
        guard let re = try? NSRegularExpression(pattern: pattern) else { return [] }
        let ns = text as NSString
        return re.matches(in: text, range: NSRange(location: 0, length: ns.length)).compactMap {
            Int(ns.substring(with: $0.range(at: 1)))
        }
    }

    // MARK: - #1 Tier names

    @Test func tierNamesMatchCLI() throws {
        let src = try Self.nomadSource()
        for tier in ModelTier.allCases {
            let marker = "TIER_\(tier.rawValue.uppercased())="
            #expect(src.contains(marker), "CLI is missing \(marker) for ModelTier.\(tier.rawValue)")
        }
    }

    // MARK: - #2 RAM → tier ladder

    @Test func ramLadderMatchesCLI() throws {
        let src = try Self.nomadSource()
        let body = try #require(Self.functionBody("auto_tier", in: src), "auto_tier() not found")
        let cliThresholds = Self.ints(matching: "-lt\\s+(\\d+)", in: body)
        #expect(cliThresholds == ModelTier.autoThresholdsGB,
                "RAM ladder drifted — CLI \(cliThresholds) vs Swift \(ModelTier.autoThresholdsGB)")
    }

    // MARK: - #3 Tier pull sizes

    @Test func tierSizesMatchCLI() throws {
        let src = try Self.nomadSource()
        let body = try #require(Self.functionBody("tier_size_gb", in: src), "tier_size_gb() not found")
        let re = try NSRegularExpression(pattern: "(tiny|small|medium|large|xl|dreamy)\\)\\s*echo\\s+(\\d+)")
        let ns = body as NSString
        var cliSizes: [String: Int] = [:]
        for m in re.matches(in: body, range: NSRange(location: 0, length: ns.length)) {
            cliSizes[ns.substring(with: m.range(at: 1))] = Int(ns.substring(with: m.range(at: 2)))
        }
        for tier in ModelTier.allCases {
            #expect(cliSizes[tier.rawValue] == tier.approxPullGB,
                    "Pull size drifted for \(tier.rawValue) — CLI \(cliSizes[tier.rawValue] ?? -1) vs Swift \(tier.approxPullGB)")
        }
    }

    // MARK: - #4 oMLX eligibility

    @Test func backendEligibilityMatchesCLI() throws {
        let src = try Self.nomadSource()
        let body = try #require(Self.functionBody("backend_eligible", in: src), "backend_eligible() not found")
        #expect(body.contains(AIBackend.requiredArch),
                "CLI eligibility no longer references arch '\(AIBackend.requiredArch)'")
        let minOS = Self.ints(matching: "-ge\\s+(\\d+)", in: body)
        #expect(minOS.contains(AIBackend.omlxMinOSMajor),
                "oMLX min macOS drifted — CLI \(minOS) vs Swift \(AIBackend.omlxMinOSMajor)")
    }

    // MARK: - #5 Install flags

    @Test func installFlagsAreAcceptedByCLI() throws {
        let src = try Self.nomadSource()
        // Every flag InstallConfig can emit must be a flag the CLI parses. Cases
        // may be standalone (`--tier)`) or combined (`--yes|-y)`).
        for flag in ["--yes", "--data-root", "--tier", "--backend", "--no-models"] {
            let accepted = src.contains("\(flag))") || src.contains("\(flag)|")
            #expect(accepted, "CLI parser no longer handles \(flag)")
        }
    }

    // MARK: - #7 Data-root convention

    @Test func dataRootConventionMatchesCLI() throws {
        let src = try Self.nomadSource()
        // Internal disk → ~/project-nomad-data; external → <vol>/project-nomad.
        #expect(src.contains("project-nomad-data"),
                "CLI no longer uses the project-nomad-data internal convention")
        let external = InstallVolume(id: "/Volumes/Field", name: "Field", path: "/Volumes/Field",
                                     freeBytes: 0, totalBytes: 0, isInternal: false)
        #expect(external.dataRoot.hasSuffix("/project-nomad"))
        let internalVol = InstallVolume(id: "/", name: "Macintosh HD", path: "/",
                                        freeBytes: 0, totalBytes: 0, isInternal: true)
        #expect(internalVol.dataRoot.hasSuffix("/project-nomad-data"))
    }
}
