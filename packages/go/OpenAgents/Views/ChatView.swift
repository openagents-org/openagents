import SwiftUI
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#else
import PhotosUI
#endif

struct ChatView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(AppRouter.self) private var router
    @EnvironmentObject private var auth: AuthStore

    @State private var draftsBySession: [String: String] = [:]
    @State private var pendingAttachments: [PendingAttachment] = []
    @FocusState private var inputFocused: Bool

    /// True while a drag-from-Finder (or browser image-drag) is hovering over
    /// the chat column. Drives the dashed accent-color overlay so the user
    /// gets the same drop affordance as Mail / Messages.
    @State private var isDropTargeted: Bool = false

    /// Manual override for input-bar height (in points). Drag handle adjusts this.
    /// Default starts at the single-line height; user can drag up to ~half of the
    /// chat view height (see `maxInputHeight`).
    @State private var inputHeight: CGFloat = ChatView.defaultInputHeight
    @State private var dragStartHeight: CGFloat?
    /// Total chat-view height, captured via a preference key. Used to clamp resize
    /// so the input never grows past 50% of the viewport.
    @State private var chatHeight: CGFloat = 0

    #if os(iOS)
    @State private var showingPhotoPicker = false
    @State private var photoPickerItems: [PhotosPickerItem] = []
    @State private var showingFileImporter = false
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Right-hand "Content" sidebar state. Hosted here so chips inside chat
    /// messages can navigate it via @Environment; toggled from the header
    /// (macOS) or toolbar (iOS). Default off — users opt in when they need
    /// the artifact list.
    @State private var sidebar = ContentSidebarController()

    /// User-resizable sidebar width. Starts at single-column; user can drag
    /// the left edge out to ~2-column width. Persists for the lifetime of
    /// this ChatView; we don't store across launches yet.
    @State private var sidebarWidth: CGFloat = ContentSidebar.singleColumnWidth
    @State private var sidebarDragStart: CGFloat?

    /// Slash-command popup state. Mirrors the React `@mention` autocomplete
    /// pattern but lives only in the native composer. When `slashSuggestionsOpen`
    /// is true, the composer's NSTextView routes ↑/↓/Enter/Tab/Esc through
    /// `consumeSlashKey(_:)` instead of letting them produce normal text.
    @State private var slashSuggestionsOpen: Bool = false
    @State private var slashSuggestionIndex: Int = 0
    @State private var mentionSuggestionsOpen: Bool = false
    @State private var mentionSuggestionIndex: Int = 0
    @State private var mentionFilter: String = ""
    @State private var membersSheetOpen: Bool = false

    private struct SlashCommand: Identifiable {
        let id: String           // also used as the `name` ("restart")
        let description: String
        let systemImage: String
        var name: String { id }
    }

    private static let availableCommands: [SlashCommand] = [
        SlashCommand(
            id: "restart",
            description: "Reset agent conversation. Next message starts fresh.",
            systemImage: "arrow.counterclockwise",
        ),
        SlashCommand(
            id: "status",
            description: "Show agent uptime, version, and network.",
            systemImage: "info.circle",
        ),
        SlashCommand(
            id: "routines",
            description: "List active recurring routines for this agent.",
            systemImage: "calendar.badge.clock",
        ),
    ]

    private var filteredSlashCommands: [SlashCommand] {
        let typed = draft.wrappedValue
        guard typed.hasPrefix("/") else { return [] }
        let q = String(typed.dropFirst()).lowercased()
        if q.isEmpty { return Self.availableCommands }
        return Self.availableCommands.filter { $0.name.hasPrefix(q) }
    }

    /// A row in the @-mention popup: either an agent or a human collaborator.
    /// `token` is what gets inserted after `@` — the backend's mention regex
    /// matches `@[\w-]+`, so spaces are not allowed; we slug human display
    /// names to match.
    struct MentionCandidate: Identifiable, Equatable {
        let id: String
        let kind: Kind
        let label: String          // shown in the row title
        let subtitle: String?      // email or role, shown below
        let token: String          // gets inserted as `@<token>`
        enum Kind { case agent, human }
    }

    /// Slug a human display name for use as a mention token. Mirrors the
    /// backend's `_workspace_human_keys` (push.py) — first word of display
    /// name lowercased, fallback to the email local part.
    private func mentionToken(forHuman c: WorkspaceAPI.Collaborator) -> String {
        if let dn = c.displayName, !dn.trimmingCharacters(in: .whitespaces).isEmpty {
            let first = dn.split(whereSeparator: { $0.isWhitespace }).first ?? Substring(dn)
            let cleaned = first.lowercased()
                .replacingOccurrences(of: #"[^a-z0-9-]+"#, with: "-", options: .regularExpression)
                .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
            if !cleaned.isEmpty { return cleaned }
        }
        return c.email.split(separator: "@").first.map(String.init) ?? c.email
    }

    /// The merged candidate list shown in the picker. Agents first
    /// (active = online preferred order), then humans. The current
    /// `mentionFilter` (what the user typed after `@`) narrows by
    /// prefix on label / token.
    private var mentionCandidates: [MentionCandidate] {
        let q = mentionFilter.lowercased()
        let agentRows: [MentionCandidate] = store.agents
            .filter { q.isEmpty || $0.agentName.lowercased().hasPrefix(q) }
            .map { agent in
                MentionCandidate(
                    id: "agent:" + agent.agentName,
                    kind: .agent,
                    label: agent.agentName,
                    subtitle: agent.isOnline ? "online" : "offline",
                    token: agent.agentName,
                )
            }
        let humanRows: [MentionCandidate] = store.humans.map { c in
            let token = mentionToken(forHuman: c)
            return MentionCandidate(
                id: "human:" + c.email,
                kind: .human,
                label: c.displayName ?? c.email,
                subtitle: c.email,
                token: token,
            )
        }.filter { row in
            guard !q.isEmpty else { return true }
            return row.token.lowercased().hasPrefix(q)
                || row.label.lowercased().hasPrefix(q)
        }
        // Online agents first, then everyone else.
        return agentRows + humanRows
    }

    private static let defaultInputHeight: CGFloat = 44
    private static let minInputHeight: CGFloat = 36

    /// Reading-column clamp for the chat content and input bar on wide
    /// macOS windows. iMessage/Mail use ~720pt; for an agent chat that
    /// regularly carries code blocks and tool-call rows we go a touch
    /// wider so wrap-heavy content stays comfortable. The column centers
    /// inside the (full-width) ScrollView via paired `.frame(maxWidth:)`
    /// modifiers — the inner clamps content width, the outer expands the
    /// wrapper to viewport width so SwiftUI's default center alignment
    /// kicks in.
    private static let columnMaxWidth: CGFloat = 820

    private var maxInputHeight: CGFloat {
        max(Self.minInputHeight + 1, chatHeight * 0.5)
    }

    private var draft: Binding<String> {
        Binding(
            get: { draftsBySession[store.currentSessionId ?? ""] ?? "" },
            set: { draftsBySession[store.currentSessionId ?? ""] = $0 },
        )
    }

    private var canSend: Bool {
        !draft.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !pendingAttachments.isEmpty
    }

    /// On wide layouts (macOS, iPad regular hsize) the sidebar slots into the
    /// chat column as a side-by-side panel. On iPhone (compact) it would
    /// squeeze the messages too far, so it appears as a sheet instead.
    private var sidebarIsInline: Bool {
        #if os(macOS)
        return true
        #else
        return horizontalSizeClass == .regular
        #endif
    }

    /// True when the current session has an agent actively working (and we
    /// haven't yet flipped to a stopping state). Drives the send-vs-stop swap.
    private var agentIsWorking: Bool {
        guard let id = store.currentSessionId else { return false }
        return store.isAgentWorking(in: id)
    }

    private var isStoppingCurrentSession: Bool {
        guard let id = store.currentSessionId else { return false }
        return store.isStopping(id)
    }

    /// True between sending a message and the agent's first response frame —
    /// drives the immediate "thinking…" indicator so there's no dead gap.
    private var awaitingFirstResponse: Bool {
        guard let id = store.currentSessionId else { return false }
        return store.isAwaitingFirstResponse(id)
    }

    var body: some View {
        HStack(spacing: 0) {
            chatColumn
            if sidebar.isPresented && sidebarIsInline {
                sidebarResizeHandle
                ContentSidebar()
                    .frame(width: sidebarWidth)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .environment(sidebar)
        .animation(.easeInOut(duration: 0.18), value: sidebar.isPresented)
        #if os(iOS)
        .sheet(isPresented: Binding(
            get: { sidebar.isPresented && !sidebarIsInline },
            set: { newValue in
                if !newValue { sidebar.close() }
            },
        )) {
            ContentSidebar()
                .environment(sidebar)
        }
        #endif
        // AvatarStack lives on the right side of the toolbar (window
        // toolbar on macOS, nav-bar trailing on iOS) so users can tap it
        // to open the Members sheet regardless of platform. The sidebar
        // toggle sits beside it on macOS; iOS gets the toggle in the same
        // toolbar slot via .primaryAction.
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if let session = store.currentSession {
                    // Show only the agents actually in this channel. An
                    // empty participants list is legitimate (humans-only
                    // chat); falling back to "all workspace agents" used
                    // to plaster every agent into the header avatar stack.
                    let sessionAgents = store.agents.filter {
                        session.participants.contains($0.agentName)
                    }
                    if !sessionAgents.isEmpty {
                        Button {
                            membersSheetOpen.toggle()
                        } label: {
                            AvatarStack(agents: sessionAgents)
                                .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.plain)
                        .help("Manage channel members")
                    }
                }
            }
            ToolbarItem(placement: .primaryAction) {
                contentSidebarToggle
            }
        }
    }

    private var chatColumn: some View {
        VStack(spacing: 0) {
            if let error = store.lastError {
                ErrorBanner(message: error) { store.lastError = nil }
            }
            if let session = store.currentSession {
                // No in-content header anywhere — the window toolbar shows the
                // thread title + agent-name subtitle on macOS, and the
                // collapsed NavigationSplitView nav bar shows the title on
                // iPhone. Functional bits (contentSidebarToggle, AvatarStack)
                // live in `.toolbar` so they share the window chrome instead
                // of duplicating the title row inside the chat panel.
                messageList(for: session)
                Divider()
                inputBar
            } else {
                placeholder
            }
        }
        .background(
            GeometryReader { geo in
                Color.clear.preference(key: ChatHeightKey.self, value: geo.size.height)
            },
        )
        .onPreferenceChange(ChatHeightKey.self) { newValue in
            chatHeight = newValue
            // If a previous drag left us above the new viewport's allowance, clamp down.
            if inputHeight > maxInputHeight {
                inputHeight = maxInputHeight
            }
        }
        .onChange(of: store.currentSessionId) { _, newId in
            inputFocused = true
            // Drafts are per-session, but pending uploads aren't — clear them on switch.
            pendingAttachments.removeAll()
            drainExternalAttachments()
            #if os(macOS)
            // Tell MacNotifier which channel is on screen so it suppresses
            // redundant banners.
            MacNotifier.shared.currentVisibleChannel = newId
            #endif
        }
        .onChange(of: router.pendingExternalAttachments.count) { _, _ in
            drainExternalAttachments()
        }
        .onAppear {
            // Catches the cold-launch case: app opened via "Open in…", router
            // received URL, then chat view mounted with attachments waiting.
            drainExternalAttachments()
            #if os(macOS)
            MacNotifier.shared.currentVisibleChannel = store.currentSessionId
            #endif
        }
        .onDisappear {
            #if os(macOS)
            // The chat view is gone (window closed / view replaced) — clear so
            // future banners don't get suppressed for a channel nobody is
            // actually watching.
            if MacNotifier.shared.currentVisibleChannel == store.currentSessionId {
                MacNotifier.shared.currentVisibleChannel = nil
            }
            #endif
        }
        .onChange(of: store.browserAutoFocusToken) { _, _ in
            // A browser session just appeared while the workspace toggle is
            // on. Open the right panel and focus Browser — but only once per
            // appearance; the store increments the token so further focus
            // doesn't fire until a new session shows up.
            sidebar.showBrowser()
        }
        .onDrop(
            of: [.fileURL, .image],
            isTargeted: $isDropTargeted,
        ) { providers in
            handleDrop(providers)
        }
        .overlay {
            if isDropTargeted {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(BrandColors.primary, style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(BrandColors.primary.opacity(0.06)),
                    )
                    .overlay(
                        VStack(spacing: 6) {
                            Image(systemName: "tray.and.arrow.down")
                                .font(.system(size: 28, weight: .medium))
                            Text("Drop to attach")
                                .font(.system(size: 13, weight: .semibold))
                        }
                        .foregroundStyle(BrandColors.primary),
                    )
                    .padding(8)
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.12), value: isDropTargeted)
        .sheet(isPresented: $membersSheetOpen) {
            if let session = store.currentSession {
                MembersSheet(session: session, isPresented: $membersSheetOpen)
                    .environment(store)
            }
        }
        #if os(macOS)
        .background(BrandColors.bg)
        // Window-toolbar title. NavigationSplitView routes the detail column's
        // navigationTitle to the window title bar; without this the bar falls
        // back to the app's display name ("OpenAgents Go").
        .navigationTitle(store.currentSession?.title ?? "")
        .navigationSubtitle(macSubtitle)
        #else
        .background(BrandColors.bg)
        .navigationTitle(store.currentSession?.title ?? "")
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    /// Thin vertical handle between the chat column and the Content sidebar.
    /// Drag horizontally to resize the sidebar; width is clamped between a
    /// single-column minimum and a two-column maximum so a stray drag can't
    /// crush the chat.
    private var sidebarResizeHandle: some View {
        Rectangle()
            .fill(Color.gray.opacity(0.001))   // hit-testable but invisible
            .frame(width: 6)
            .overlay(
                Rectangle()
                    .fill(Color.black.opacity(0.08))
                    .frame(width: 1),
            )
            .contentShape(Rectangle())
            #if os(macOS)
            .onHover { hovering in
                if hovering {
                    NSCursor.resizeLeftRight.push()
                } else {
                    NSCursor.pop()
                }
            }
            #endif
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        if sidebarDragStart == nil {
                            sidebarDragStart = sidebarWidth
                        }
                        // Dragging left = expanding the sidebar.
                        let proposed = (sidebarDragStart ?? sidebarWidth) - value.translation.width
                        sidebarWidth = min(
                            max(proposed, ContentSidebar.singleColumnWidth),
                            ContentSidebar.twoColumnWidth,
                        )
                    }
                    .onEnded { _ in
                        sidebarDragStart = nil
                    },
            )
            .accessibilityLabel("Resize content sidebar")
    }

    /// Toolbar/header button that toggles the right-hand Content sidebar.
    /// Same visual identity across platforms so users carrying habits from
    /// the web app find it immediately.
    private var contentSidebarToggle: some View {
        Button {
            sidebar.toggle()
        } label: {
            Image(systemName: "sidebar.right")
                .symbolVariant(sidebar.isPresented ? .fill : .none)
                .font(.system(size: 14, weight: .medium))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(sidebar.isPresented ? "Hide content sidebar" : "Show content sidebar")
        #if os(macOS)
        .help("Toggle content sidebar")
        #endif
    }

    #if os(macOS)
    private var macSubtitle: String {
        guard let session = store.currentSession else { return "" }
        // Only actual channel participants — see toolbar comment above
        // for why empty.participants no longer means "all agents".
        let names = store.agents
            .filter { session.participants.contains($0.agentName) }
            .map(\.agentName)
        return names.joined(separator: ", ")
    }
    #endif

    // MARK: - Sections

    private func messageList(for session: Session) -> some View {
        let messages = store.currentMessages
        let page = store.currentPage
        let groups = MessageGrouper.group(messages)
        let lastChatMessageId = messages.last { !$0.isStatus }?.messageId
        // Nil page = haven't begun loading yet (selectSession just fired);
        // page.loadingHistory = true → initial fetch in flight.
        // Either way, prefer the spinner over the "say hi" empty state so the
        // user doesn't see a blank pane that looks identical to an empty thread.
        let isInitialLoading = messages.isEmpty && (page == nil || page?.loadingHistory == true)

        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 6) {
                    // Top anchor: when this comes into view (user scrolled to top), load more.
                    if page?.hasOlder == true {
                        loadOlderTrigger(channel: session.sessionId)
                    } else if !messages.isEmpty {
                        // Subtle "you're at the start" marker
                        Text("Beginning of conversation")
                            .font(.caption2)
                            .foregroundStyle(BrandColors.inkFaint)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                    }

                    if isInitialLoading {
                        HStack(spacing: 8) {
                            ProgressView()
                                .controlSize(.small)
                            Text("Loading messages…")
                                .font(.caption)
                                .foregroundStyle(BrandColors.inkMuted)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 60)
                    } else if messages.isEmpty {
                        Text("No messages yet — say hi.")
                            .foregroundStyle(BrandColors.inkMuted)
                            .padding(.top, 60)
                    }

                    ForEach(Array(groups.enumerated()), id: \.offset) { index, group in
                        switch group {
                        case .chat(let message):
                            MessageBubble(
                                message: message,
                                showSenderLabel: shouldShowSenderLabel(for: message, groupIndex: index, in: groups),
                                onAttachmentAction: { action in
                                    Task {
                                        await store.sendToolResult(
                                            channel: message.sessionId,
                                            toolCallId: message.attachment?.toolCallId,
                                            actionId: action.id,
                                            value: action.value,
                                        )
                                    }
                                },
                            )
                            .id(message.id)
                        case .steps(let stepMessages):
                            IntermediateStepsView(
                                steps: stepMessages,
                                isActive: index == groups.count - 1
                                    && (lastChatMessageId == nil
                                        || (stepMessages.last?.timestamp ?? 0) > (messages.first { $0.messageId == lastChatMessageId }?.timestamp ?? 0)),
                            )
                            .id("steps-\(stepMessages.first?.messageId ?? "")")
                        }
                    }

                    // Immediate "thinking…" indicator — bridges the gap between
                    // sending and the agent's first status frame. Hidden once a
                    // real status block is active (agentIsWorking) or stopping.
                    if awaitingFirstResponse && !agentIsWorking && !isStoppingCurrentSession {
                        thinkingIndicator
                            .id("thinking-indicator")
                    }

                    // Bottom anchor — used to scroll to the latest message
                    Color.clear
                        .frame(height: 1)
                        .id("bottom-anchor")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .frame(maxWidth: Self.columnMaxWidth)
                .frame(maxWidth: .infinity)
            }
            // Tells SwiftUI to treat the bottom of the content as the
            // invariant point under content-size changes. Two consequences:
            //   1. Initial layout positions the bottom of content at the
            //      bottom of the viewport — no more scrollTo("bottom-anchor")
            //      racing the LazyVStack's first layout pass.
            //   2. When the agent posts new messages, the bottom stays in
            //      view (auto-scroll). When older pages prepend, visible
            //      content stays in place instead of jumping.
            // iOS 17 / macOS 14 — both deployment targets satisfy this.
            .defaultScrollAnchor(.bottom)
            // Force a fresh ScrollView whenever the thread switches so the
            // default-anchor logic re-applies cleanly. Without this, the
            // existing ScrollView's scroll state would persist across thread
            // switches and only sometimes re-anchor to the new content.
            .id(session.sessionId)
            #if os(iOS)
            // Drag the messages down to dismiss the keyboard — standard iOS chat-app gesture.
            .scrollDismissesKeyboard(.interactively)
            #endif
            // Belt-and-suspenders for the bulk-replace case (e.g. session
            // switch after the page was already cached). `defaultScrollAnchor`
            // covers initial layout; this catches edge cases where the
            // generation bumps but content size didn't actually change in a
            // way the anchor heuristic responds to.
            .onChange(of: page?.generation ?? 0) { _, _ in
                DispatchQueue.main.async {
                    proxy.scrollTo("bottom-anchor", anchor: .bottom)
                }
            }
            // New trailing message arriving from poll → scroll to bottom (gentle).
            // Mostly redundant with defaultScrollAnchor's auto-scroll, but the
            // animation timing matches the existing "you sent a message" UX.
            .onChange(of: messages.last?.id) { _, _ in
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo("bottom-anchor", anchor: .bottom)
                }
            }
        }
    }

    /// Invisible-ish progress row at the top of the message list. When SwiftUI lays it out
    /// (i.e. the user has scrolled near the top), it triggers loading the next older page.
    private func loadOlderTrigger(channel: String) -> some View {
        HStack(spacing: 8) {
            ProgressView()
                .controlSize(.small)
            Text("Loading older messages…")
                .font(.caption2)
                .foregroundStyle(BrandColors.inkFaint)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .task(id: channel) {
            // Tiny delay so this only fires when the user has dwelled at the top, not just
            // brushed past it on initial layout.
            try? await Task.sleep(nanoseconds: 200_000_000)
            await store.loadOlderMessages(channel: channel)
        }
    }

    /// Animated "thinking…" row shown immediately after the user sends, until
    /// the agent's first status frame arrives. Left-aligned to read as an agent
    /// turn-in-progress.
    private var thinkingIndicator: some View {
        HStack(spacing: 8) {
            ProgressView()
                .controlSize(.small)
            Text("Thinking…")
                .font(.caption)
                .foregroundStyle(BrandColors.inkMuted)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
        .transition(.opacity)
    }

    // MARK: - Input bar

    private var inputBar: some View {
        VStack(spacing: 0) {
            dragHandle

            if !pendingAttachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(pendingAttachments) { attachment in
                            AttachmentChip(attachment: attachment) {
                                pendingAttachments.removeAll { $0.id == attachment.id }
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                }
            }

            HStack(alignment: .bottom, spacing: 8) {
                paperclipControl

                inputField

                sendOrStopButton
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .frame(maxWidth: Self.columnMaxWidth)
        .frame(maxWidth: .infinity)
        .overlay(alignment: .top) {
            if slashSuggestionsOpen && !filteredSlashCommands.isEmpty {
                slashSuggestionsPopup
                    .alignmentGuide(.top) { d in d[.bottom] + 8 }   // float above the bar
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                    .zIndex(1)
            } else if mentionSuggestionsOpen && !mentionCandidates.isEmpty {
                mentionSuggestionsPopup
                    .alignmentGuide(.top) { d in d[.bottom] + 8 }
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                    .zIndex(1)
            }
        }
        .animation(.easeOut(duration: 0.12), value: slashSuggestionsOpen)
        .animation(.easeOut(duration: 0.12), value: mentionSuggestionsOpen)
        .onChange(of: draft.wrappedValue) { _, newValue in
            // Show the slash popup while the user is mid-command — `/`, `/r`,
            // `/restart`. Vanishes the instant they type a space, newline, or
            // anything that doesn't start with `/`. Keeps the popup anchored
            // to single-line command tokens; multi-arg commands (none today)
            // would relax this.
            let starts = newValue.hasPrefix("/")
                && !newValue.contains(" ")
                && !newValue.contains("\n")
            slashSuggestionsOpen = starts && !filteredSlashCommands.isEmpty
            if !slashSuggestionsOpen {
                slashSuggestionIndex = 0
            } else {
                slashSuggestionIndex = min(slashSuggestionIndex, max(filteredSlashCommands.count - 1, 0))
            }

            // Mention detection: trailing `@<chars>` — if the user is mid-
            // mention at the end of the draft, open the picker with the
            // filter set to what they've typed. Closes the instant they
            // type a space or newline. Mirrors the web behaviour where the
            // popup tracks the active `@…` token.
            let mentionMatch = Self.trailingMentionToken(in: newValue)
            mentionFilter = mentionMatch ?? ""
            mentionSuggestionsOpen = mentionMatch != nil && !mentionCandidates.isEmpty
            if !mentionSuggestionsOpen {
                mentionSuggestionIndex = 0
            } else {
                mentionSuggestionIndex = min(mentionSuggestionIndex, max(mentionCandidates.count - 1, 0))
            }
        }
        #if os(iOS)
        // iPhone/iPad: paperclip is a Menu offering Photos (PhotosPicker) and
        // Files (.fileImporter). Each option drives the same PendingAttachment
        // chip + multipart upload pipeline as macOS.
        .photosPicker(
            isPresented: $showingPhotoPicker,
            selection: $photoPickerItems,
            maxSelectionCount: 10,
            matching: .images,
            photoLibrary: .shared(),
        )
        .onChange(of: photoPickerItems) { _, items in
            guard !items.isEmpty else { return }
            let picked = items
            photoPickerItems = []
            Task { await ingestPhotoPickerItems(picked) }
        }
        .fileImporter(
            isPresented: $showingFileImporter,
            allowedContentTypes: [.item],
            allowsMultipleSelection: true,
        ) { result in
            if case .success(let urls) = result {
                for url in urls { ingestFileURL(url) }
            }
        }
        #endif
    }

    /// ChatGPT-style send/stop swap. The send arrow is replaced by a stop square
    /// while an agent is working in the current session — same position, so users
    /// don't have to look elsewhere to interrupt. Disabled while a stop is in
    /// flight (we already sent the control event and are waiting for terminal
    /// status to come back).
    @ViewBuilder
    private var sendOrStopButton: some View {
        if agentIsWorking || awaitingFirstResponse || isStoppingCurrentSession {
            Button(action: stopAgents) {
                Image(systemName: "stop.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(isStoppingCurrentSession ? Color.gray.opacity(0.5) : Color.red)
            }
            .buttonStyle(.plain)
            .disabled(isStoppingCurrentSession)
            .help(isStoppingCurrentSession ? "Stopping…" : "Stop agent")
        } else {
            Button(action: send) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(canSend ? BrandColors.primary : Color.gray.opacity(0.4))
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .help("Send message")
        }
    }

    private func stopAgents() {
        guard let id = store.currentSessionId else { return }
        logInfo("ui", "stop tapped session=\(id)")
        Task { await store.stopAllAgents(sessionId: id) }
    }

    /// Paperclip trigger.
    /// - macOS: single Button → `NSOpenPanel`.
    /// - iOS: `Menu` with two options — Photo Library and Files.
    @ViewBuilder
    private var paperclipControl: some View {
        let label = Image(systemName: "paperclip")
            .font(.system(size: 18, weight: .regular))
            .foregroundStyle(BrandColors.inkMuted)
            .frame(width: 32, height: 32)

        #if os(macOS)
        Button(action: pickFiles) { label }
            .buttonStyle(.plain)
            .help("Attach files")
        #else
        Menu {
            Button {
                showingPhotoPicker = true
            } label: {
                Label("Photo Library", systemImage: "photo.on.rectangle.angled")
            }
            Button {
                showingFileImporter = true
            } label: {
                Label("Files", systemImage: "folder")
            }
        } label: {
            label
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        #endif
    }

    /// Thin grab bar above the attachment row. Drag up to grow the input toward
    /// half the chat height; drag down to shrink back to single-line.
    private var dragHandle: some View {
        let handle = Capsule()
            .fill(Color.gray.opacity(0.35))
            .frame(width: 32, height: 3)

        return Color.clear
            .frame(height: 10)
            .overlay(handle)
            .contentShape(Rectangle())
            #if os(macOS)
            .onHover { inside in
                if inside {
                    NSCursor.resizeUpDown.push()
                } else {
                    NSCursor.pop()
                }
            }
            #endif
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        if dragStartHeight == nil { dragStartHeight = inputHeight }
                        let proposed = (dragStartHeight ?? inputHeight) - value.translation.height
                        inputHeight = max(Self.minInputHeight, min(maxInputHeight, proposed))
                    }
                    .onEnded { _ in dragStartHeight = nil },
            )
    }

    /// Native composer wrapping NSTextView (macOS) / UITextView (iOS). It owns
    /// IME-gated Return-to-send (`hasMarkedText` / `markedTextRange`) and image
    /// + file paste — both of which the stock SwiftUI `TextEditor` cannot do.
    /// Floating list of slash commands shown above the input bar while the
    /// user is typing a command. Mirrors the React `@mention` autocomplete
    /// feel: highlighted row tracks `slashSuggestionIndex`, click or Tab
    /// selects, Enter on an exact match sends, Esc dismisses. The matched
    /// prefix in each name is bolded so the user can see what's narrowing
    /// the list as they type.
    /// Parses the trailing `@<chars>` token from the draft, if any. Returns
    /// the token (without the `@`) so the picker can filter, or nil when
    /// the user isn't mid-mention. Allows lowercase, digits, and `-` —
    /// matches the backend's `_extract_mentions` regex.
    private static func trailingMentionToken(in text: String) -> String? {
        guard let atRange = text.range(of: "@", options: .backwards) else { return nil }
        let after = text[atRange.upperBound...]
        // Reject if there's a whitespace/newline between `@` and the cursor.
        if after.contains(where: { $0.isWhitespace || $0.isNewline }) { return nil }
        // Require either `@` at very start or whitespace immediately before.
        let before = text[..<atRange.lowerBound]
        if let last = before.last, !last.isWhitespace, !last.isNewline {
            return nil
        }
        return String(after)
    }

    /// Replace the trailing `@<filter>` token with `@<token> ` and
    /// dismiss the popup.
    private func insertMention(_ token: String) {
        let current = draft.wrappedValue
        guard let atRange = current.range(of: "@", options: .backwards) else { return }
        let prefix = current[..<atRange.lowerBound]
        draft.wrappedValue = String(prefix) + "@\(token) "
        mentionSuggestionsOpen = false
        mentionFilter = ""
        mentionSuggestionIndex = 0
    }

    private var mentionSuggestionsPopup: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(mentionCandidates.enumerated()), id: \.element.id) { idx, cand in
                HStack(spacing: 10) {
                    Image(systemName: cand.kind == .agent ? "cpu" : "person.crop.circle")
                        .frame(width: 22)
                        .foregroundStyle(cand.kind == .agent ? BrandColors.primary : .secondary)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(cand.label).font(.body)
                        if let sub = cand.subtitle, !sub.isEmpty {
                            Text(sub)
                                .font(.caption)
                                .foregroundStyle(BrandColors.inkMuted)
                        }
                    }
                    Spacer(minLength: 0)
                    Text("@\(cand.token)")
                        .font(.caption.monospaced())
                        .foregroundStyle(BrandColors.inkFaint)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(idx == mentionSuggestionIndex ? BrandColors.primary.opacity(0.15) : Color.clear)
                .contentShape(Rectangle())
                .onTapGesture { insertMention(cand.token) }
            }
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(.black.opacity(0.08), lineWidth: 0.5),
        )
        .frame(maxWidth: 360, alignment: .leading)
        .padding(.horizontal, 12)
    }

    private var slashSuggestionsPopup: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(filteredSlashCommands.enumerated()), id: \.element.id) { idx, cmd in
                HStack(spacing: 10) {
                    Image(systemName: cmd.systemImage)
                        .frame(width: 22)
                        .foregroundStyle(BrandColors.inkMuted)
                    VStack(alignment: .leading, spacing: 1) {
                        slashName(for: cmd)
                            .font(.body)
                        Text(cmd.description)
                            .font(.caption)
                            .foregroundStyle(BrandColors.inkMuted)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(idx == slashSuggestionIndex ? BrandColors.primary.opacity(0.15) : Color.clear)
                .contentShape(Rectangle())
                .onTapGesture {
                    draft.wrappedValue = "/\(cmd.name)"
                    slashSuggestionsOpen = false
                }
            }
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(.black.opacity(0.08), lineWidth: 0.5),
        )
        .frame(maxWidth: 360, alignment: .leading)
        .padding(.horizontal, 12)
    }

    private var inputField: some View {
        ComposerTextView(
            text: draft,
            height: inputHeight,
            placeholder: "Message",
            isFocused: $inputFocused,
            onSend: { send() },
            onPasteImages: { attachments in
                pendingAttachments.append(contentsOf: attachments)
            },
            onPasteFileURLs: { urls in
                for url in urls { ingestFileURL(url) }
            },
            onSlashKey: consumeSlashKey,
        )
    }

    /// Called by `ComposerTextView` (macOS NSTextView delegate) for every
    /// command selector while the composer holds focus. Returns true if the
    /// slash-command popup consumed the key — in that case the composer
    /// short-circuits and won't run its own Return-to-send logic.
    /// Render `/<name>` with the part the user has typed so far rendered in
    /// bold, so as the popup narrows down the highlight tracks the keystrokes.
    /// Composes two Text values; SwiftUI's `+` concatenation keeps everything
    /// in a single line.
    private func slashName(for cmd: SlashCommand) -> Text {
        let typed = String(draft.wrappedValue.dropFirst()).lowercased()
        let matchLen = min(typed.count, cmd.name.count)
        let head = String(cmd.name.prefix(matchLen))
        let tail = String(cmd.name.dropFirst(matchLen))
        return Text("/").foregroundStyle(BrandColors.inkMuted)
            + Text(head).fontWeight(.bold)
            + Text(tail).fontWeight(.regular).foregroundStyle(BrandColors.inkMuted)
    }

    private func consumeSlashKey(_ selector: Selector) -> Bool {
        guard slashSuggestionsOpen else { return false }
        let count = filteredSlashCommands.count
        guard count > 0 else { return false }

        // We can't use #selector against AppKit symbols inside a SwiftUI struct
        // without importing AppKit, so match on the raw string. These are the
        // standard NSResponder selectors AppKit emits for the relevant keys.
        switch NSStringFromSelector(selector) {
        case "moveDown:":
            slashSuggestionIndex = min(slashSuggestionIndex + 1, count - 1)
            return true
        case "moveUp:":
            slashSuggestionIndex = max(slashSuggestionIndex - 1, 0)
            return true
        case "insertTab:":
            // Tab fills the input with the highlighted command but doesn't send.
            // Lets the user read the description, then press Enter to fire.
            let cmd = filteredSlashCommands[slashSuggestionIndex]
            draft.wrappedValue = "/\(cmd.name)"
            slashSuggestionsOpen = false
            return true
        case "insertNewline:":
            // Enter on the popup: if the typed text already exactly matches a
            // command (e.g. user typed "/restart" and hit Enter), let the
            // composer's normal Return-to-send path run — that hits handleSlashCommand.
            // Otherwise, treat Enter as "select highlighted suggestion".
            let typed = String(draft.wrappedValue.dropFirst()).lowercased()
            if typed == filteredSlashCommands[slashSuggestionIndex].name {
                slashSuggestionsOpen = false
                return false   // fall through → composer fires onSend → handleSlashCommand
            }
            let cmd = filteredSlashCommands[slashSuggestionIndex]
            draft.wrappedValue = "/\(cmd.name)"
            slashSuggestionsOpen = false
            return true
        case "cancelOperation:":
            slashSuggestionsOpen = false
            return true
        default:
            return false
        }
    }

    private var placeholder: some View {
        VStack(spacing: 12) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 48))
                .foregroundStyle(BrandColors.inkFaint)
            Text("Select a chat")
                .font(.title3)
                .foregroundStyle(BrandColors.inkMuted)
            Text("Choose a chat from the list or create a new one.")
                .font(.subheadline)
                .foregroundStyle(BrandColors.inkFaint)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Actions

    private func send() {
        let text = draft.wrappedValue
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)

        // Slash-command interception. Typed commands never reach the backend
        // as chat messages — they dispatch to a local handler.
        if trimmed.hasPrefix("/"), pendingAttachments.isEmpty {
            handleSlashCommand(trimmed)
            return
        }

        let attachments = pendingAttachments
        guard !trimmed.isEmpty || !attachments.isEmpty else {
            logWarn("ui", "send() ignored — empty draft and no attachments")
            return
        }
        logInfo("ui", "send() invoked, chars=\(trimmed.count) attachments=\(attachments.count)")
        draft.wrappedValue = ""
        pendingAttachments = []
        let senderName = auth.senderName
        let senderEmail = auth.user?.email
        let senderDisplayName = auth.user?.displayName
        Task {
            await store.sendMessage(
                trimmed,
                senderName: senderName,
                senderEmail: senderEmail,
                senderDisplayName: senderDisplayName,
                attachments: attachments,
            )
        }
    }

    /// Parse a typed slash command (the leading "/" plus optional args) and
    /// dispatch to the matching action. Unknown commands surface via the
    /// existing error banner so users see immediate feedback without leaving
    /// the composer.
    private func handleSlashCommand(_ raw: String) {
        let body = raw.dropFirst() // drop leading "/"
        let head = body
            .split(separator: " ", maxSplits: 1)
            .first
            .map(String.init)?
            .lowercased() ?? ""

        switch head {
        case "restart":
            guard let id = store.currentSessionId else {
                store.lastError = "/restart requires an active session."
                return
            }
            logInfo("ui", "/restart invoked session=\(id)")
            draft.wrappedValue = ""
            slashSuggestionsOpen = false
            // Chain restart → status. Control events are FIFO per agent, so
            // the agent processes restart first (clears session, posts the
            // terminal "Session restarted" status), then immediately processes
            // status (posts uptime / version / network). The user gets a
            // visible confirmation that the restart took effect with a 0s
            // uptime in the follow-up status block.
            Task {
                await store.restartSession(sessionId: id)
                await store.requestSessionStatus(sessionId: id)
            }
        case "status":
            guard let id = store.currentSessionId else {
                store.lastError = "/status requires an active session."
                return
            }
            logInfo("ui", "/status invoked session=\(id)")
            draft.wrappedValue = ""
            slashSuggestionsOpen = false
            Task { await store.requestSessionStatus(sessionId: id) }
        case "routines":
            guard let id = store.currentSessionId else {
                store.lastError = "/routines requires an active session."
                return
            }
            logInfo("ui", "/routines invoked session=\(id)")
            draft.wrappedValue = ""
            slashSuggestionsOpen = false
            Task { await store.requestSessionRoutines(sessionId: id) }
        default:
            store.lastError = "Unknown command: /\(head). Available: /restart, /status, /routines"
        }
    }

    /// Move externally-delivered files (iOS "Open in…", macOS "Open With",
    /// drag-onto-dock) from the router buffer into the local composer. Only
    /// drains when there's a current session — otherwise the files sit on the
    /// router until the user picks a thread.
    private func drainExternalAttachments() {
        guard !router.pendingExternalAttachments.isEmpty,
              store.currentSessionId != nil else { return }
        pendingAttachments.append(contentsOf: router.pendingExternalAttachments)
        router.pendingExternalAttachments.removeAll()
    }

    #if os(macOS)
    private func pickFiles() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.message = "Choose files to send"
        if panel.runModal() == .OK {
            for url in panel.urls { ingestFileURL(url) }
        }
    }
    #endif

    #if os(iOS)
    /// Convert PhotosPicker selections into PendingAttachment entries. We
    /// load the raw image bytes via `loadTransferable(type: Data.self)` so the
    /// chip + upload path is identical to the macOS pasted/file-picker flow.
    @MainActor
    private func ingestPhotoPickerItems(_ items: [PhotosPickerItem]) async {
        for (index, item) in items.enumerated() {
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else { continue }
                let utType = item.supportedContentTypes.first
                let ext = utType?.preferredFilenameExtension ?? "jpg"
                let mime = utType?.preferredMIMEType ?? "image/jpeg"
                let stamp = Int(Date().timeIntervalSince1970)
                let (finalData, finalType, finalName) = ImageDownsampler.ensureFits(
                    data: data,
                    contentType: mime,
                    filename: "Photo-\(stamp)-\(index).\(ext)",
                )
                pendingAttachments.append(PendingAttachment(
                    filename: finalName,
                    contentType: finalType,
                    data: finalData,
                ))
            } catch {
                logError("ui", "photo ingest failed: \(error.localizedDescription)")
            }
        }
    }
    #endif


    /// Accept dropped items into `pendingAttachments`. Handles two shapes:
    /// - File URL providers (Finder / Files / most desktop drags) → read the
    ///   bytes inside the load callback before the OS-staged temp file is
    ///   reclaimed, then route through the same ingest path as the paperclip.
    /// - In-memory image providers (browsers, screenshot tools) → load as Data
    ///   and synthesize a filename so the upload still has a basename.
    /// Returns true so SwiftUI animates the drop landing even if individual
    /// providers fail asynchronously — we surface failures via the debug log.
    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        let fileType = UTType.fileURL.identifier
        let imageType = UTType.image.identifier
        var accepted = false

        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(fileType) {
                accepted = true
                provider.loadFileRepresentation(forTypeIdentifier: fileType) { url, error in
                    guard let url else {
                        logError("ui", "drop: loadFileRepresentation failed — \(error?.localizedDescription ?? "unknown")")
                        return
                    }
                    // The OS deletes the staged file when this closure returns,
                    // so read into memory here, then hand the bytes to the
                    // main-actor ingest function.
                    guard let data = try? Data(contentsOf: url) else {
                        logError("ui", "drop: could not read \(url.lastPathComponent)")
                        return
                    }
                    let name = url.lastPathComponent
                    let mime = (UTType(filenameExtension: url.pathExtension)?.preferredMIMEType)
                        ?? "application/octet-stream"
                    Task { @MainActor in
                        ingestDroppedData(data, filename: name, contentType: mime)
                    }
                }
                continue
            }
            if provider.hasItemConformingToTypeIdentifier(imageType) {
                accepted = true
                provider.loadDataRepresentation(forTypeIdentifier: imageType) { data, error in
                    guard let data else {
                        logError("ui", "drop: image loadData failed — \(error?.localizedDescription ?? "unknown")")
                        return
                    }
                    let stamp = Int(Date().timeIntervalSince1970)
                    Task { @MainActor in
                        ingestDroppedData(data, filename: "DroppedImage-\(stamp).png", contentType: "image/png")
                    }
                }
            }
        }
        return accepted
    }

    /// Shared tail for dropped data — runs `ImageDownsampler.ensureFits`
    /// (matches the paste / picker pipelines) and appends a chip.
    @MainActor
    private func ingestDroppedData(_ data: Data, filename: String, contentType: String) {
        let (finalData, finalType, finalName) = ImageDownsampler.ensureFits(
            data: data,
            contentType: contentType,
            filename: filename,
        )
        pendingAttachments.append(PendingAttachment(
            filename: finalName,
            contentType: finalType,
            data: finalData,
        ))
        logInfo("ui", "drop accepted name=\(finalName) bytes=\(finalData.count)")
    }

    @MainActor
    private func ingestFileURL(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            logError("ui", "ingest failed — could not read \(url.lastPathComponent)")
            return
        }
        let mime = (UTType(filenameExtension: url.pathExtension)?.preferredMIMEType)
            ?? "application/octet-stream"
        let (finalData, finalType, finalName) = ImageDownsampler.ensureFits(
            data: data,
            contentType: mime,
            filename: url.lastPathComponent,
        )
        pendingAttachments.append(PendingAttachment(
            filename: finalName,
            contentType: finalType,
            data: finalData,
        ))
    }

    /// Show the sender label only on the first chat message in a run from the same agent.
    private func shouldShowSenderLabel(for message: Message, groupIndex: Int, in groups: [MessageGroup]) -> Bool {
        if message.isFromUser { return false }
        guard groupIndex > 0 else { return true }
        // Look back through prior groups for the most recent chat message
        for prior in (0..<groupIndex).reversed() {
            if case .chat(let prev) = groups[prior] {
                return prev.senderName != message.senderName
            }
            // .steps groups don't reset sender grouping
        }
        return true
    }
}

// MARK: - Message grouping

enum MessageGroup {
    case chat(Message)
    case steps([Message])
}

enum MessageGrouper {
    /// Mirrors React's groupMessages — collapses consecutive status/thinking messages into
    /// a single steps block so they render under one indented border.
    static func group(_ messages: [Message]) -> [MessageGroup] {
        var groups: [MessageGroup] = []
        var bufferedSteps: [Message] = []

        func flush() {
            if !bufferedSteps.isEmpty {
                groups.append(.steps(bufferedSteps))
                bufferedSteps = []
            }
        }

        for message in messages {
            if message.isStatus {
                bufferedSteps.append(message)
            } else {
                flush()
                groups.append(.chat(message))
            }
        }
        flush()
        return groups
    }
}

// MARK: - Layout helpers

private struct ChatHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

private struct BubbleRowWidthKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

// MARK: - Bubble subviews

private struct CodeBlockView: View {
    let language: String?
    let content: String
    /// Whether this code block is inside an agent (light) bubble vs. user (blue) bubble.
    let onLightBubble: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let language, !language.isEmpty {
                Text(language)
                    .font(.caption2.monospaced())
                    .foregroundStyle(BrandColors.inkMuted)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                Text(content)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(onLightBubble ? Color.primary : Color.white)
                    .padding(8)
                    .textSelection(.enabled)
            }
        }
        .background(onLightBubble ? Color.black.opacity(0.06) : Color.white.opacity(0.18))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

private struct TableView: View {
    let headers: [String]
    let rows: [[String]]
    let alignments: [MarkdownTableAlignment]
    let onLightBubble: Bool

    var body: some View {
        // Per-column policy: leading columns hug their content at natural
        // width; the *last* column gets `maxWidth: .infinity` so Grid lets it
        // expand to fill the bubble. Without this, Grid would settle at some
        // "comfortable readable width" for descriptive cells and leave the
        // right side of the bubble empty.
        let columnCount = max(headers.count, rows.map(\.count).max() ?? 0)

        return Grid(alignment: .topLeading, horizontalSpacing: 14, verticalSpacing: 4) {
            GridRow {
                ForEach(Array(headers.enumerated()), id: \.offset) { i, header in
                    cell(header, bold: true, columnIndex: i, columnCount: columnCount)
                        .gridColumnAlignment(swiftAlignment(at: i))
                }
            }
            Divider().gridCellUnsizedAxes(.horizontal)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                GridRow {
                    ForEach(Array(row.enumerated()), id: \.offset) { i, value in
                        cell(value, bold: false, columnIndex: i, columnCount: columnCount)
                    }
                }
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(onLightBubble ? Color.black.opacity(0.04) : Color.white.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func cell(_ text: String, bold: Bool, columnIndex: Int, columnCount: Int) -> some View {
        // fixedSize(horizontal: false, vertical: true) lets the cell shrink
        // horizontally (wrap) under width pressure but always show its full
        // wrapped height.
        // The last column gets `frame(maxWidth: .infinity, alignment:)` so
        // Grid hands it the leftover width — this is the modifier that
        // actually makes a 2-col "label / description" table reach the
        // bubble's right edge.
        let isLastColumn = columnIndex == columnCount - 1
        return Text(.init(text))
            .font(bold ? .caption.bold() : .caption)
            .foregroundStyle(onLightBubble ? Color.primary : Color.white)
            .multilineTextAlignment(textAlignment(at: columnIndex))
            .fixedSize(horizontal: false, vertical: true)
            .frame(
                maxWidth: isLastColumn ? .infinity : nil,
                alignment: frameAlignment(at: columnIndex),
            )
            .padding(.vertical, bold ? 4 : 3)
    }

    private func frameAlignment(at i: Int) -> Alignment {
        guard i < alignments.count else { return .leading }
        switch alignments[i] {
        case .leading:  return .leading
        case .center:   return .center
        case .trailing: return .trailing
        }
    }

    private func swiftAlignment(at i: Int) -> HorizontalAlignment {
        guard i < alignments.count else { return .leading }
        switch alignments[i] {
        case .leading:  return .leading
        case .center:   return .center
        case .trailing: return .trailing
        }
    }

    private func textAlignment(at i: Int) -> TextAlignment {
        guard i < alignments.count else { return .leading }
        switch alignments[i] {
        case .leading:  return .leading
        case .center:   return .center
        case .trailing: return .trailing
        }
    }
}

private struct AttachmentChip: View {
    let attachment: PendingAttachment
    let onRemove: () -> Void

    /// Cached thumbnail decoded once on first appear so we don't re-decode
    /// every time SwiftUI re-runs `body`.
    @State private var thumbnail: PlatformImage?

    var body: some View {
        Group {
            if attachment.isImage {
                imageVariant
            } else {
                fileVariant
            }
        }
        .onAppear { loadThumbnailIfNeeded() }
        .help("\(attachment.filename) — \(formattedSize)")
    }

    /// 48×48 thumbnail with a small remove button overlay in the top-right
    /// corner. Slack / iMessage / ChatGPT all use this pattern; the visual
    /// is the identification, so we don't show the synthetic filename.
    private var imageVariant: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let image = thumbnail {
                    #if os(macOS)
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFill()
                    #else
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                    #endif
                } else {
                    // Placeholder while ImageIO decodes — only visible for
                    // a frame or two on first paste of a large image.
                    Rectangle()
                        .fill(Color.gray.opacity(0.18))
                        .overlay {
                            Image(systemName: "photo")
                                .foregroundStyle(BrandColors.inkMuted)
                        }
                }
            }
            .frame(width: 48, height: 48)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(.black.opacity(0.08), lineWidth: 0.5),
            )

            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, .black.opacity(0.55))
                    .font(.system(size: 16))
            }
            .buttonStyle(.plain)
            .offset(x: 6, y: -6)
        }
    }

    /// Slack-style file row: paperclip + filename + size + remove. Used for
    /// non-image attachments (pasted text-as-file, picked documents, etc.).
    private var fileVariant: some View {
        HStack(spacing: 6) {
            Image(systemName: "doc")
                .font(.caption)
                .foregroundStyle(BrandColors.inkMuted)
            Text(attachment.filename)
                .font(.caption)
                .lineLimit(1)
                .truncationMode(.middle)
            Text(formattedSize)
                .font(.caption2)
                .foregroundStyle(BrandColors.inkMuted)
            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(BrandColors.inkMuted)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(.regularMaterial, in: Capsule())
        .frame(maxWidth: 240)
    }

    private func loadThumbnailIfNeeded() {
        guard attachment.isImage, thumbnail == nil else { return }
        thumbnail = attachment.makeThumbnail(maxSide: 48)
    }

    private var formattedSize: String {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useKB, .useMB, .useGB]
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(attachment.size))
    }
}

private struct ErrorBanner: View {
    let message: String
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            Text(message)
                .font(.caption)
                .foregroundStyle(BrandColors.inkStrong)
                .lineLimit(2)
            Spacer()
            Button {
                onDismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.caption2)
                    .foregroundStyle(BrandColors.inkMuted)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.orange.opacity(0.12))
    }
}

private struct MessageBubble: View {
    let message: Message
    var showSenderLabel: Bool = true
    /// Fired when the user interacts with an A2UI-rendered component. Caller
    /// is responsible for routing this back to the agent (typically via
    /// `WorkspaceStore.sendToolResult`).
    var onAttachmentAction: ((A2UIAction) -> Void)? = nil

    /// Opposite-side gap between the bubble and the chat edge.
    private static let sideGap: CGFloat = 60

    /// Live width of the row, captured via a GeometryReader background.
    /// We use this to set an *explicit* bubble width for messages with wide
    /// content (tables/code) — relying on flex distribution between
    /// `maxWidth: .infinity` and `Spacer(minLength:)` was unreliable; HStack
    /// would split width between them and the bubble never claimed enough.
    @State private var rowWidth: CGFloat = 0

    /// Tracks the brief "Copied" feedback state after the copy button is tapped.
    @State private var didCopy: Bool = false

    var body: some View {
        let segments = MarkdownSegmenter.segments(in: message.content)
        let hasAttachment = message.attachment != nil
        let hasWideContent = hasAttachment || segments.contains { segment in
            switch segment {
            case .prose, .fileChip: return false
            case .code, .table, .htmlBlock: return true
            }
        }
        let bubbleWidth: CGFloat? = (hasWideContent && rowWidth > Self.sideGap)
            ? rowWidth - Self.sideGap
            : nil

        return HStack(spacing: 0) {
            if message.isFromUser {
                Spacer(minLength: Self.sideGap)
                bubble(alignment: .trailing, segments: segments, fillsRow: hasWideContent)
                    .frame(width: bubbleWidth, alignment: .trailing)
            } else {
                bubble(alignment: .leading, segments: segments, fillsRow: hasWideContent)
                    .frame(width: bubbleWidth, alignment: .leading)
                Spacer(minLength: Self.sideGap)
            }
        }
        // Force the row to fill the chat panel, otherwise HStack would size to
        // its content (bubble + Spacer.minLength) and the GeometryReader below
        // would read that content-width instead of the panel width.
        .frame(maxWidth: .infinity, alignment: message.isFromUser ? .trailing : .leading)
        .background(
            GeometryReader { geo in
                Color.clear
                    .preference(key: BubbleRowWidthKey.self, value: geo.size.width)
            },
        )
        .onPreferenceChange(BubbleRowWidthKey.self) { width in
            if abs(rowWidth - width) > 0.5 {
                logInfo("ui", "bubble row width=\(Int(width)) hasWide=\(hasWideContent)")
            }
            rowWidth = width
        }
    }

    @ViewBuilder
    private func bubble(
        alignment: HorizontalAlignment,
        segments: [MarkdownSegment],
        fillsRow: Bool,
    ) -> some View {
        let textAlignment: TextAlignment = (alignment == .trailing) ? .trailing : .leading
        let frameAlignment: Alignment = (alignment == .trailing) ? .trailing : .leading

        VStack(alignment: alignment, spacing: 2) {
            if !message.isFromUser && showSenderLabel {
                Text(message.senderName)
                    .font(.caption2)
                    .foregroundStyle(BrandColors.inkMuted)
                    .padding(.leading, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            // Text bubble — rendered only when there are non-empty segments.
            // The A2UI attachment lives OUTSIDE this bubble's chrome (see below)
            // so a spec doesn't get visually merged with narration / error text
            // into one big container.
            let hasVisibleSegments = segments.contains { seg in
                switch seg {
                case .prose(let t): return !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                case .code, .htmlBlock, .fileChip, .table: return true
                }
            }
            if hasVisibleSegments {
                VStack(alignment: alignment, spacing: 6) {
                    ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                        switch segment {
                        case .prose(let text):
                            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                            if !trimmed.isEmpty {
                                // For prose-only bubbles we let the Text size to its content so short
                                // messages ("hi") hug the text. When the row contains wide content
                                // (code/table), we still expand prose to row width so it aligns with
                                // those blocks.
                                if fillsRow {
                                    Text(.init(trimmed))
                                        .textSelection(.enabled)
                                        .multilineTextAlignment(textAlignment)
                                        .fixedSize(horizontal: false, vertical: true)
                                        .frame(maxWidth: .infinity, alignment: frameAlignment)
                                } else {
                                    Text(.init(trimmed))
                                        .textSelection(.enabled)
                                        .multilineTextAlignment(textAlignment)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        case .code(let lang, let code):
                            CodeBlockView(language: lang, content: code, onLightBubble: !message.isFromUser)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        case .htmlBlock(let html):
                            HTMLBlockView(html: html, onLightBubble: !message.isFromUser)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        case .fileChip(let fileId, let label):
                            FileChipView(fileId: fileId, label: label, onLightBubble: !message.isFromUser)
                                .frame(maxWidth: .infinity, alignment: alignment == .trailing ? .trailing : .leading)
                        case .table(let headers, let rows, let alignments):
                            TableView(
                                headers: headers,
                                rows: rows,
                                alignments: alignments,
                                onLightBubble: !message.isFromUser,
                            )
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                // Only force full-row width when the bubble actually contains code/table; otherwise
                // let it shrink to its prose content.
                .modifier(BubbleFillModifier(fillsRow: fillsRow, alignment: frameAlignment))
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(bubbleBackground)
                .foregroundStyle(message.isFromUser ? .white : .primary)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(.black.opacity(message.isFromUser ? 0 : 0.06), lineWidth: 0.5),
                )
            }

            // A2UI attachment renders as its own standalone element, NOT inside
            // the text bubble. Lets the spec own its visual identity instead
            // of being swallowed by the surrounding chat-bubble chrome. Capped
            // at 420pt so primary buttons (which explicitly request maxWidth=
            // .infinity inside SwiftUIJSONRender) don't stretch across the
            // whole chat panel — matches iMessage app-card sizing.
            if let attachment = message.attachment {
                A2UIRendererView(json: attachment.json) { action in
                    onAttachmentAction?(action)
                }
                .frame(maxWidth: 420, alignment: .leading)
                .padding(.top, hasVisibleSegments ? 6 : 0)
            }

            if !message.isFromUser {
                copyButton
                    .padding(.leading, 8)
            }
        }
    }

    /// Mirrors the React UI: a small "Copy" / "Copied" button under each agent
    /// message that puts the raw markdown content on the system pasteboard.
    /// We deliberately copy `message.content` rather than the rendered text so
    /// the result is portable to other markdown-aware tools.
    @ViewBuilder
    private var copyButton: some View {
        Button {
            copyToPasteboard(message.content)
            didCopy = true
            Task {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                await MainActor.run { didCopy = false }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: didCopy ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 10, weight: .medium))
                Text(didCopy ? "Copied" : "Copy")
                    .font(.system(size: 11))
            }
            .foregroundStyle(BrandColors.inkMuted)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(didCopy ? "Copied" : "Copy message")
    }

    private func copyToPasteboard(_ text: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #else
        UIPasteboard.general.string = text
        #endif
    }

    private var bubbleBackground: Color {
        message.isFromUser ? Color.blue : Color.gray.opacity(0.18)
    }
}

private struct BubbleFillModifier: ViewModifier {
    let fillsRow: Bool
    let alignment: Alignment

    func body(content: Content) -> some View {
        if fillsRow {
            content.frame(maxWidth: .infinity, alignment: alignment)
        } else {
            content
        }
    }
}

/// iMessage-style channel member sheet: a list of current channel members
/// up top with per-row Remove (gated by an alert), and below it a search +
/// list of online workspace agents not yet in the channel, each with Add.
/// Routine channels (`routines:<agent>`) are membership-locked — the sheet
/// shows a notice and hides the edit controls entirely.
private struct MembersSheet: View {
    let session: Session
    @Binding var isPresented: Bool
    @Environment(WorkspaceStore.self) private var store

    @State private var searchText: String = ""
    @State private var pendingRemove: Agent?

    private var members: [Agent] {
        store.agents.filter { session.participants.contains($0.agentName) }
    }

    private var addableAgents: [Agent] {
        let inChannel = Set(session.participants)
        let online = store.agents.filter { $0.isOnline && !inChannel.contains($0.agentName) }
        let q = searchText.trimmingCharacters(in: .whitespaces).lowercased()
        if q.isEmpty { return online }
        return online.filter { $0.agentName.lowercased().contains(q) }
    }

    var body: some View {
        NavigationStack {
            Group {
                if session.isRoutineChannel {
                    routineLockedView
                } else {
                    editableList
                }
            }
            .navigationTitle("Channel Members")
            #if os(macOS)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { isPresented = false }
                }
            }
            #else
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { isPresented = false }
                }
            }
            #endif
            .alert(
                "Remove \(pendingRemove?.agentName ?? "agent")?",
                isPresented: Binding(
                    get: { pendingRemove != nil },
                    set: { if !$0 { pendingRemove = nil } },
                ),
                presenting: pendingRemove,
            ) { agent in
                Button("Remove", role: .destructive) {
                    Task {
                        await store.removeAgentFromSession(
                            sessionId: session.sessionId,
                            agentName: agent.agentName,
                        )
                        pendingRemove = nil
                    }
                }
                Button("Cancel", role: .cancel) { pendingRemove = nil }
            } message: { agent in
                Text("\(agent.agentName) will stop receiving messages on this channel.")
            }
        }
        .frame(minWidth: 380, minHeight: 460)
    }

    private var routineLockedView: some View {
        List {
            Section {
                ForEach(members) { agent in
                    memberRow(agent, removable: false)
                }
            } header: {
                Text("OWNER")
            } footer: {
                Text("This channel is a routine queue — membership is managed by the system.")
                    .font(.caption)
                    .foregroundStyle(BrandColors.inkMuted)
            }
        }
    }

    private var editableList: some View {
        List {
            Section("IN THIS CHANNEL (\(members.count))") {
                if members.isEmpty {
                    Text("No agents yet.")
                        .foregroundStyle(BrandColors.inkMuted)
                } else {
                    ForEach(members) { agent in
                        memberRow(agent, removable: true)
                    }
                }
            }

            Section("ADD AGENTS") {
                #if os(iOS)
                TextField("Search online agents", text: $searchText)
                    .textFieldStyle(.roundedBorder)
                #else
                TextField("Search online agents", text: $searchText)
                #endif

                if addableAgents.isEmpty {
                    Text(searchText.isEmpty ? "No online agents available." : "No matches.")
                        .foregroundStyle(BrandColors.inkMuted)
                        .font(.subheadline)
                } else {
                    ForEach(addableAgents) { agent in
                        HStack(spacing: 10) {
                            AvatarStack(agents: [agent])
                                .frame(width: 28, height: 28)
                            Text(agent.agentName)
                            Spacer()
                            Button("Add") {
                                Task {
                                    await store.addAgentToSession(
                                        sessionId: session.sessionId,
                                        agentName: agent.agentName,
                                    )
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func memberRow(_ agent: Agent, removable: Bool) -> some View {
        HStack(spacing: 10) {
            AvatarStack(agents: [agent])
                .frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 1) {
                Text(agent.agentName)
                if session.master == agent.agentName {
                    Text("master")
                        .font(.caption2)
                        .foregroundStyle(BrandColors.inkMuted)
                }
            }
            Spacer()
            if removable {
                Button("Remove", role: .destructive) {
                    pendingRemove = agent
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
    }
}
