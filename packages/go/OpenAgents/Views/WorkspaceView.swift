import SwiftUI

/// Owns the active `AppDestination` for the current workspace and routes
/// to the matching surface.
///
/// **iPhone (compact):** `TabView` with three tabs — Chats / Inbox /
/// Settings — each backed by a NavigationSplitView that auto-collapses
/// to a NavigationStack on the phone. Replaces the pre-v0.6 segmented
/// control + sidebar-footer pattern.
///
/// **iPad / Mac:** still the existing 2-column NavigationSplitView. The
/// destination toggles content in the leading column via the segmented
/// picker inside `ThreadListView`; Phase 4 of issue #13 replaces that
/// with a left icon rail. Settings is rendered full-screen when
/// destination switches.
struct WorkspaceView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(AppRouter.self) private var router
    @StateObject private var sessionRead = SessionReadStore.shared

    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var destination: AppDestination = .chats

    /// Per-destination unread counts derived from `WorkspaceStore` + the
    /// shared `SessionReadStore`. Recomputed each render — cheap because
    /// session lists are O(tens), not O(thousands).
    private var unreadCounts: [AppDestination: Int] {
        var counts: [AppDestination: Int] = [:]
        for session in store.activeSessions {
            guard sessionRead.isUnread(
                workspaceId: store.workspaceId,
                sessionId: session.sessionId,
                lastEventAt: session.lastEventAt,
            ) else { continue }
            let bucket: AppDestination = session.isRoutineChannel ? .inbox : .chats
            counts[bucket, default: 0] += 1
        }
        return counts
    }

    var body: some View {
        #if os(iOS)
        iPhoneTabBar
        #else
        macSplit
        #endif
    }

    // MARK: - iPhone

    #if os(iOS)
    private var iPhoneTabBar: some View {
        let counts = unreadCounts
        return TabView(selection: $destination) {
            destinationTab(.chats, badge: counts[.chats] ?? 0) {
                NavigationSplitView {
                    ThreadListView(destination: $destination)
                } detail: {
                    ChatView()
                }
                .navigationSplitViewStyle(.balanced)
            }
            destinationTab(.inbox, badge: counts[.inbox] ?? 0) {
                NavigationSplitView {
                    ThreadListView(destination: $destination)
                } detail: {
                    ChatView()
                }
                .navigationSplitViewStyle(.balanced)
            }
            destinationTab(.settings, badge: 0) {
                NavigationStack {
                    SettingsTabContent()
                        .navigationTitle("Settings")
                        .navigationBarTitleDisplayMode(.large)
                }
            }
        }
        .tint(BrandColors.primary)
    }

    @ViewBuilder
    private func destinationTab<Content: View>(
        _ d: AppDestination,
        badge: Int,
        @ViewBuilder content: () -> Content,
    ) -> some View {
        content()
            .tabItem {
                Label(d.label, systemImage: destination == d ? d.iconFilled : d.icon)
            }
            .badge(badge > 0 ? badge : 0)
            .tag(d)
    }
    #endif

    // MARK: - Mac (Phase 4 will replace this with an icon rail)

    #if os(macOS)
    private var macSplit: some View {
        HStack(spacing: 0) {
            IconRailView(
                destination: $destination,
                workspaceName: store.workspace?.name ?? "Workspace",
                unreadCounts: unreadCounts,
                onSwitchWorkspace: { router.switchWorkspace() },
            )
            macDestinationContent
        }
    }

    @ViewBuilder
    private var macDestinationContent: some View {
        switch destination {
        case .chats, .inbox:
            NavigationSplitView(columnVisibility: $columnVisibility) {
                ThreadListView(destination: $destination)
                    .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 400)
            } detail: {
                ChatView()
            }
            .navigationSplitViewStyle(.balanced)
        case .settings:
            SettingsTabContent()
        }
    }
    #endif
}
