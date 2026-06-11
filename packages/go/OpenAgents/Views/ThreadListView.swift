import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Per-agent routine queues — each agent gets one channel
/// (`routines:<agent>`) per workspace, and every routine the agent owns
/// fires into it. These live in the Inbox tab; everything else lives
/// in Chats.
private let routineChannelPrefix = "routines:"

extension Session {
    var isRoutineChannel: Bool { sessionId.hasPrefix(routineChannelPrefix) }
    var routineAgentName: String? {
        guard isRoutineChannel else { return nil }
        return String(sessionId.dropFirst(routineChannelPrefix.count))
    }
}

/// Tracks the last "read" timestamp for every session (regular chats AND
/// routine/inbox channels) per workspace. Persisted in `UserDefaults`
/// so unread state survives app restarts.
///
/// The defaults key is still `inbox-read:<workspaceId>` for backwards
/// compatibility with the web frontend, which writes the same key
/// (routine threads only). Swift now writes regular-chat reads to the
/// same map; web ignores entries whose sessionId doesn't start with
/// `routines:`, so the two clients coexist safely. A session is
/// "unread" when its `lastEventAt > lastReadAt`.
@MainActor
final class SessionReadStore: ObservableObject {
    static let shared = SessionReadStore()

    @Published private var maps: [String: [String: Int64]] = [:]

    private init() {}

    private static func defaultsKey(workspaceId: String) -> String {
        "inbox-read:\(workspaceId)"
    }

    private func loadIfNeeded(workspaceId: String) {
        guard maps[workspaceId] == nil else { return }
        let key = Self.defaultsKey(workspaceId: workspaceId)
        if let data = UserDefaults.standard.data(forKey: key),
           let decoded = try? JSONDecoder().decode([String: Int64].self, from: data) {
            maps[workspaceId] = decoded
        } else {
            maps[workspaceId] = [:]
        }
    }

    private func persist(workspaceId: String) {
        guard let map = maps[workspaceId] else { return }
        let key = Self.defaultsKey(workspaceId: workspaceId)
        if let data = try? JSONEncoder().encode(map) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    func lastReadAt(workspaceId: String, sessionId: String) -> Int64 {
        loadIfNeeded(workspaceId: workspaceId)
        return maps[workspaceId]?[sessionId] ?? 0
    }

    func markRead(workspaceId: String, sessionId: String, timestamp: Int64?) {
        guard let ts = timestamp, ts > 0 else { return }
        loadIfNeeded(workspaceId: workspaceId)
        var map = maps[workspaceId] ?? [:]
        if (map[sessionId] ?? 0) >= ts { return }
        map[sessionId] = ts
        maps[workspaceId] = map
        persist(workspaceId: workspaceId)
    }

    func isUnread(workspaceId: String, sessionId: String, lastEventAt: Int64?) -> Bool {
        guard let ts = lastEventAt, ts > 0 else { return false }
        return ts > lastReadAt(workspaceId: workspaceId, sessionId: sessionId)
    }
}

struct ThreadListView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(AppRouter.self) private var router
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var inboxRead = SessionReadStore.shared

    /// Owned by `WorkspaceView`. The list only ever renders for `.chats`
    /// or `.inbox`; `.settings` is routed to a different surface by the
    /// parent, so this view doesn't need to handle that case in its body.
    /// The binding is still here (not just a value) because the auto-flip
    /// behaviour when navigating into a routine session needs to mutate
    /// the parent's destination.
    @Binding var destination: AppDestination

    @State private var searchText: String = ""
    @State private var newThreadOpen: Bool = false
    @State private var renamingSession: Session?
    @State private var renameDraft: String = ""

    private var filteredSessions: [Session] {
        let sessions = store.activeSessions
        let q = searchText.trimmingCharacters(in: .whitespaces).lowercased()
        if q.isEmpty { return sessions }
        return sessions.filter { $0.title.lowercased().contains(q) }
    }

    private var regularSessions: [Session] {
        filteredSessions.filter { !$0.isRoutineChannel }
    }

    private var routineSessions: [Session] {
        filteredSessions
            .filter { $0.isRoutineChannel }
            .sorted { ($0.lastEventAt ?? 0) > ($1.lastEventAt ?? 0) }
    }

    private var inboxUnreadCount: Int {
        routineSessions.filter {
            inboxRead.isUnread(
                workspaceId: store.workspaceId,
                sessionId: $0.sessionId,
                lastEventAt: $0.lastEventAt,
            )
        }.count
    }

    private var chatsUnreadCount: Int {
        regularSessions.filter {
            inboxRead.isUnread(
                workspaceId: store.workspaceId,
                sessionId: $0.sessionId,
                lastEventAt: $0.lastEventAt,
            )
        }.count
    }

    private var visibleSessions: [Session] {
        // Search spans both tabs (current behavior was searching the whole
        // session list); when the user is searching, fall back to the
        // chats tab presentation rather than splitting hits across two
        // surfaces.
        if !searchText.trimmingCharacters(in: .whitespaces).isEmpty {
            return filteredSessions
        }
        return destination == .inbox ? routineSessions : regularSessions
    }

    var body: some View {
        VStack(spacing: 0) {
            ChatListSearchField(text: $searchText)
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .padding(.bottom, 6)
            list
        }
        #if os(macOS)
        .navigationTitle(store.workspace?.name ?? "Workspace")
        .navigationSubtitle(store.workspace?.slug ?? store.workspaceId)
        #else
        // Workspace name rendered as the principal toolbar item (set
        // below). Tab bar handles destination switching; workspace
        // switching is in the Settings tab.
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            #if os(iOS)
            // Workspace name as nav title — switching is in the Settings
            // tab. Browser toggle moves to the trailing slot, the workspace
            // switch button is gone (Settings tab owns it).
            ToolbarItem(placement: .principal) {
                Text(store.workspace?.name ?? "Workspace")
                    .font(.system(size: 16, weight: .semibold))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            ToolbarItem(placement: .topBarTrailing) {
                browserToggleButton
            }
            #else
            // Mac: browser toggle next to refresh / new-chat in primary
            // actions, now that the in-list workspace header is gone.
            ToolbarItem(placement: .primaryAction) {
                browserToggleButton
            }
            #endif
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task {
                        await store.refreshDiscovery()
                        await store.refreshPreviews()
                        if let id = store.currentSessionId {
                    await store.pollNewMessages(channel: id)
                }
                    }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .help("Refresh")
                .keyboardShortcut("r", modifiers: .command)
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    newThreadOpen = true
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .help("New chat")
                .keyboardShortcut("n", modifiers: .command)
            }
        }
        .sheet(isPresented: $newThreadOpen) {
            NewThreadSheet(isPresented: $newThreadOpen)
        }
        .alert("Rename chat", isPresented: Binding(
            get: { renamingSession != nil },
            set: { if !$0 { renamingSession = nil } },
        )) {
            TextField("Title", text: $renameDraft)
            Button("Save") {
                if let session = renamingSession {
                    Task { await store.renameThread(sessionId: session.sessionId, title: renameDraft) }
                }
                renamingSession = nil
            }
            Button("Cancel", role: .cancel) { renamingSession = nil }
        }
        .onAppCommand(.newThread) { newThreadOpen = true }
        .onAppCommand(.switchWorkspace) { router.switchWorkspace() }
        .onAppCommand(.refresh) {
            Task {
                await store.refreshDiscovery()
                await store.refreshPreviews()
                if let id = store.currentSessionId {
                    await store.pollNewMessages(channel: id)
                }
            }
        }
        // Mark a session read whenever it becomes the current one — same
        // trigger for both regular chats and routine channels. For routine
        // sessions we also flip the destination to Inbox so deep links
        // (CLI / push) land the user on the right surface.
        .onChange(of: store.currentSessionId) { _, newValue in
            guard let id = newValue,
                  let session = store.sessions.first(where: { $0.sessionId == id })
            else { return }
            if session.isRoutineChannel, destination != .inbox {
                destination = .inbox
            }
            inboxRead.markRead(
                workspaceId: store.workspaceId,
                sessionId: id,
                timestamp: session.lastEventAt,
            )
        }
    }

    /// Icon-only toggle for the workspace-scoped Browser Fabric viewer. Lives
    /// next to the switch-workspace button on macOS and in the trailing
    /// toolbar slot on iOS — both sit on the same row as the workspace name
    /// so the toggle reads as a workspace-level setting, not per-thread.
    private var browserToggleButton: some View {
        let enabled = store.workspace?.browserEnabled ?? false
        return Button {
            Task { await store.setBrowserEnabled(!enabled) }
        } label: {
            Image(systemName: enabled ? "safari.fill" : "safari")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(enabled ? BrandColors.primary : Color.secondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(enabled ? "Disable browser panel" : "Enable browser panel")
        #if os(macOS)
        .help(enabled ? "Hide browser panel" : "Show browser panel when a session is live")
        #endif
        .disabled(store.workspace == nil)
    }

    @ViewBuilder
    private var list: some View {
        if store.isLoading && filteredSessions.isEmpty {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if visibleSessions.isEmpty {
            emptyState
        } else {
            List(selection: Binding<String?>(
                get: { store.currentSessionId },
                set: { id in store.selectSession(id) },
            )) {
                ForEach(visibleSessions) { session in
                    if session.isRoutineChannel {
                        RoutineThreadRow(
                            session: session,
                            lastMessage: store.lastMessageBySession[session.sessionId],
                            isUnread: inboxRead.isUnread(
                                workspaceId: store.workspaceId,
                                sessionId: session.sessionId,
                                lastEventAt: session.lastEventAt,
                            ),
                        )
                        .tag(session.sessionId)
                        #if !os(macOS)
                        .swipeActions(edge: .trailing) {
                            Button {
                                inboxRead.markRead(
                                    workspaceId: store.workspaceId,
                                    sessionId: session.sessionId,
                                    timestamp: session.lastEventAt,
                                )
                            } label: {
                                Label("Mark Read", systemImage: "envelope.open")
                            }
                            .tint(.blue)
                        }
                        #endif
                    } else {
                        ThreadRow(
                            session: session,
                            agents: store.agents,
                            lastMessage: store.lastMessageBySession[session.sessionId],
                            isUnread: inboxRead.isUnread(
                                workspaceId: store.workspaceId,
                                sessionId: session.sessionId,
                                lastEventAt: session.lastEventAt,
                            ),
                        )
                        .tag(session.sessionId)
                        #if !os(macOS)
                        .swipeActions(edge: .leading) {
                            Button {
                                Task { await store.toggleStar(sessionId: session.sessionId) }
                            } label: {
                                Label(session.starred ? "Unstar" : "Star",
                                      systemImage: session.starred ? "star.slash" : "star")
                            }
                            .tint(.yellow)
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                Task { await store.setStatus(sessionId: session.sessionId, status: "deleted") }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            Button {
                                Task { await store.setStatus(sessionId: session.sessionId, status: "archived") }
                            } label: {
                                Label("Archive", systemImage: "archivebox")
                            }
                            .tint(.gray)
                        }
                        #endif
                        .contextMenu {
                            Button {
                                renamingSession = session
                                renameDraft = session.title
                            } label: {
                                Label("Rename…", systemImage: "pencil")
                            }
                            Button {
                                Task { await store.toggleStar(sessionId: session.sessionId) }
                            } label: {
                                Label(
                                    session.starred ? "Unstar" : "Star",
                                    systemImage: session.starred ? "star.slash" : "star",
                                )
                            }
                            Button {
                                Task { await store.setStatus(sessionId: session.sessionId, status: "archived") }
                            } label: {
                                Label("Archive", systemImage: "archivebox")
                            }
                            Divider()
                            Button(role: .destructive) {
                                Task { await store.setStatus(sessionId: session.sessionId, status: "deleted") }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
            }
            .listStyle(.sidebar)
            .refreshable {
                await store.refreshDiscovery()
                await store.refreshPreviews()
                if let id = store.currentSessionId {
                    await store.pollNewMessages(channel: id)
                }
            }
        }
    }

    private var emptyState: some View {
        let isSearching = !searchText.trimmingCharacters(in: .whitespaces).isEmpty
        let isInbox = destination == .inbox && !isSearching
        let icon: String = {
            if isSearching { return "magnifyingglass" }
            return isInbox ? "tray" : "bubble.left.and.bubble.right"
        }()
        let title: String = {
            if isSearching { return "No matches" }
            return isInbox ? "Inbox is empty" : "No chats yet"
        }()
        let subtitle: String? = {
            if isSearching { return nil }
            if isInbox {
                return "Routine activity from your agents will appear here."
            }
            if !store.hasConnectedAgents {
                // No agent has joined this workspace yet — guide to connect.
                return "Connect an agent to start a conversation."
            }
            if store.onlineAgents.isEmpty {
                // Agents exist but none are online — they're connected, just
                // offline. Don't push the "connect a new agent" flow.
                return "Your agents are offline. Start one to begin a conversation."
            }
            return nil
        }()
        return VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 40))
                .foregroundStyle(BrandColors.inkFaint)
            Text(title)
                .font(.headline)
                .foregroundStyle(BrandColors.inkMuted)
            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(BrandColors.inkFaint)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            } else if !isInbox && !isSearching {
                Text("Tap \(Image(systemName: "square.and.pencil")) to start one.")
                    .font(.subheadline)
                    .foregroundStyle(BrandColors.inkFaint)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct ThreadRow: View {
    let session: Session
    let agents: [Agent]
    let lastMessage: Message?
    let isUnread: Bool

    private var sessionAgents: [Agent] {
        if session.participants.isEmpty { return agents }
        return agents.filter { session.participants.contains($0.agentName) }
    }

    private var lastActivityLabel: String {
        if let ms = session.lastEventAt {
            return RelativeTime.format(Date(timeIntervalSince1970: TimeInterval(ms) / 1000.0))
        }
        return ""
    }

    private var previewLine: String {
        guard let message = lastMessage else {
            return sessionAgents.map(\.agentName).joined(separator: ", ")
        }
        let sender = message.isFromUser ? "You" : message.senderName
        let trimmed = message.content
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return sender }
        return "\(sender): \(trimmed)"
    }

    private var isAgentWorking: Bool {
        lastMessage?.isStatus == true && !(lastMessage?.isFromUser ?? true)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            // Fixed-width unread gutter so rows align whether dotted or
            // not. Matches RoutineThreadRow.
            ZStack {
                if isUnread {
                    Circle()
                        .fill(BrandColors.primary)
                        .frame(width: 8, height: 8)
                }
            }
            .frame(width: 10)
            .padding(.top, Self.avatarSize / 2 - 4)

            AvatarStack(agents: sessionAgents, size: Self.avatarSize)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if session.starred {
                        Image(systemName: "star.fill")
                            .foregroundStyle(.yellow)
                            .font(.caption2)
                    }
                    Text(session.title)
                        .font(.system(size: 15, weight: isUnread ? .bold : .semibold))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if isAgentWorking {
                        ProgressView()
                            .controlSize(.mini)
                    }
                    Text(lastActivityLabel)
                        .font(.system(size: 12))
                        .foregroundStyle(BrandColors.inkMuted)
                }
                Text(previewLine)
                    .font(.system(size: 13))
                    .foregroundStyle(BrandColors.inkMuted)
                    .lineLimit(2)
                    .italic(lastMessage?.isStatus == true)
            }
        }
        .padding(.vertical, 8)
    }

    /// Chat-list avatar diameter. Sized down from the v0.6 first cut
    /// in two passes (56/64 → 45/51 → 40/46) — the smaller circle still
    /// reads as a "photo" without dominating the row. Shared between
    /// `ThreadRow` and `RoutineThreadRow` so chats and inbox rows stay
    /// coherent.
    static let avatarSize: CGFloat = {
        #if os(macOS)
        return 46
        #else
        return 40
        #endif
    }()
}

/// Row variant rendered inside the Inbox tab. Shows the agent name (the
/// bit after `routines:`) with a calendar icon, the last activity time,
/// the most recent fire's preview line, and an unread dot in the leading
/// gutter when the session has new activity since it was last opened.
private struct RoutineThreadRow: View {
    let session: Session
    let lastMessage: Message?
    let isUnread: Bool

    private var agentName: String { session.routineAgentName ?? session.title }

    private var lastActivityLabel: String {
        if let ms = session.lastEventAt {
            return RelativeTime.format(Date(timeIntervalSince1970: TimeInterval(ms) / 1000.0))
        }
        return ""
    }

    private var previewLine: String {
        guard let message = lastMessage else { return "" }
        let sender = message.isFromUser ? "You" : message.senderName
        let trimmed = message.content
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return sender }
        return "\(sender): \(trimmed)"
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            // Fixed-width unread gutter so rows align whether dotted or not.
            ZStack {
                if isUnread {
                    Circle()
                        .fill(BrandColors.primary)
                        .frame(width: 8, height: 8)
                }
            }
            .frame(width: 10)
            .padding(.top, 14)

            ZStack {
                Circle()
                    .fill(BrandColors.primary.opacity(0.14))
                Image(systemName: "calendar.badge.clock")
                    .font(.system(size: ThreadRow.avatarSize * 0.42, weight: .medium))
                    .foregroundStyle(BrandColors.primary)
            }
            .frame(width: ThreadRow.avatarSize, height: ThreadRow.avatarSize)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(agentName)
                        .font(.system(size: 15, weight: isUnread ? .bold : .semibold))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(lastActivityLabel)
                        .font(.system(size: 12))
                        .foregroundStyle(BrandColors.inkMuted)
                }
                if !previewLine.isEmpty {
                    Text(previewLine)
                        .font(.system(size: 13))
                        .foregroundStyle(BrandColors.inkMuted)
                        .lineLimit(2)
                }
            }
        }
        .padding(.vertical, 8)
    }
}

/// Always-visible search field at the top of the chat list (WhatsApp
/// pattern). Replaces the pre-v0.6 `.searchable` toolbar item, which
/// was iOS pull-down and a Mac toolbar button — both required an extra
/// gesture to discover. This version is keyboard-focusable on both
/// platforms and lives in the same vertical column as the list, so it
/// reads as part of the list, not a separate affordance.
private struct ChatListSearchField: View {
    @Binding var text: String
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(BrandColors.inkMuted)
            TextField("Search", text: $text)
                .textFieldStyle(.plain)
                .focused($focused)
                .font(.system(size: 14))
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                #endif
            if !text.isEmpty {
                Button {
                    text = ""
                    focused = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(BrandColors.inkFaint)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(BrandColors.hairline.opacity(0.5)),
        )
    }
}

struct AvatarStack: View {
    let agents: [Agent]
    /// Visual diameter the stack should fill. Pass the same value the
    /// parent reserves via `.frame(...)` so the tile actually occupies
    /// the reserved space — earlier versions hardcoded 32pt and looked
    /// undersized inside larger frames.
    var size: CGFloat = 32
    var max: Int = 3

    var body: some View {
        let shown = Array(agents.prefix(max))
        if shown.count == 1, let agent = shown.first {
            AvatarTile(agent: agent, size: size)
        } else if shown.count > 1 {
            // Stacked tiles scale proportionally with `size`: each tile
            // is ~70% of the requested diameter so two fit side-by-side
            // with a small overlap. Border thickness scales too so it
            // reads at any size.
            let tileSize = size * 0.7
            let overlap = tileSize * 0.36
            ZStack {
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, agent in
                    AvatarTile(agent: agent, size: tileSize)
                        .overlay(Circle().stroke(PlatformColors.windowBackground, lineWidth: 2))
                        .offset(x: CGFloat(index) * -overlap, y: 0)
                }
            }
            .frame(width: size, height: size, alignment: .center)
        } else {
            Circle()
                .fill(BrandColors.hairline)
                .frame(width: size, height: size)
        }
    }
}

/// Solid-color circular avatar with white monogram — the iMessage /
/// WhatsApp pattern. Earlier (pre-v0.6.1) this rendered as a 16%-opacity
/// wash of the agent's tint, which read as "bloody" on the coral
/// primary. Solid fill reads as confident and matches the chat-bubble
/// glyph color used elsewhere in the brand system.
private struct AvatarTile: View {
    let agent: Agent
    let size: CGFloat

    /// Initials font scales with the tile so the monogram reads at any
    /// size without hand-tuning per call site.
    private var fontSize: CGFloat { size * 0.4 }

    var body: some View {
        let tint = AgentPalette.color(for: agent.agentName)
        ZStack {
            Circle().fill(tint)
            Text(agent.initials)
                .font(.system(size: fontSize, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
        .overlay(alignment: .bottomTrailing) {
            if agent.isOnline {
                Circle()
                    .fill(BrandColors.success)
                    .frame(width: size * 0.26, height: size * 0.26)
                    .overlay(Circle().stroke(BrandColors.bg, lineWidth: 1.5))
                    .offset(x: 1, y: 1)
            }
        }
    }
}

enum PlatformColors {
    static var windowBackground: Color {
        #if os(macOS)
        Color(NSColor.windowBackgroundColor)
        #else
        Color(UIColor.systemBackground)
        #endif
    }
}
