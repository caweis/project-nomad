import Foundation

/// Mirrors nomad's model-tier table (install/macos/nomad:322-382). Pure; no I/O.
enum ModelTier: String, CaseIterable, Identifiable, Sendable {
    case tiny, small, medium, large, xl, dreamy

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .tiny: "Tiny"
        case .small: "Small"
        case .medium: "Medium"
        case .large: "Large"
        case .xl: "XL"
        case .dreamy: "Dreamy"
        }
    }

    /// Approx download total in GB (nomad tier_size_gb, nomad:352-362).
    var approxPullGB: Int {
        switch self {
        case .tiny: 3
        case .small: 22
        case .medium: 59
        case .large: 90
        case .xl: 155
        case .dreamy: 257
        }
    }

    /// Mirror of nomad auto_tier(): integer-GB floor of physical memory → tier.
    static func auto(forPhysicalMemoryBytes bytes: UInt64) -> ModelTier {
        let gb = Int(bytes / 1_073_741_824)
        switch gb {
        case ..<12: return .tiny
        case ..<20: return .small
        case ..<40: return .medium
        case ..<72: return .large
        case ..<128: return .xl
        default: return .dreamy
        }
    }

    /// Auto-detected tier for this machine.
    static var autoDetected: ModelTier {
        auto(forPhysicalMemoryBytes: ProcessInfo.processInfo.physicalMemory)
    }
}
