import SwiftUI

/// Deterministic per-agent accent color.
///
/// Pulls from `BrandColors.agentTints` — six jewel tones harmonized with the
/// coral primary so the workspace never lights up with arbitrary system
/// hues. Hash is djb2 over UTF-8 bytes (stable across processes, devices,
/// and the future web port), so the same agent name always maps to the
/// same tint everywhere it appears: avatar fill, mention chip, participant
/// dot, channel header underline.
enum AgentPalette {
    static let colors: [Color] = BrandColors.agentTints

    static func color(for agentName: String) -> Color {
        var hash: UInt64 = 5381
        for byte in agentName.utf8 {
            hash = ((hash << 5) &+ hash) &+ UInt64(byte)
        }
        return colors[Int(hash % UInt64(colors.count))]
    }
}
