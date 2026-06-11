import SwiftUI

// MARK: - HeroCard

/// Headline summary card with a left-edge color rail.
///
/// Used for "what's happening right now" surfaces — active agents,
/// thread status, queued messages. Mirrors Caregiver's `HeroSummaryCard`
/// pattern: tiny uppercase eyebrow + icon, then a single-paragraph body
/// the user reads at a glance.
///
/// `railColor` defaults to the brand primary; pass a status hue
/// (`BrandColors.success`, `.warn`, `.error`, or an `AgentPalette.color`)
/// to encode meaning in the rail without changing copy.
struct HeroCard: View {
    let eyebrow: String
    let message: String
    var railColor: Color = BrandColors.primary
    var icon: String = "sparkles"

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 12))
                    .foregroundStyle(railColor)
                Text(eyebrow.uppercased())
                    .font(BrandFonts.sectionEyebrow)
                    .tracking(0.8)
                    .foregroundStyle(BrandColors.inkMuted)
            }
            Text(message)
                .font(BrandFonts.body)
                .foregroundStyle(BrandColors.inkStrong)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(BrandColors.surface)
                .overlay(
                    Rectangle()
                        .fill(railColor)
                        .frame(width: 3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(BrandColors.hairline, lineWidth: 0.5)
        )
    }
}

// MARK: - InsetCard

/// Generic 14pt rounded card with a hairline border, used to wrap any
/// content that should read as a grouped iOS-Settings-style block. The
/// surface tracks light/dark via `BrandColors.surface`.
///
/// For multi-row groupings, render each row as a child and put `Divider`
/// between them — the divider should be indented to match the icon
/// column so it doesn't slice through the avatar.
struct InsetCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(BrandColors.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(BrandColors.hairline, lineWidth: 0.5)
            )
    }
}

// MARK: - SectionHeader

/// UPPERCASE letter-tracked header used above grouped lists (iOS Settings
/// pattern). 16pt horizontal padding so it lines up with the leading edge
/// of the card directly underneath.
struct SectionHeader: View {
    let title: String
    var body: some View {
        Text(title.uppercased())
            .font(BrandFonts.sectionHeader)
            .tracking(0.8)
            .foregroundStyle(BrandColors.inkMuted)
            .padding(.horizontal, 16)
            .padding(.bottom, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - AgentAvatar

/// Circular avatar showing the agent's initials, tinted with the agent's
/// deterministic color from `AgentPalette`. Used in chat bubbles, thread
/// list rows, mention chips, and participant strips.
///
/// Optional `agentName` lets the caller override the hash source — useful
/// for system avatars ("system", "you") that should always render in a
/// fixed tint regardless of display name.
struct AgentAvatar: View {
    let name: String
    var size: CGFloat = 36
    var tintOverride: Color?

    private var initials: String {
        let cleaned = name
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
        let parts = cleaned.split(separator: " ").prefix(2)
        let chars = parts.compactMap { $0.first.map(String.init) }
        return chars.joined().uppercased()
    }

    private var tint: Color {
        tintOverride ?? AgentPalette.color(for: name)
    }

    var body: some View {
        ZStack {
            Circle().fill(tint)
            Text(initials)
                .font(.system(size: size * 0.42, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
    }
}

// MARK: - AppIconBadge

/// In-app render of the OpenAgents app icon. Mirrors the master PNG that
/// `scripts/render-app-icon.swift` produces for `AppIcon.appiconset/` —
/// coral gradient (primaryHi → primary, top-leading → bottom-trailing),
/// white chat-bubble glyph, baked squircle corner (≈22% of size to match
/// Apple's ratio).
///
/// Used wherever the app needs to display its own icon outside the system
/// chrome (login screen on iOS where `UIImage(named: "AppIcon")` returns
/// nil, workspace selector on iOS for the same reason). On macOS prefer
/// `NSApp.applicationIconImage` so the rendered icon picks up any
/// user-set custom icon, falling back to this badge.
struct AppIconBadge: View {
    var size: CGFloat = 72

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.225, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [BrandColors.primaryHi, BrandColors.primary],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing,
                )
            )
            .overlay(
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: size * 0.5, weight: .semibold))
                    .foregroundStyle(.white)
                    .shadow(color: .black.opacity(0.15), radius: size * 0.05, y: size * 0.025),
            )
            .frame(width: size, height: size)
    }
}

// MARK: - Previews

#if DEBUG
#Preview("HeroCard") {
    VStack(spacing: 12) {
        HeroCard(
            eyebrow: "3 agents working",
            message: "Bary-Agent is researching the training program, Codex is editing files in /brain.",
            railColor: BrandColors.primary,
            icon: "sparkles"
        )
        HeroCard(
            eyebrow: "session restarted",
            message: "Next message starts fresh — prior context cleared.",
            railColor: BrandColors.warn,
            icon: "arrow.clockwise"
        )
    }
    .padding()
    .background(BrandColors.bg)
}

#Preview("InsetCard") {
    InsetCard {
        VStack(spacing: 0) {
            ForEach(["Channel one", "Channel two", "Channel three"], id: \.self) { name in
                HStack(spacing: 12) {
                    AgentAvatar(name: name, size: 36)
                    Text(name)
                        .font(BrandFonts.headline)
                        .foregroundStyle(BrandColors.inkStrong)
                    Spacer()
                }
                .padding(.vertical, 10)
                .padding(.horizontal, 14)
                if name != "Channel three" {
                    Divider().padding(.leading, 60)
                }
            }
        }
    }
    .padding()
    .background(BrandColors.bg)
}

#Preview("AgentAvatar palette") {
    HStack(spacing: 12) {
        ForEach(["Bary-Agent", "Codex", "Maggie", "Tian", "Josh", "system"], id: \.self) { n in
            AgentAvatar(name: n, size: 44)
        }
    }
    .padding()
    .background(BrandColors.bg)
}
#endif
