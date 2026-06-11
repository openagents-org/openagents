import Foundation
import Observation

/// Per-session message page state. Tracks cursors so we can do incremental polling forward
/// (only fetch new messages) and load older messages on scroll-up.
struct ChannelMessages: Sendable {
    var messages: [Message] = []
    var oldestId: String?
    var newestId: String?
    /// True when the backend says there are still older messages we haven't fetched.
    var hasOlder: Bool = false
    var loadingOlder: Bool = false
    /// True while the initial history fetch is in flight. Distinct from
    /// `loadingOlder` — drives the chat view's "loading…" placeholder vs.
    /// the empty-thread "say hi" copy.
    var loadingHistory: Bool = false
    /// Increments whenever the messages array is bulk-replaced (initial load, session switch).
    /// Drives scroll-to-bottom in the chat view.
    var generation: Int = 0
}

/// Central app state for a single connected workspace. Created once we have a workspace ID + token.
@MainActor
@Observable
final class WorkspaceStore {
    let workspaceId: String
    let token: String
    private let api: WorkspaceAPI

    var workspace: Workspace?
    var agents: [Agent] = []
    /// Human collaborators in the workspace. Populated by the backend's
    /// auto-upsert on every human chat post, refreshed alongside agents
    /// on poll. Drives the @-mention picker (`bary` matches when a
    /// human with displayName "Bary Huang" — or email "bary@…" — is in
    /// the workspace).
    var humans: [WorkspaceAPI.Collaborator] = []
    var sessions: [Session] = []
    var currentSessionId: String?
    /// Per-session message page state with cursor info.
    var pagesBySession: [String: ChannelMessages] = [:]
    /// Last-message preview per session — used by the thread list rows.
    var lastMessageBySession: [String: Message] = [:]
    /// Sessions where the user has tapped Stop and we're waiting for the
    /// agent's terminal "stopped" / "stopping failed" status to come back.
    /// Mirrors the React app's `stoppingSessionIds`.
    var stoppingSessionIds: Set<String> = []
    /// Sessions where the user just sent a message and we're waiting for the
    /// agent's first response frame. Drives an immediate "thinking…" indicator
    /// so there's no dead gap between send and the agent's first status (which
    /// is genuine agent latency — typically 1–3s). Cleared when any agent
    /// (non-user) message arrives, or by a safety timeout in `sendMessage`.
    var awaitingFirstResponseSessionIds: Set<String> = []
    var isLoading: Bool = true
    var lastError: String?

    /// Browser Fabric tabs currently known for this workspace. Refreshed in
    /// the existing discovery poll cycle and rendered together in the Browser
    /// panel so users can inspect every active agent-controlled session.
    var browserTabs: [BrowserTab] = []

    /// Increments whenever a live browser session first appears (transition
    /// from "no live tab" to "at least one live tab") while the workspace
    /// toggle is on. The chat view observes this to auto-open the right
    /// panel and focus the Browser tab the first time a session goes live.
    /// After the user picks a different tab, future transitions don't
    /// auto-switch — we only nudge once per appearance.
    var browserAutoFocusToken: Int = 0

    /// Last-known "had any live browser tab" flag used to detect the
    /// transition that drives `browserAutoFocusToken`.
    private var hadLiveBrowserTab: Bool = false

    private var pollTask: Task<Void, Never>?
    private var messagePollTask: Task<Void, Never>?

    /// How many messages to load at a time. Matches the React app (50 initial / 30 older).
    private let initialPageSize = 50
    private let olderPageSize = 30

    init(workspaceId: String, token: String, baseURL: URL) {
        self.workspaceId = workspaceId
        self.token = token
        self.api = WorkspaceAPI(baseURL: baseURL)
        logInfo("workspace", "store init id=\(workspaceId) apiBaseURL=\(baseURL.absoluteString)")
    }

    func bootstrap() async {
        await api.configure(workspaceId: workspaceId, token: token)
        await refreshDiscovery()
        await refreshPreviews()
        if currentSessionId == nil, let first = activeSessions.first {
            currentSessionId = first.sessionId
            await loadHistory(channel: first.sessionId)
        }
        isLoading = false
        startPolling()

        // Reinstall flow: APNs delivered the device token before any
        // workspace was in history, so `PushSink.handleAPNsToken` early-
        // returned without calling /v1/devices/register. Now that we're
        // bootstrapped against a real workspace, re-register with the
        // cached token so push delivery starts working without forcing
        // the user to restart the app. `lastUserEmail` is written by
        // AuthStore on sign-in so mention pushes can scope to this user.
        #if os(iOS)
        if let token = UserDefaults.standard.string(forKey: "pushSink.lastAPNsToken"),
           !token.isEmpty {
            let bundleId = Bundle.main.bundleIdentifier ?? "org.openagents.workspace"
            let userEmail = UserDefaults.standard.string(forKey: "pushSink.lastUserEmail")
            do {
                try await api.registerDeviceToken(
                    fcmToken: token,
                    bundleId: bundleId,
                    userEmail: userEmail,
                )
                logInfo("push", "re-registered cached APNs token after bootstrap (\(token.prefix(12))…)")
            } catch {
                logInfo("push", "post-bootstrap APNs re-register failed: \(error.localizedDescription)")
            }
        }
        #endif
    }

    /// Stop background tasks. Called when the user switches workspaces or signs out.
    func teardown() {
        pollTask?.cancel()
        messagePollTask?.cancel()
        pollTask = nil
        messagePollTask = nil
    }

    // MARK: - Derived state

    var activeSessions: [Session] {
        sessions
            .filter { $0.status != "deleted" && $0.status != "archived" }
            .sorted { lhs, rhs in
                if lhs.starred != rhs.starred { return lhs.starred }
                return (lhs.lastEventAt ?? 0) > (rhs.lastEventAt ?? 0)
            }
    }

    var currentSession: Session? {
        sessions.first { $0.sessionId == currentSessionId }
    }

    var currentMessages: [Message] {
        guard let id = currentSessionId else { return [] }
        return pagesBySession[id]?.messages ?? []
    }

    var currentPage: ChannelMessages? {
        guard let id = currentSessionId else { return nil }
        return pagesBySession[id]
    }

    var onlineAgents: [Agent] { agents.filter(\.isOnline) }

    /// Whether any agent is a member of this workspace, regardless of online
    /// status. A member whose heartbeat has gone stale is still *connected*
    /// to the workspace — it just isn't online right now. Use this (not
    /// `onlineAgents`) to decide whether to surface the "connect an agent"
    /// onboarding empty state; `onlineAgents` only gates what can be picked
    /// to join a conversation.
    var hasConnectedAgents: Bool { !agents.isEmpty }

    /// Browser tabs sorted with the most recently active first. The Browser
    /// panel validates each tab as it appears, so rows without an initial
    /// `liveUrl` can still reconnect and render.
    var browserSessionTabs: [BrowserTab] {
        browserTabs
            .sorted(by: { $0.sortKey > $1.sortKey })
    }

    /// Live tabs sorted with the most recently active first.
    var liveBrowserTabs: [BrowserTab] {
        browserSessionTabs.filter(\.isLive)
    }

    /// Backward-compatible convenience for places that only need to know
    /// whether there is at least one live browser session.
    var liveBrowserTab: BrowserTab? {
        liveBrowserTabs.first
    }

    /// True when the workspace has the toggle on AND there are sessions
    /// to show. Drives whether the Browser tab is visible in the right panel.
    var browserPanelAvailable: Bool {
        (workspace?.browserEnabled ?? false) && !browserSessionTabs.isEmpty
    }

    /// True when any session's most recent message is a pending status (agent working) — drives
    /// adaptive polling speed.
    var hasActiveAgents: Bool {
        for (_, message) in lastMessageBySession {
            if message.isStatus && !message.isFromUser { return true }
        }
        return false
    }

    /// True when the given session has an agent actively working — last message is
    /// an agent status that isn't a terminal "stopped" / "stopping failed". Used by
    /// the chat view to flip the send button into a stop button.
    func isAgentWorking(in sessionId: String) -> Bool {
        guard let last = pagesBySession[sessionId]?.messages.last
            ?? lastMessageBySession[sessionId] else { return false }
        guard last.isStatus, !last.isFromUser else { return false }
        return !Self.isTerminalStatus(last.content)
    }

    func isStopping(_ sessionId: String) -> Bool {
        stoppingSessionIds.contains(sessionId)
    }

    /// True between the user sending a message and the agent's first response —
    /// drives the immediate "thinking…" indicator.
    func isAwaitingFirstResponse(_ sessionId: String) -> Bool {
        awaitingFirstResponseSessionIds.contains(sessionId)
    }

    private static func isTerminalStatus(_ content: String) -> Bool {
        // Status content that means "the agent is done with this control
        // action — clear the working/typing indicator." Covers stop ("stopped"
        // / "stopping failed" — mirrors the React app's `/stopped|stopping
        // failed/i`) and restart ("Session restarted …" / "restart failed").
        let lower = content.lowercased()
        return lower.contains("stopped")
            || lower.contains("stopping failed")
            || lower.contains("session restarted")
            || lower.contains("restart failed")
    }

    /// Pull the set of attached filenames out of a message body. Recognizes both
    /// the optimistic form (`📎 name.png — uploading…`) and the final markdown
    /// form (`📎 [name.png](https://…)`). Used by the dedup fallback so an
    /// optimistic message and the eventual real message can be matched even
    /// when their bodies differ in everything but the filename list.
    static func attachmentFilenames(in content: String) -> Set<String> {
        var names: Set<String> = []
        for raw in content.split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            guard line.hasPrefix("📎") else { continue }
            // After the paperclip there's either "[name](url)" or "name — uploading…".
            let afterClip = line.dropFirst(1).trimmingCharacters(in: .whitespaces)
            if afterClip.hasPrefix("[") {
                if let close = afterClip.firstIndex(of: "]") {
                    let name = String(afterClip[afterClip.index(after: afterClip.startIndex)..<close])
                    names.insert(name)
                }
            } else {
                // "name — uploading…" — split on em-dash.
                let parts = afterClip.components(separatedBy: " — ")
                if let first = parts.first, !first.isEmpty {
                    names.insert(first)
                }
            }
        }
        return names
    }

    // MARK: - Actions

    func selectSession(_ sessionId: String?) {
        guard sessionId != currentSessionId else { return }
        currentSessionId = sessionId
        // nil arrives when iPhone's compact NavigationSplitView pops the detail —
        // accept it so re-tapping the same row re-pushes.
        guard let sessionId else { return }
        // If we don't have any messages cached yet, load history; otherwise rely on polling
        // to catch us up (cached page is shown immediately).
        let needsHistory = pagesBySession[sessionId]?.messages.isEmpty != false
        if needsHistory {
            Task { await loadHistory(channel: sessionId) }
        } else {
            Task { await pollNewMessages(channel: sessionId) }
        }
    }

    func refreshDiscovery() async {
        do {
            let discovery = try await api.discover()
            self.agents = discovery.agents.map { $0.toAgent() }
            self.sessions = discovery.channels.map { $0.toSession(workspaceId: workspaceId) }
            // Refresh the human roster in parallel — the @-mention picker
            // merges these with `agents`. Older backends without the
            // collaborators endpoint will 404; swallow so the chat list
            // doesn't fail.
            //
            // Self-register the signed-in user as a collaborator first so
            // the GET that follows includes them — otherwise a freshly-
            // logged-in human wouldn't appear in their own picker on the
            // first refresh after sign-in.
            Task {
                let email = UserDefaults.standard.string(forKey: "pushSink.lastUserEmail")
                let displayName = UserDefaults.standard.string(forKey: "pushSink.lastUserDisplayName")
                if let email, !email.isEmpty {
                    try? await api.recordPresence(senderEmail: email, senderDisplayName: displayName)
                }
                if let collabs = try? await api.listCollaborators() {
                    self.humans = collabs
                }
            }
            // Drop stale current selection if the session no longer exists
            if let id = currentSessionId, !sessions.contains(where: { $0.sessionId == id }) {
                currentSessionId = activeSessions.first?.sessionId
                if let id = currentSessionId {
                    Task { await self.loadHistory(channel: id) }
                }
            }
            // Also refresh workspace metadata in the background — non-blocking.
            if workspace == nil {
                Task { try? await self.refreshWorkspaceMetadata() }
            }
            // Refresh browser tabs in parallel — non-blocking, errors swallowed.
            // Only fetch when the toggle is on; otherwise the data is wasted.
            if workspace?.browserEnabled == true {
                Task { await self.refreshBrowserTabs() }
            } else {
                // Clear stale tabs when the feature is off so re-enabling
                // doesn't briefly show a phantom session from a previous poll.
                browserTabs = []
                hadLiveBrowserTab = false
            }
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Fetch a single tab with `validate=true` so the backend wakes the
    /// underlying Browser Fabric session if it's expired and returns a
    /// fresh `liveUrl`. Used by `BrowserPanel` on first load and reload.
    func validateBrowserTab(tabId: String) async throws -> BrowserTab {
        let updated = try await api.getBrowserTab(tabId: tabId, validate: true)
        // Merge the fresh tab into our local list so the rest of the UI
        // (toggle availability, etc.) reflects the validated state.
        if let i = browserTabs.firstIndex(where: { $0.id == tabId }) {
            browserTabs[i] = updated
        } else {
            browserTabs.append(updated)
        }
        return updated
    }

    /// Fetch the workspace's current browser tabs. Detects the
    /// no-live → live transition and increments `browserAutoFocusToken`
    /// so the chat view can auto-open the panel on the Browser tab.
    func refreshBrowserTabs() async {
        do {
            let tabs = try await api.listBrowserTabs()
            self.browserTabs = tabs
            let isLiveNow = tabs.contains(where: \.isLive)
            if isLiveNow, !hadLiveBrowserTab, workspace?.browserEnabled == true {
                browserAutoFocusToken &+= 1
                logInfo("browser", "live session appeared — nudge=\(browserAutoFocusToken)")
            }
            hadLiveBrowserTab = isLiveNow
        } catch {
            logError("browser", "list tabs failed: \(error.localizedDescription)")
        }
    }

    /// Flip the workspace-level browser-panel toggle. Optimistic — updates
    /// local state immediately, then PATCHes the backend. On error, rolls
    /// back and surfaces the message via `lastError`.
    func setBrowserEnabled(_ enabled: Bool) async {
        guard let current = workspace else {
            logError("browser", "setBrowserEnabled before workspace loaded — ignored")
            return
        }
        guard current.browserEnabled != enabled else { return }
        let optimistic = Workspace(
            workspaceId: current.workspaceId,
            slug: current.slug,
            name: current.name,
            creatorEmail: current.creatorEmail,
            status: current.status,
            createdAt: current.createdAt,
            lastActivityAt: current.lastActivityAt,
            agents: current.agents,
            browserEnabled: enabled,
        )
        self.workspace = optimistic
        do {
            let updated = try await api.updateWorkspaceBrowserEnabled(enabled)
            self.workspace = updated
            // Re-fetch tabs immediately so the UI doesn't wait up to 15s for
            // the next poll to surface the newly-enabled view.
            if enabled { await refreshBrowserTabs() }
        } catch {
            self.workspace = current  // rollback
            lastError = "Couldn't update workspace: \(error.localizedDescription)"
            logError("browser", "setBrowserEnabled rollback: \(error.localizedDescription)")
        }
    }

    /// Fetch the latest message per channel — populates `lastMessageBySession` for thread previews.
    func refreshPreviews() async {
        do {
            let latest = try await api.latestPerChannel()
            var batch: [String: Message] = [:]
            for (channel, event) in latest {
                batch[channel] = event.toMessage()
            }
            for (channel, message) in batch {
                if let existing = lastMessageBySession[channel],
                   existing.timestamp > message.timestamp {
                    continue
                }
                lastMessageBySession[channel] = message
            }
        } catch {
            // Non-critical — silently keep existing previews
        }
    }

    private func refreshWorkspaceMetadata() async throws {
        let ws = try await api.getWorkspace()
        self.workspace = ws
        // Update the persisted name on the history entry. touch() preserves the entry's
        // existing appURL / apiURL pair when they're not passed in, which is what we want.
        WorkspaceHistory.shared.touch(workspaceId: workspaceId, token: token, name: ws.name)
        // If this is the active workspace, mirror the now-updated history entry into
        // `currentWorkspace` so a future launch sees the right URL pair (and the right name).
        if let current = WorkspaceHistory.shared.current(), current.workspaceId == workspaceId,
           let updated = WorkspaceHistory.shared.entries().first(where: { $0.workspaceId == workspaceId }) {
            WorkspaceHistory.shared.setCurrent(updated)
            logInfo("workspace", "metadata refreshed — name=\(ws.name) apiURL=\(updated.apiURL ?? "nil")")
        }
    }

    // MARK: - Message pagination

    /// Initial / on-session-change load. Fetches the most recent page of messages and replaces
    /// any existing cache for this channel. Bumps generation so the chat view scrolls to bottom.
    func loadHistory(channel: String) async {
        // Publish "loading" before the await so the chat view can show a
        // spinner instead of the empty-thread "say hi" placeholder during the
        // network round-trip — without this the user sees a blank thread that
        // looks identical to an empty one.
        var page = pagesBySession[channel] ?? ChannelMessages()
        page.loadingHistory = true
        pagesBySession[channel] = page

        do {
            let batch = try await api.loadMessages(
                channel: channel,
                sort: "desc",
                limit: initialPageSize,
            )
            page.messages = batch.messages
            page.oldestId = batch.oldestId
            page.newestId = batch.newestId
            page.hasOlder = batch.hasMore
            page.loadingHistory = false
            page.generation += 1
            pagesBySession[channel] = page
            if let last = batch.messages.last {
                lastMessageBySession[channel] = last
            }
            logInfo("history", "loaded \(batch.messages.count) for \(channel) hasOlder=\(batch.hasMore) newestId=\(batch.newestId ?? "nil")")
            lastError = nil
        } catch {
            page.loadingHistory = false
            pagesBySession[channel] = page
            logError("history", "channel=\(channel) failed: \(error.localizedDescription)")
            lastError = error.localizedDescription
        }
    }

    /// Forward poll — fetch only messages newer than the cached `newestId`. Used by the
    /// background polling loop and after sending a message.
    ///
    /// TODO(notifications): when `newOnes` contains an agent message AND
    /// (`channel != currentSessionId` OR `scenePhase != .active`), schedule a
    /// `UNUserNotificationCenter` local notification (title = sender, body = trimmed
    /// content). Suppress when the thread is muted in WorkspaceHistory. Update an
    /// unread-count map and badge the dock / app icon accordingly. See README ▸ TODO.
    func pollNewMessages(channel: String) async {
        var page = pagesBySession[channel] ?? ChannelMessages()
        do {
            var keepGoing = true
            var totalNew = 0
            while keepGoing {
                let batch = try await api.loadMessages(
                    channel: channel,
                    after: page.newestId,
                    sort: "asc",
                    limit: 200,
                )
                if batch.messages.isEmpty {
                    keepGoing = false
                    break
                }
                let existingIds = Set(page.messages.map(\.messageId))
                let newOnes = batch.messages.filter { !existingIds.contains($0.messageId) }
                if newOnes.isEmpty {
                    keepGoing = false
                    break
                }
                // Reconcile optimistic placeholders against the real human message.
                // Strict equality is the fast path. For attachment messages we
                // also fall back to comparing the set of attached filenames —
                // an optimistic might be left as "📎 file.png — uploading…"
                // if the poll arrives before sendMessage completed (the
                // in-place content rewrite in sendMessage covers the common
                // case, but a slow upload can race the poll).
                var droppedOptimistic = 0
                for new in newOnes where new.isFromUser {
                    let before = page.messages.count
                    page.messages.removeAll { msg in
                        guard msg.messageId.hasPrefix("optimistic-"),
                              msg.isFromUser,
                              abs(msg.timestamp - new.timestamp) < 30_000 else { return false }
                        if msg.content == new.content { return true }
                        let lhsFiles = Self.attachmentFilenames(in: msg.content)
                        let rhsFiles = Self.attachmentFilenames(in: new.content)
                        return !lhsFiles.isEmpty && lhsFiles == rhsFiles
                    }
                    droppedOptimistic += before - page.messages.count
                }
                // Drop local optimistic status placeholders ("Stopping…",
                // "Restarting session…", etc.) once any real agent status
                // arrives — the backend's status overrides them.
                if newOnes.contains(where: { !$0.isFromUser }) {
                    page.messages.removeAll {
                        $0.messageId.hasPrefix("local-stopping-")
                            || $0.messageId.hasPrefix("local-restart-")
                            || $0.messageId.hasPrefix("local-status-")
                    }
                    // First agent output arrived — the real status/steps block
                    // now takes over from the "thinking…" placeholder indicator.
                    awaitingFirstResponseSessionIds.remove(channel)
                }
                page.messages.append(contentsOf: newOnes)
                if let last = newOnes.last { page.newestId = last.messageId }
                if let last = newOnes.last { lastMessageBySession[channel] = last }

                // macOS local notification banner — mirrors the iOS push
                // filter for agent chat. MacNotifier suppresses banners
                // for the channel the user is already viewing.
                #if os(macOS)
                for msg in newOnes where !msg.isFromUser && msg.messageType == "chat" {
                    let preview = msg.content.trimmingCharacters(in: .whitespacesAndNewlines)
                    if preview.isEmpty { continue }
                    MacNotifier.shared.present(
                        channel: channel,
                        title: msg.senderName,
                        body: preview,
                        eventId: msg.messageId,
                    )
                }
                #endif
                // Clear the stopping flag if the latest agent status is terminal.
                if let last = newOnes.last, last.isStatus, !last.isFromUser,
                   Self.isTerminalStatus(last.content) {
                    stoppingSessionIds.remove(channel)
                }
                totalNew += newOnes.count
                if droppedOptimistic > 0 {
                    logInfo("poll", "dropped \(droppedOptimistic) optimistic placeholder(s)")
                }
                keepGoing = batch.hasMore
            }
            pagesBySession[channel] = page
            if totalNew > 0 {
                logInfo("poll", "+\(totalNew) new in \(channel) (newestId now \(page.newestId ?? "nil"))")
            }
            lastError = nil
        } catch {
            logError("poll", "channel=\(channel) failed: \(error.localizedDescription)")
            lastError = error.localizedDescription
        }
    }

    /// Load an older page when the user scrolls past the top. Prepends to the cached array
    /// without bumping `generation`, so the chat view doesn't auto-scroll on this load.
    func loadOlderMessages(channel: String) async {
        guard var page = pagesBySession[channel],
              page.hasOlder, !page.loadingOlder,
              let oldestId = page.oldestId else { return }
        page.loadingOlder = true
        pagesBySession[channel] = page
        defer {
            if var p = pagesBySession[channel] { p.loadingOlder = false; pagesBySession[channel] = p }
        }
        do {
            let batch = try await api.loadMessages(
                channel: channel,
                before: oldestId,
                sort: "desc",
                limit: olderPageSize,
            )
            guard var p = pagesBySession[channel] else { return }
            if batch.messages.isEmpty {
                p.hasOlder = false
                pagesBySession[channel] = p
                return
            }
            let existingIds = Set(p.messages.map(\.messageId))
            let newOnes = batch.messages.filter { !existingIds.contains($0.messageId) }
            p.messages.insert(contentsOf: newOnes, at: 0)
            if let first = batch.messages.first { p.oldestId = first.messageId }
            p.hasOlder = batch.hasMore
            pagesBySession[channel] = p
        } catch {
            lastError = error.localizedDescription
        }
    }

    func sendMessage(
        _ content: String,
        senderName: String = "user",
        senderEmail: String? = nil,
        senderDisplayName: String? = nil,
        attachments: [PendingAttachment] = [],
    ) async {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty || !attachments.isEmpty else {
            logWarn("send", "ignored — empty content and no attachments")
            return
        }
        guard let channel = currentSessionId else {
            logWarn("send", "ignored — no current session")
            return
        }

        let preview = trimmed.count > 60 ? String(trimmed.prefix(60)) + "…" : trimmed
        logInfo("send", "→ channel=\(channel) chars=\(trimmed.count) attachments=\(attachments.count) sender=\"\(senderName)\" text=\"\(preview)\"")

        // Optimistic insert *before* the network request so the bubble appears instantly.
        // Pending attachments are shown as 📎 lines so the user sees them immediately.
        let optimisticContent: String = {
            var parts: [String] = []
            if !trimmed.isEmpty { parts.append(trimmed) }
            for a in attachments { parts.append("📎 \(a.filename) — uploading…") }
            return parts.joined(separator: "\n\n")
        }()
        let optimisticId = "optimistic-\(Int(Date().timeIntervalSince1970 * 1000))"
        let optimistic = Message(
            messageId: optimisticId,
            sessionId: channel,
            senderType: "human",
            senderName: senderName,
            content: optimisticContent,
            mentions: [],
            messageType: "chat",
            timestamp: Int64(Date().timeIntervalSince1970 * 1000),
            attachment: nil,
        )
        var page = pagesBySession[channel] ?? ChannelMessages()
        page.messages.append(optimistic)
        page.generation += 1
        pagesBySession[channel] = page
        logInfo("send", "inserted optimistic id=\(optimisticId)")

        // Immediate "thinking…" affordance: if an agent is expected to reply in
        // this channel, show the indicator the instant the message is sent —
        // the agent's first status frame is genuine latency (1–3s), so there's
        // nothing to fetch faster. Cleared when the agent emits any message
        // (pollNewMessages) or by the safety timeout below.
        let sessionForSend = sessions.first { $0.sessionId == channel }
        let channelHasAgent = agents.contains { agent in
            guard let s = sessionForSend else { return false }
            return s.participants.isEmpty || s.participants.contains(agent.agentName)
        }
        if channelHasAgent {
            awaitingFirstResponseSessionIds.insert(channel)
            // Safety net: clear the indicator if no agent output arrives (e.g.
            // an offline/broken agent) so it can't hang indefinitely.
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: 45 * 1_000_000_000)
                self?.awaitingFirstResponseSessionIds.remove(channel)
            }
        }

        do {
            // Upload attachments first; collect markdown links to splice into the message.
            var attachmentLinks: [String] = []
            for a in attachments {
                let uploaded = try await api.uploadFile(
                    channel: channel,
                    filename: a.filename,
                    contentType: a.contentType,
                    data: a.data,
                )
                let url = await api.downloadURL(fileId: uploaded.id)
                attachmentLinks.append("📎 [\(uploaded.filename)](\(url.absoluteString))")
                logInfo("send", "uploaded id=\(uploaded.id) name=\(uploaded.filename) size=\(uploaded.size)")
            }

            let finalContent: String = {
                var parts: [String] = []
                if !trimmed.isEmpty { parts.append(trimmed) }
                parts.append(contentsOf: attachmentLinks)
                return parts.joined(separator: "\n\n")
            }()

            let event = try await api.sendMessage(
                channel: channel,
                content: finalContent,
                senderName: senderName,
                senderEmail: senderEmail,
                senderDisplayName: senderDisplayName,
            )
            logInfo("send", "✓ backend ack id=\(event.id) ts=\(event.timestamp)")

            // Replace the optimistic placeholder's content in-place with the
            // final markdown. The forward-poll dedup matches optimistic vs. real
            // by `content == content` — without this, attachment messages
            // diverge ("uploading…" vs. "[name](url)") and we end up with two
            // visible bubbles per send.
            if var p = pagesBySession[channel],
               let i = p.messages.firstIndex(where: { $0.messageId == optimisticId }) {
                let prev = p.messages[i]
                p.messages[i] = Message(
                    messageId: prev.messageId,
                    sessionId: prev.sessionId,
                    senderType: prev.senderType,
                    senderName: prev.senderName,
                    content: finalContent,
                    mentions: prev.mentions,
                    messageType: prev.messageType,
                    timestamp: prev.timestamp,
                    attachment: prev.attachment,
                )
                pagesBySession[channel] = p
            }

            lastError = nil
            Task { [weak self] in
                for delayMs in [600, 1500, 3500] {
                    try? await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
                    guard let self else { return }
                    await self.pollNewMessages(channel: channel)
                }
            }
        } catch {
            logError("send", "✗ failed: \(error.localizedDescription)")
            if var p = pagesBySession[channel] {
                p.messages.removeAll { $0.messageId == optimisticId }
                pagesBySession[channel] = p
            }
            lastError = error.localizedDescription
        }
    }

    func renameThread(sessionId: String, title: String) async {
        let trimmed = title.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty,
              let index = sessions.firstIndex(where: { $0.sessionId == sessionId }) else { return }
        let prevTitle = sessions[index].title
        sessions[index].title = trimmed
        do {
            try await api.updateChannel(channelName: sessionId, title: trimmed)
        } catch {
            sessions[index].title = prevTitle
            lastError = error.localizedDescription
        }
    }

    func toggleStar(sessionId: String) async {
        guard let session = sessions.first(where: { $0.sessionId == sessionId }) else { return }
        let newStarred = !session.starred
        if let index = sessions.firstIndex(where: { $0.sessionId == sessionId }) {
            sessions[index].starred = newStarred
        }
        do {
            try await api.updateChannel(channelName: sessionId, starred: newStarred)
        } catch {
            if let index = sessions.firstIndex(where: { $0.sessionId == sessionId }) {
                sessions[index].starred = !newStarred
            }
            lastError = error.localizedDescription
        }
    }

    func setStatus(sessionId: String, status: String) async {
        guard let index = sessions.firstIndex(where: { $0.sessionId == sessionId }) else { return }
        let prevStatus = sessions[index].status
        sessions[index].status = status
        if status == "deleted" || status == "archived", currentSessionId == sessionId {
            currentSessionId = activeSessions.first?.sessionId
            if let id = currentSessionId {
                Task { await self.loadHistory(channel: id) }
            }
        }
        do {
            try await api.updateChannel(channelName: sessionId, status: status)
        } catch {
            sessions[index].status = prevStatus
            lastError = error.localizedDescription
        }
    }

    /// Send a `stop` control event to every agent in the workspace and mark the
    /// given session as stopping until the agent posts a terminal status.
    /// Mirrors the React app's `stopAllAgents` flow: optimistic "Stopping..."
    /// status, fire control events in parallel, then a 3-second retry if no
    /// agent has acknowledged yet.
    func stopAllAgents(sessionId: String) async {
        guard !agents.isEmpty else {
            logWarn("stop", "no agents to stop in session=\(sessionId)")
            return
        }
        guard !stoppingSessionIds.contains(sessionId) else { return }

        stoppingSessionIds.insert(sessionId)
        // Optimistic status so the chat view + thread row reflect the request
        // immediately. The next agent status from the backend overwrites this.
        let stopping = Message.localStoppingStatus(channel: sessionId)
        var page = pagesBySession[sessionId] ?? ChannelMessages()
        page.messages.append(stopping)
        pagesBySession[sessionId] = page
        lastMessageBySession[sessionId] = stopping

        let agentNames = agents.map(\.agentName)
        logInfo("stop", "sending stop to \(agentNames.count) agent(s) in session=\(sessionId)")
        await sendStopFanout(agentNames: agentNames)

        // Retry once after 3s if we haven't received a terminal status yet.
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard let self else { return }
            await self.retryStopIfNeeded(sessionId: sessionId, agentNames: agentNames)
        }
    }

    private func sendStopFanout(agentNames: [String]) async {
        await withTaskGroup(of: Void.self) { group in
            for name in agentNames {
                group.addTask { [api = self.api] in
                    do {
                        _ = try await api.sendAgentControl(agentName: name, action: "stop")
                    } catch {
                        // Per-agent failures are logged but don't block the rest.
                        logWarn("stop", "stop control to agent=\(name) failed: \(error.localizedDescription)")
                    }
                }
            }
        }
    }

    private func retryStopIfNeeded(sessionId: String, agentNames: [String]) async {
        guard stoppingSessionIds.contains(sessionId) else { return }
        logInfo("stop", "retrying stop for session=\(sessionId)")
        await sendStopFanout(agentNames: agentNames)
    }

    /// Send a `restart` control event to every agent in this session. Agents
    /// that recognize the action (currently only Claude) clear their per-channel
    /// LLM session state so the next user message starts a fresh context.
    /// Channel scrollback / participants / title are preserved — only the
    /// agent's "remember the last N turns" is wiped. Used to recover from
    /// Anthropic's >2000px many-image-conversation rejection.
    func restartSession(sessionId: String) async {
        guard let session = sessions.first(where: { $0.sessionId == sessionId }) else {
            logWarn("restart", "no session for id=\(sessionId)")
            return
        }
        let sessionAgents = agents.filter {
            session.participants.isEmpty || session.participants.contains($0.agentName)
        }
        guard !sessionAgents.isEmpty else {
            logWarn("restart", "no agents in session=\(sessionId)")
            return
        }

        // Optimistic local-only status row so the user sees immediate feedback.
        // The agent's real "Session restarted" status from the backend
        // replaces this via the existing local-status placeholder cleanup
        // in pollNewMessages (see the local-stopping-/local-restart- prefix
        // sweep there).
        let optimistic = Message.localStatus(
            channel: sessionId,
            content: "Restarting session…",
            idPrefix: "local-restart-",
        )
        var page = pagesBySession[sessionId] ?? ChannelMessages()
        page.messages.append(optimistic)
        pagesBySession[sessionId] = page
        lastMessageBySession[sessionId] = optimistic

        let agentNames = sessionAgents.map(\.agentName)
        logInfo("restart", "sending restart to \(agentNames.count) agent(s) channel=\(sessionId)")

        await withTaskGroup(of: Void.self) { group in
            for name in agentNames {
                group.addTask { [api = self.api, sessionId] in
                    do {
                        _ = try await api.sendAgentControl(
                            agentName: name,
                            action: "restart",
                            params: ["channel": sessionId],
                        )
                    } catch {
                        logWarn("restart", "agent=\(name) failed: \(error.localizedDescription)")
                    }
                }
            }
        }
    }

    /// Send a `status` control event to every agent in this session. Each
    /// agent posts back a chat message summarizing its uptime, version, and
    /// network. Used by the `/status` slash command. Read-only — no agent
    /// state is modified.
    func requestSessionStatus(sessionId: String) async {
        guard let session = sessions.first(where: { $0.sessionId == sessionId }) else {
            logWarn("status", "no session for id=\(sessionId)")
            return
        }
        let sessionAgents = agents.filter {
            session.participants.isEmpty || session.participants.contains($0.agentName)
        }
        guard !sessionAgents.isEmpty else {
            logWarn("status", "no agents in session=\(sessionId)")
            return
        }

        // Optimistic local-only status row so the user sees immediate feedback
        // while the agents build their replies.
        let optimistic = Message.localStatus(
            channel: sessionId,
            content: "Checking status…",
            idPrefix: "local-status-",
        )
        var page = pagesBySession[sessionId] ?? ChannelMessages()
        page.messages.append(optimistic)
        pagesBySession[sessionId] = page
        lastMessageBySession[sessionId] = optimistic

        let agentNames = sessionAgents.map(\.agentName)
        logInfo("status", "requesting status from \(agentNames.count) agent(s) channel=\(sessionId)")

        await withTaskGroup(of: Void.self) { group in
            for name in agentNames {
                group.addTask { [api = self.api, sessionId] in
                    do {
                        _ = try await api.sendAgentControl(
                            agentName: name,
                            action: "status",
                            params: ["channel": sessionId],
                        )
                    } catch {
                        logWarn("status", "agent=\(name) failed: \(error.localizedDescription)")
                    }
                }
            }
        }
    }

    /// Remove an agent from a channel. Optimistically drops the agent from
    /// the local `Session.participants` so the avatar disappears immediately;
    /// the next discovery refresh confirms the canonical state.
    func removeAgentFromSession(sessionId: String, agentName: String) async {
        logInfo("members", "removing \(agentName) from channel=\(sessionId)")
        if let idx = sessions.firstIndex(where: { $0.sessionId == sessionId }) {
            let s = sessions[idx]
            let updated = s.participants.filter { $0 != agentName }
            sessions[idx] = Session(
                sessionId: s.sessionId,
                workspaceId: s.workspaceId,
                createdBy: s.createdBy,
                title: s.title,
                status: s.status,
                starred: s.starred,
                participants: updated,
                master: s.master,
                createdAt: s.createdAt,
                lastEventAt: s.lastEventAt,
            )
        }
        do {
            _ = try await api.removeAgentFromChannel(channelName: sessionId, agentName: agentName)
        } catch {
            logWarn("members", "remove failed: \(error.localizedDescription)")
            lastError = "Failed to remove \(agentName): \(error.localizedDescription)"
            await refreshDiscovery()
        }
    }

    /// Add an agent to a channel. Optimistic local update; reverts on failure.
    func addAgentToSession(sessionId: String, agentName: String) async {
        logInfo("members", "adding \(agentName) to channel=\(sessionId)")
        if let idx = sessions.firstIndex(where: { $0.sessionId == sessionId }) {
            let s = sessions[idx]
            if !s.participants.contains(agentName) {
                sessions[idx] = Session(
                    sessionId: s.sessionId,
                    workspaceId: s.workspaceId,
                    createdBy: s.createdBy,
                    title: s.title,
                    status: s.status,
                    starred: s.starred,
                    participants: s.participants + [agentName],
                    master: s.master,
                    createdAt: s.createdAt,
                    lastEventAt: s.lastEventAt,
                )
            }
        }
        do {
            _ = try await api.addAgentToChannel(channelName: sessionId, agentName: agentName)
        } catch {
            logWarn("members", "add failed: \(error.localizedDescription)")
            lastError = "Failed to add \(agentName): \(error.localizedDescription)"
            await refreshDiscovery()
        }
    }

    /// Send a `routines` control event to every agent in this session. Each
    /// agent posts back a chat message with a markdown table of its own
    /// active routines. Used by the `/routines` slash command. Read-only.
    ///
    /// For routine channels (`routines:<agent>`) we target only the owner,
    /// regardless of what the cached `session.participants` says — the
    /// channel is a single-agent job queue by design, and falling back to
    /// "all agents" on an empty cached participant list would invite every
    /// other agent in the workspace to chime in.
    func requestSessionRoutines(sessionId: String) async {
        guard let session = sessions.first(where: { $0.sessionId == sessionId }) else {
            logWarn("routines", "no session for id=\(sessionId)")
            return
        }
        let sessionAgents: [Agent]
        if let owner = session.routineAgentName,
           let ownerAgent = agents.first(where: { $0.agentName == owner }) {
            sessionAgents = [ownerAgent]
        } else if session.isRoutineChannel {
            logWarn("routines", "owner agent not online for \(sessionId)")
            return
        } else {
            sessionAgents = agents.filter {
                session.participants.isEmpty || session.participants.contains($0.agentName)
            }
        }
        guard !sessionAgents.isEmpty else {
            logWarn("routines", "no agents in session=\(sessionId)")
            return
        }

        let optimistic = Message.localStatus(
            channel: sessionId,
            content: "Listing routines…",
            idPrefix: "local-routines-",
        )
        var page = pagesBySession[sessionId] ?? ChannelMessages()
        page.messages.append(optimistic)
        pagesBySession[sessionId] = page
        lastMessageBySession[sessionId] = optimistic

        let agentNames = sessionAgents.map(\.agentName)
        logInfo("routines", "requesting routines from \(agentNames.count) agent(s) channel=\(sessionId)")

        await withTaskGroup(of: Void.self) { group in
            for name in agentNames {
                group.addTask { [api = self.api, sessionId] in
                    do {
                        _ = try await api.sendAgentControl(
                            agentName: name,
                            action: "routines",
                            params: ["channel": sessionId],
                        )
                    } catch {
                        logWarn("routines", "agent=\(name) failed: \(error.localizedDescription)")
                    }
                }
            }
        }
    }

    /// Forward an A2UI action result upstream. Called when the user interacts
    /// with a rendered spec component; non-throwing so SwiftUI callbacks stay
    /// fire-and-forget. Failures are logged but never surface as banners —
    /// a missed interaction is less disruptive than blocking the chat UI.
    func sendToolResult(
        channel: String,
        toolCallId: String?,
        actionId: String,
        value: JSONValue?,
    ) async {
        do {
            _ = try await api.sendToolResult(
                channel: channel,
                toolCallId: toolCallId,
                actionId: actionId,
                value: value,
            )
            logInfo("a2ui", "tool_result sent action=\(actionId) tc=\(toolCallId ?? "nil")")
        } catch {
            logError("a2ui", "tool_result failed action=\(actionId): \(error.localizedDescription)")
        }
    }

    func createThread(master: String, participants: [String], humanParticipants: [String] = []) async {
        do {
            let session = try await api.createChannel(
                master: master,
                participants: participants,
                humanParticipants: humanParticipants,
            )
            sessions.insert(session, at: 0)
            currentSessionId = session.sessionId
            await loadHistory(channel: session.sessionId)
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: - Files (used by ContentSidebar)

    /// Fetch a page of workspace files for the sidebar. Returns the raw
    /// response so the caller can decide whether to merge / paginate.
    /// Errors are surfaced as a thrown error rather than via `lastError` so
    /// the sidebar can render its own inline failure state instead of a
    /// banner over the whole chat.
    func listFiles(channel: String? = nil, limit: Int = 100) async throws -> [WorkspaceFile] {
        let resp = try await api.listFiles(channel: channel, limit: limit)
        return resp.files
    }

    /// `URLRequest` for downloading a file's bytes, with the workspace token
    /// pre-attached. Used by `AuthorizedAsyncImage` since `AsyncImage`
    /// doesn't accept custom headers.
    func authorizedFileDownloadRequest(fileId: String) async -> URLRequest {
        await api.authorizedDownloadRequest(fileId: fileId)
    }

    /// Sendable closure for the WKWebView `oafile:` scheme handler. Captures
    /// the actor (not `self`) so the closure can safely cross to background
    /// queues. Lets HTML in chat bubbles or workspace .html files resolve
    /// `<img src="…/v1/files/<id>">` against the authorized request path.
    var fileRequestProvider: @Sendable (String) async -> URLRequest {
        let api = self.api
        return { @Sendable fileId in
            await api.authorizedDownloadRequest(fileId: fileId)
        }
    }

    /// Look up a single file's metadata. Used by the sidebar detail view when
    /// the user lands on a file via a chat chip — we don't always have the
    /// full file row cached client-side.
    func fetchFileInfo(fileId: String) async throws -> WorkspaceFile {
        try await api.getFileInfo(fileId: fileId)
    }

    // MARK: - Polling

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let interval = await self.hasActiveAgents ? 5 : 15
                try? await Task.sleep(for: .seconds(interval))
                await self.refreshDiscovery()
                await self.refreshPreviews()
            }
        }
        messagePollTask?.cancel()
        messagePollTask = Task { [weak self] in
            // SSE-first message updates with an adaptive-polling fallback —
            // mirrors the web client's EventSource path in hooks/use-polling.ts.
            // While the stream is healthy we do NOT poll on a timer (the perf
            // win); each pushed frame triggers an incremental forward poll so
            // we reuse pollNewMessages' dedup / optimistic-reconcile path.
            while !Task.isCancelled {
                guard let self else { return }
                guard let channel = self.currentSessionId else {
                    try? await Task.sleep(for: .seconds(1))
                    continue
                }
                // Catch up immediately — covers initial load and any gap since
                // the last stream (e.g. right after a session switch/reconnect).
                await self.pollNewMessages(channel: channel)

                do {
                    let stream = await self.api.streamEvents(channel: channel)
                    for try await _ in stream {
                        if Task.isCancelled { return }
                        // User switched chats — drop this stream; the outer loop
                        // reopens one for the newly selected channel.
                        guard self.currentSessionId == channel else { break }
                        await self.pollNewMessages(channel: channel)
                    }
                    // Server closed the stream cleanly — pause briefly, then the
                    // outer loop reopens it (or picks up a new channel).
                    try? await Task.sleep(for: .seconds(1))
                } catch {
                    // SSE unavailable — fall back to adaptive polling for this
                    // channel until it changes (same cadence as the pre-SSE loop:
                    // 1.5s with an active agent, 3s idle). Mirrors onerror→poll.
                    logInfo("sse", "channel=\(channel) stream failed → polling fallback: \(error.localizedDescription)")
                    while !Task.isCancelled, self.currentSessionId == channel {
                        let interval: Double = self.hasActiveAgents ? 1.5 : 3
                        try? await Task.sleep(for: .seconds(interval))
                        await self.pollNewMessages(channel: channel)
                    }
                }
            }
        }
    }
}
