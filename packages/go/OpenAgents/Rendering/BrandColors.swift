import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// OpenAgents brand palette — "Graphite + warm coral". Single source of truth
/// for every brand-tinted surface, ink, and accent the Swift apps render.
///
/// Pattern mirrors the Caregiver app's `BrandColors` enum (keep all tokens
/// visible at one read; no asset-catalog churn) but with OpenAgents' own
/// identity: warm-graphite dark surfaces and a coral accent that reads as
/// "agent activity" without veering into Slack/Linear corporate blue.
///
/// Dark mode is the primary surface — agent platforms feel right in dark
/// chrome. Light mode tokens are defined for system-follow but not
/// per-screen polished; if you're auditing light mode and it feels off,
/// that's expected for this pass.
///
/// Hex references are anchors only — the SwiftUI values resolve from
/// per-mode literals so dynamic-color switching tracks the system trait.
enum BrandColors {

    // MARK: - Surfaces (background → cards → raised)

    static let bg        = dynamic(dark: hex(0x14161A), light: hex(0xFBF8F4))
    static let surface   = dynamic(dark: hex(0x1C1F24), light: hex(0xFFFFFF))
    static let surfaceHi = dynamic(dark: hex(0x242830), light: hex(0xF5F1EB))
    static let hairline  = dynamic(dark: hex(0x2A2E36), light: hex(0xE5DFD5))

    // MARK: - Ink (text in priority order)

    static let inkStrong = dynamic(dark: hex(0xF5F2EE), light: hex(0x14161A))
    static let ink       = dynamic(dark: hex(0xD8D2C8), light: hex(0x2A2620))
    static let inkMuted  = dynamic(dark: hex(0x9A9489), light: hex(0x6B665D))
    static let inkFaint  = dynamic(dark: hex(0x6B665D), light: hex(0x9A9489))

    // MARK: - Brand

    /// Coral accent — replaces every prior use of `.accentColor` / `.blue`.
    /// Used for: primary buttons, send button, selection, focus rings,
    /// active-thread highlight, "agent working" pulse.
    static let primary   = dynamic(dark: hex(0xFF6B5B), light: hex(0xE55B4D))
    static let primaryHi = dynamic(dark: hex(0xFFB199), light: hex(0xC9483B))

    /// Soft coral glow — agent-working shimmer / pulse. Dimmer than primary
    /// so it doesn't compete with foreground content.
    static let activity  = dynamic(dark: hex(0xFFB199), light: hex(0xFF8A7A))

    // MARK: - Status

    static let warn      = dynamic(dark: hex(0xF59E0B), light: hex(0xD97706))
    static let error     = dynamic(dark: hex(0xDC2626), light: hex(0xB91C1C))
    static let success   = dynamic(dark: hex(0x10B981), light: hex(0x059669))

    // MARK: - Agent tag palette (jewel tones harmonized with coral)

    /// Six hand-picked hues used by `AgentPalette.color(for:)` to assign a
    /// deterministic per-agent accent. All warm-leaning or jewel-toned so
    /// they sit alongside the coral primary without clashing.
    static let agentCoral    = dynamic(dark: hex(0xFF6B5B), light: hex(0xE55B4D))
    static let agentAmber    = dynamic(dark: hex(0xF59E0B), light: hex(0xD97706))
    static let agentSage     = dynamic(dark: hex(0x10B981), light: hex(0x059669))
    static let agentLavender = dynamic(dark: hex(0xA78BFA), light: hex(0x7C3AED))
    static let agentSky      = dynamic(dark: hex(0x38BDF8), light: hex(0x0284C7))
    static let agentRose     = dynamic(dark: hex(0xFB7185), light: hex(0xE11D48))

    static let agentTints: [Color] = [
        agentCoral, agentAmber, agentSage, agentLavender, agentSky, agentRose,
    ]

    // MARK: - Helpers

    /// Build a hex `Color` (no alpha — surfaces never need transparency at
    /// this layer; reach for `.opacity()` at the call site when you do).
    private static func hex(_ value: UInt32) -> Color {
        let r = Double((value >> 16) & 0xFF) / 255.0
        let g = Double((value >> 8) & 0xFF) / 255.0
        let b = Double(value & 0xFF) / 255.0
        return Color(red: r, green: g, blue: b)
    }

    /// Build a dynamic `Color` that resolves differently in light vs dark.
    /// SwiftUI's `Color(uiColor:)` / `Color(nsColor:)` already track the
    /// system trait collection, so a single instance handles both modes
    /// without per-view `@Environment(\.colorScheme)` checks.
    private static func dynamic(dark: Color, light: Color) -> Color {
        #if canImport(UIKit)
        return Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(dark)
                : UIColor(light)
        })
        #elseif canImport(AppKit)
        return Color(NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .vibrantDark, .aqua]).map {
                $0 == .darkAqua || $0 == .vibrantDark
            } ?? false
            return isDark ? NSColor(dark) : NSColor(light)
        })
        #else
        return dark
        #endif
    }
}
