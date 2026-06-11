import SwiftUI

/// Vertical icon rail that lives on the left edge of the Mac/iPad
/// workspace window. Same role as the iPhone tab bar in `WorkspaceView`
/// — switches between the `AppDestination`s — but oriented vertically
/// to match the WhatsApp / Slack desktop pattern. ~64pt wide.
///
/// Layout (top → bottom):
///   - Workspace tile (tap to switch)
///   - Divider
///   - Chats, Inbox (active destinations on this surface)
///   - Spacer
///   - Settings (pinned to the bottom)
///
/// Selection state is driven by the parent's `AppDestination` binding;
/// tapping any icon mutates it. Active icon renders in brand-primary
/// with a soft tinted background; inactive icons are muted.
struct IconRailView: View {
    @Binding var destination: AppDestination
    let workspaceName: String
    /// Per-destination unread counts. Missing key = 0. Settings doesn't
    /// carry an unread state, so it's never read from this map.
    let unreadCounts: [AppDestination: Int]
    let onSwitchWorkspace: () -> Void

    private let topDestinations: [AppDestination] = [.chats, .inbox]

    var body: some View {
        VStack(spacing: 8) {
            workspaceTile
                .padding(.top, 12)

            Divider().padding(.horizontal, 14)

            ForEach(topDestinations) { d in
                railButton(d)
            }

            Spacer()

            railButton(.settings)
                .padding(.bottom, 12)
        }
        .frame(width: 64)
        .frame(maxHeight: .infinity)
        .background(BrandColors.surface)
        .overlay(
            Rectangle()
                .fill(BrandColors.hairline)
                .frame(width: 0.5),
            alignment: .trailing,
        )
    }

    private var workspaceTile: some View {
        Button(action: onSwitchWorkspace) {
            ZStack {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [BrandColors.primaryHi, BrandColors.primary],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing,
                        )
                    )
                Text(workspaceInitial)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(.white)
            }
            .frame(width: 40, height: 40)
        }
        .buttonStyle(.plain)
        .help("Switch workspace (\(workspaceName))")
    }

    private var workspaceInitial: String {
        workspaceName.first.map { String($0).uppercased() } ?? "•"
    }

    private func railButton(_ d: AppDestination) -> some View {
        let isActive = destination == d
        let unread = unreadCounts[d] ?? 0
        return Button {
            destination = d
        } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: isActive ? d.iconFilled : d.icon)
                    .font(.system(size: 18, weight: isActive ? .semibold : .regular))
                    .foregroundStyle(isActive ? BrandColors.primary : BrandColors.inkMuted)
                    .frame(width: 40, height: 40)
                    .background(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .fill(isActive ? BrandColors.primary.opacity(0.12) : .clear),
                    )
                if unread > 0 {
                    UnreadBadge(count: unread)
                        .offset(x: 6, y: -4)
                }
            }
            .frame(width: 46, height: 44)
        }
        .buttonStyle(.plain)
        .help(unread > 0 ? "\(d.label) (\(unread) unread)" : d.label)
    }
}

/// Compact count badge — green pill, white text, capped at "99+".
/// Matches the WhatsApp Mac convention for unread counts on the rail.
private struct UnreadBadge: View {
    let count: Int

    private var label: String {
        count > 99 ? "99+" : "\(count)"
    }

    var body: some View {
        Text(label)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .frame(minWidth: 16)
            .background(Capsule().fill(BrandColors.success))
            .overlay(Capsule().stroke(BrandColors.surface, lineWidth: 1.5))
    }
}
