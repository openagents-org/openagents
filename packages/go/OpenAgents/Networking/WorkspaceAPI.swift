import Foundation

/// HTTP client for the OpenAgents workspace backend. Mirrors the subset of `lib/api.ts`
/// that the iMessage-style UI needs.
actor WorkspaceAPI {
    static var defaultBaseURL: URL { WorkspaceURLs.defaultAPIURL }

    private var baseURL: URL
    private var workspaceId: String = ""
    private var token: String = ""
    private let session: URLSession

    init(baseURL: URL = WorkspaceURLs.defaultAPIURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func configure(workspaceId: String, token: String, baseURL: URL? = nil) {
        self.workspaceId = workspaceId
        self.token = token
        if let baseURL { self.baseURL = baseURL }
    }

    var isConfigured: Bool { !workspaceId.isEmpty }

    // MARK: - Generic request helpers

    private func makeRequest(
        path: String,
        method: String = "GET",
        query: [(String, String)] = [],
        body: Data? = nil,
    ) throws -> URLRequest {
        guard !workspaceId.isEmpty else { throw APIError.notConfigured }

        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.0, value: $0.1) }
        }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty {
            request.setValue(token, forHTTPHeaderField: "X-Workspace-Token")
        }
        if let body {
            request.httpBody = body
        }
        return request
    }

    private func send<T: Decodable & Sendable>(
        _ request: URLRequest,
        as type: T.Type,
    ) async throws -> T {
        let method = request.httpMethod ?? "GET"
        let urlDescription = request.url?.absoluteString ?? "<no url>"
        let started = Date()

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            logError("http", "\(method) \(urlDescription) — transport error: \(error.localizedDescription)")
            throw APIError.transport(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            logError("http", "\(method) \(urlDescription) — non-HTTP response")
            throw APIError.transport("Non-HTTP response")
        }
        let elapsedMs = Int(Date().timeIntervalSince(started) * 1000)
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? "<binary>"
            let truncated = body.count > 300 ? String(body.prefix(300)) + "…" : body
            logError("http", "\(method) \(urlDescription) → \(http.statusCode) (\(elapsedMs)ms) body=\(truncated)")
            throw APIError.http(status: http.statusCode, body: body)
        }

        do {
            let envelope = try JSONDecoder().decode(APIEnvelope<T>.self, from: data)
            logInfo("http", "\(method) \(urlDescription) → \(http.statusCode) (\(elapsedMs)ms, \(data.count) bytes)")
            return envelope.data
        } catch {
            logError("http", "\(method) \(urlDescription) → \(http.statusCode) decode failed: \(error.localizedDescription)")
            throw APIError.decoding(error.localizedDescription)
        }
    }

    // MARK: - Server-Sent Events

    /// Open the workspace SSE stream for `channel` and yield one signal per
    /// `data:` frame. The caller treats each signal as "new events exist" and
    /// does an incremental forward poll — reusing the dedup / optimistic-
    /// reconcile / notification path in `WorkspaceStore.pollNewMessages` rather
    /// than decoding+appending on a second code path. Throws on connection
    /// failure so the caller can fall back to polling, mirroring the web
    /// client's `EventSource(onerror → startPolling)` in `hooks/use-polling.ts`.
    ///
    /// Connects to `GET /v1/events/stream?network=&channel=&token=`. The token
    /// is sent both as a query param (parity with the browser `EventSource`,
    /// which can't set headers) and as `X-Workspace-Token`.
    func streamEvents(channel: String) -> AsyncThrowingStream<Void, Error> {
        // Snapshot immutable copies of actor state up front so the long-lived
        // producer task touches no actor-isolated storage while it runs.
        let workspaceId = self.workspaceId
        let token = self.token
        let baseURL = self.baseURL
        let session = self.session

        return AsyncThrowingStream { continuation in
            let producer = Task {
                do {
                    guard !workspaceId.isEmpty else { throw APIError.notConfigured }

                    var components = URLComponents(
                        url: baseURL.appendingPathComponent("/v1/events/stream"),
                        resolvingAgainstBaseURL: false,
                    )!
                    var items = [
                        URLQueryItem(name: "network", value: workspaceId),
                        URLQueryItem(name: "channel", value: channel),
                    ]
                    if !token.isEmpty { items.append(URLQueryItem(name: "token", value: token)) }
                    components.queryItems = items

                    var request = URLRequest(url: components.url!)
                    request.httpMethod = "GET"
                    // Long-lived stream — rely on the server's heartbeats to keep
                    // it open rather than the default 60s request timeout.
                    request.timeoutInterval = 3600
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                    if !token.isEmpty {
                        request.setValue(token, forHTTPHeaderField: "X-Workspace-Token")
                    }

                    let (bytes, response) = try await session.bytes(for: request)
                    guard let http = response as? HTTPURLResponse else {
                        throw APIError.transport("Non-HTTP response")
                    }
                    guard (200..<300).contains(http.statusCode) else {
                        throw APIError.http(status: http.statusCode, body: "SSE stream open failed")
                    }
                    logInfo("sse", "stream open channel=\(channel)")

                    // SSE framing: each event is carried by one or more `data:`
                    // lines, terminated by a blank line. We only need to know an
                    // event arrived, so we signal per `data:` line and ignore
                    // comments (`:` heartbeats) and `event:`/`id:` fields.
                    for try await line in bytes.lines {
                        if Task.isCancelled { break }
                        if line.hasPrefix("data:") {
                            continuation.yield(())
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in producer.cancel() }
        }
    }

    // MARK: - Workspace metadata

    func getWorkspace() async throws -> Workspace {
        let request = try makeRequest(path: "/v1/workspaces/\(workspaceId)")
        return try await send(request, as: Workspace.self)
    }

    /// Email-based collaborators (humans) in this workspace. Backend
    /// auto-populates these on first human chat post via the workspace
    /// mod, so the mention picker can include real signed-in users
    /// alongside agents.
    struct Collaborator: Decodable, Sendable, Equatable {
        let email: String
        let displayName: String?
        let role: String?
    }

    private struct CollaboratorsResponse: Decodable, Sendable {
        let collaborators: [Collaborator]
    }

    func listCollaborators() async throws -> [Collaborator] {
        let request = try makeRequest(path: "/v1/workspaces/\(workspaceId)/collaborators")
        let response = try await send(request, as: CollaboratorsResponse.self)
        return response.collaborators
    }

    /// Self-register the signed-in user as a workspace collaborator so
    /// they show up in everyone's @-mention picker without having to
    /// post a message first. Fire-and-forget from `WorkspaceStore`.
    func recordPresence(senderEmail: String, senderDisplayName: String?) async throws {
        struct Body: Encodable {
            let senderEmail: String
            let senderDisplayName: String?
        }
        let bodyData = try JSONEncoder().encode(
            Body(senderEmail: senderEmail, senderDisplayName: senderDisplayName)
        )
        let request = try makeRequest(
            path: "/v1/workspaces/\(workspaceId)/presence",
            method: "POST",
            body: bodyData,
        )
        _ = try await send(request, as: Collaborator.self)
    }

    /// Flip the workspace-level Browser Fabric viewer toggle. The backend
    /// accepts a typed top-level `browser_enabled` on `PATCH /v1/workspaces/{id}`
    /// (added in this release) and merges it into the `settings` JSONB
    /// without trampling other keys.
    func updateWorkspaceBrowserEnabled(_ enabled: Bool) async throws -> Workspace {
        struct Body: Encodable { let browser_enabled: Bool }
        let bodyData = try JSONEncoder().encode(Body(browser_enabled: enabled))
        let request = try makeRequest(
            path: "/v1/workspaces/\(workspaceId)",
            method: "PATCH",
            body: bodyData,
        )
        return try await send(request, as: Workspace.self)
    }

    // MARK: - Browser Fabric tabs

    /// List the workspace's current browser tabs. The Browser panel renders
    /// all live sessions so users can scroll between agent-controlled tabs.
    func listBrowserTabs() async throws -> [BrowserTab] {
        struct Response: Decodable, Sendable { let tabs: [BrowserTab] }
        let request = try makeRequest(
            path: "/v1/browser/tabs",
            query: [("network", workspaceId)],
        )
        let resp = try await send(request, as: Response.self)
        return resp.tabs
    }

    /// Fetch a single tab. `validate=true` asks the backend to confirm the
    /// underlying Browser Fabric session is still alive and reconnect if not —
    /// matches the React app's behavior on page load.
    func getBrowserTab(tabId: String, validate: Bool = false) async throws -> BrowserTab {
        var query: [(String, String)] = []
        if validate { query.append(("validate", "true")) }
        let request = try makeRequest(
            path: "/v1/browser/tabs/\(tabId)",
            query: query,
        )
        return try await send(request, as: BrowserTab.self)
    }

    /// Restart a tab's Browser Fabric session. Used by the panel's reload
    /// button when the live view is stale or has failed.
    func reconnectBrowserTab(tabId: String) async throws -> BrowserTab {
        let request = try makeRequest(
            path: "/v1/browser/tabs/\(tabId)/reconnect",
            method: "POST",
        )
        return try await send(request, as: BrowserTab.self)
    }

    // MARK: - Discovery

    struct Discovery: Decodable, Sendable {
        let agents: [NetworkAgent]
        let channels: [NetworkChannel]
    }

    func discover() async throws -> Discovery {
        let request = try makeRequest(
            path: "/v1/discover",
            query: [("network", workspaceId)],
        )
        return try await send(request, as: Discovery.self)
    }

    // MARK: - Events / Messages

    func sendEvent(
        type: String,
        source: String,
        target: String,
        payload: [String: any Encodable & Sendable]? = nil,
        visibility: String? = nil,
    ) async throws -> ONMEvent {
        var body: [String: Any] = [
            "type": type,
            "source": source,
            "target": target,
            "network": workspaceId,
        ]
        if let payload { body["payload"] = payload.mapValues { try? JSONEncoder().encode($0) } }
        if let visibility { body["visibility"] = visibility }

        // Build JSON manually to avoid Any/Encodable headaches.
        let bodyData = try buildJSONBody(
            type: type,
            source: source,
            target: target,
            payload: payload,
            visibility: visibility,
        )

        let request = try makeRequest(
            path: "/v1/events",
            method: "POST",
            body: bodyData,
        )
        return try await send(request, as: ONMEvent.self)
    }

    private func buildJSONBody(
        type: String,
        source: String,
        target: String,
        payload: [String: any Encodable & Sendable]?,
        visibility: String?,
    ) throws -> Data {
        struct Body: Encodable {
            let type: String
            let source: String
            let target: String
            let network: String
            let payload: [String: JSONEncodableValue]?
            let visibility: String?
        }
        let payloadDict: [String: JSONEncodableValue]? = payload?.mapValues { JSONEncodableValue(wrapped: $0) }
        let body = Body(
            type: type,
            source: source,
            target: target,
            network: workspaceId,
            payload: payloadDict,
            visibility: visibility,
        )
        return try JSONEncoder().encode(body)
    }

    /// Post the result of a user interaction with an A2UI-rendered component
    /// back upstream. Emits a `workspace.tool_result` event addressed to the
    /// channel; the agent runtime is expected to interpret it as the response
    /// to the originating `render_ui` invocation.
    ///
    /// - Parameter channel: chat channel id (no `channel/` prefix; this method adds it).
    /// - Parameter toolCallId: the id from the originating render_ui invocation.
    ///   May be nil — the result still posts but cannot be correlated.
    /// - Parameter actionId: opaque id the agent attached to the action; round-tripped verbatim.
    /// - Parameter value: payload the agent receives alongside the interaction
    ///   (e.g. selected option, filled form values). Optional.
    func sendToolResult(
        channel: String,
        toolCallId: String?,
        actionId: String,
        value: JSONValue?,
    ) async throws -> ONMEvent {
        var payload: [String: any Encodable & Sendable] = ["action_id": actionId]
        if let toolCallId { payload["tool_call_id"] = toolCallId }
        if let value { payload["value"] = value }
        return try await sendEvent(
            type: "workspace.tool_result",
            source: "human:user",
            target: "channel/\(channel)",
            payload: payload,
            visibility: "direct",
        )
    }

    /// Send a control event to an agent (e.g. "stop"). Mirrors the React app's
    /// `sendAgentControl` — posts a `workspace.agent.control` event addressed to
    /// `openagents:<agentName>` with `action` (and optional extra params) in the payload.
    func sendAgentControl(
        agentName: String,
        action: String,
        params: [String: any Encodable & Sendable] = [:],
    ) async throws -> ONMEvent {
        var payload: [String: any Encodable & Sendable] = ["action": action]
        for (k, v) in params { payload[k] = v }
        return try await sendEvent(
            type: "workspace.agent.control",
            source: "human:user",
            target: "openagents:\(agentName)",
            payload: payload,
            visibility: "direct",
        )
    }

    /// Remove an agent from a channel by posting a `network.channel.leave`
    /// event. The backend deletes the matching `channel_members` row; the
    /// agent stops being polled for messages on that channel.
    func removeAgentFromChannel(channelName: String, agentName: String) async throws -> ONMEvent {
        return try await sendEvent(
            type: "network.channel.leave",
            source: "human:user",
            target: "channel/\(channelName)",
            payload: [
                "channel": channelName,
                "agent_name": agentName,
            ],
        )
    }

    /// Add an agent to a channel by posting a `network.channel.join` event.
    /// The backend inserts a `channel_members` row and (if the channel has
    /// no master yet) promotes the agent to master.
    func addAgentToChannel(channelName: String, agentName: String) async throws -> ONMEvent {
        return try await sendEvent(
            type: "network.channel.join",
            source: "human:user",
            target: "channel/\(channelName)",
            payload: [
                "channel": channelName,
                "agent_name": agentName,
            ],
        )
    }

    /// A page of messages returned in chronological order, with cursor info from the backend.
    struct MessageBatch: Sendable {
        let messages: [Message]   // chronological order (oldest first)
        let oldestId: String?
        let newestId: String?
        /// True when the backend says more events exist beyond this page.
        let hasMore: Bool
    }

    /// Fetch a page of message events for a channel.
    /// - Parameters:
    ///   - sort: `"desc"` returns newest first (used for initial load + load-older). `"asc"` returns
    ///     oldest first (used for forward polling with `after`).
    ///   - before: cursor — return messages older than this id.
    ///   - after: cursor — return messages newer than this id.
    func loadMessages(
        channel: String,
        before: String? = nil,
        after: String? = nil,
        sort: String = "asc",
        limit: Int = 50,
    ) async throws -> MessageBatch {
        var query: [(String, String)] = [
            ("network", workspaceId),
            ("channel", channel),
            ("type", "workspace.message"),
            ("sort", sort),
            ("limit", "\(limit)"),
        ]
        if let before { query.append(("before", before)) }
        if let after { query.append(("after", after)) }

        let request = try makeRequest(path: "/v1/events", query: query)
        let response = try await send(request, as: EventPollResponse.self)
        let raw = response.events.map { $0.toMessage() }
        // Backend returns newest-first when sort=desc; reverse to chronological order
        let chronological = sort == "desc" ? Array(raw.reversed()) : raw
        return MessageBatch(
            messages: chronological,
            oldestId: response.oldest_id ?? chronological.first?.messageId,
            newestId: response.newest_id ?? chronological.last?.messageId,
            hasMore: response.has_more,
        )
    }

    /// Update channel metadata (title, status, starred). Mirrors `PATCH /v1/workspaces/.../channels/...`.
    func updateChannel(
        channelName: String,
        title: String? = nil,
        status: String? = nil,
        starred: Bool? = nil,
    ) async throws {
        struct Body: Encodable {
            let title: String?
            let status: String?
            let starred: Bool?

            // Encode only the keys actually being patched
            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                if let title { try container.encode(title, forKey: .title) }
                if let status { try container.encode(status, forKey: .status) }
                if let starred { try container.encode(starred, forKey: .starred) }
            }

            enum CodingKeys: String, CodingKey { case title, status, starred }
        }
        let bodyData = try JSONEncoder().encode(Body(title: title, status: status, starred: starred))
        let request = try makeRequest(
            path: "/v1/workspaces/\(workspaceId)/channels/\(channelName)",
            method: "PATCH",
            body: bodyData,
        )
        // We don't care about the returned channel object — just verify success.
        struct Empty: Decodable, Sendable {}
        _ = try await send(request, as: Empty.self)
    }

    /// Bulk-fetch the latest message event per channel — used to show preview lines in the thread list.
    func latestPerChannel() async throws -> [String: ONMEvent] {
        struct Response: Decodable, Sendable {
            let channels: [String: ONMEvent]
        }
        let request = try makeRequest(
            path: "/v1/events/latest-per-channel",
            query: [("network", workspaceId)],
        )
        let response = try await send(request, as: Response.self)
        return response.channels
    }

    func sendMessage(
        channel: String,
        content: String,
        senderName: String = "user",
        senderEmail: String? = nil,
        senderDisplayName: String? = nil,
    ) async throws -> ONMEvent {
        // `sender_email` + `sender_display_name` are how the backend
        // auto-creates the WorkspaceCollaborator + ChannelHumanMember
        // rows on first post — they're optional for back-compat with
        // anonymous (token-only) clients but should be passed whenever
        // the user is signed in via Google.
        var payload: [String: any Encodable & Sendable] = [
            "content": content,
            "sender_type": "human",
        ]
        if let senderEmail, !senderEmail.isEmpty {
            payload["sender_email"] = senderEmail
        }
        if let senderDisplayName, !senderDisplayName.isEmpty {
            payload["sender_display_name"] = senderDisplayName
        }
        return try await sendEvent(
            type: "workspace.message.posted",
            source: "human:\(senderName)",
            target: "channel/\(channel)",
            payload: payload,
            visibility: "channel",
        )
    }

    // MARK: - File listing

    /// Fetch a page of workspace files for the content sidebar. Most recent
    /// first — matches the React `file-list.tsx` ordering. `channel` narrows
    /// to a single thread; pass nil to list all files in the workspace
    /// (the v1 sidebar shows the whole workspace).
    func listFiles(
        channel: String? = nil,
        status: String = "active",
        limit: Int = 100,
        offset: Int = 0,
    ) async throws -> WorkspaceFileListResponse {
        var query: [(String, String)] = [
            ("network", workspaceId),
            ("status", status),
            ("limit", "\(limit)"),
            ("offset", "\(offset)"),
        ]
        if let channel { query.append(("channel_name", channel)) }
        let request = try makeRequest(path: "/v1/files", query: query)
        return try await send(request, as: WorkspaceFileListResponse.self)
    }

    /// Pre-built `URLRequest` for downloading a file's bytes. Used by the
    /// authenticated image loader since `AsyncImage` can't carry headers.
    func authorizedDownloadRequest(fileId: String) -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent("/v1/files/\(fileId)"))
        request.cachePolicy = .returnCacheDataElseLoad
        if !token.isEmpty {
            request.setValue(token, forHTTPHeaderField: "X-Workspace-Token")
        }
        return request
    }

    /// Fetch metadata for a single file by id. Mirrors the React app's
    /// `GET /v1/files/<id>/info` call — used when we have only an id from a
    /// chat chip and need the filename / content-type before deciding how to
    /// render the detail view.
    func getFileInfo(fileId: String) async throws -> WorkspaceFile {
        let request = try makeRequest(path: "/v1/files/\(fileId)/info")
        return try await send(request, as: WorkspaceFile.self)
    }

    // MARK: - Push notifications

    /// Register this device's APNs token with the workspace backend so it
    /// can receive pushes for events posted on this workspace. Idempotent
    /// on (workspace, token).
    ///
    /// `userEmail` is optional but should be the signed-in Google email
    /// when available — the backend stores it on the device row and uses
    /// it to scope @-mention pushes to just this user's devices. Anonymous
    /// (token-only) registrations still work; they just won't receive
    /// mention-targeted notifications.
    func registerDeviceToken(
        fcmToken: String,
        deviceType: String = "ios",
        bundleId: String,
        userEmail: String? = nil,
    ) async throws {
        struct Body: Encodable {
            let network: String
            let device_type: String
            let fcm_token: String
            let bundle_id: String
            let user_email: String?
        }
        let body = try JSONEncoder().encode(Body(
            network: workspaceId,
            device_type: deviceType,
            fcm_token: fcmToken,
            bundle_id: bundleId,
            user_email: userEmail,
        ))
        let request = try makeRequest(
            path: "/v1/devices/register",
            method: "POST",
            body: body,
        )
        struct Empty: Decodable, Sendable {}
        _ = try await send(request, as: Empty.self)
    }

    // MARK: - File uploads

    /// Backend response for `POST /v1/files`.
    struct UploadedFile: Decodable, Sendable {
        let id: String
        let filename: String
        let content_type: String
        let size: Int
    }

    /// Public download URL for a file. Note: the backend serves these via
    /// `/v1/files/{file_id}` and validates the workspace token from the same
    /// header we use for everything else, so this URL is meant for in-app
    /// consumption (markdown links rendered in chat) — not anonymous sharing.
    func downloadURL(fileId: String) -> URL {
        baseURL.appendingPathComponent("/v1/files/\(fileId)")
    }

    /// Upload a file to shared storage. Mirrors the multipart form expected by
    /// `POST /v1/files`. Emits a `workspace.file.uploaded` event server-side;
    /// callers that want the file to appear in chat should follow up with a
    /// `sendMessage` containing a markdown link.
    func uploadFile(
        channel: String,
        filename: String,
        contentType: String,
        data: Data,
        senderName: String = "user",
    ) async throws -> UploadedFile {
        guard !workspaceId.isEmpty else { throw APIError.notConfigured }

        let boundary = "Boundary-\(UUID().uuidString)"
        let crlf = "\r\n"
        var body = Data()

        func appendField(name: String, value: String) {
            body.append("--\(boundary)\(crlf)".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(name)\"\(crlf)\(crlf)".data(using: .utf8)!)
            body.append("\(value)\(crlf)".data(using: .utf8)!)
        }

        appendField(name: "network", value: workspaceId)
        appendField(name: "channel_name", value: channel)
        appendField(name: "source", value: "human:\(senderName)")

        // Quote-escape the filename per RFC 7578 — backend uses Starlette which
        // tolerates plain quotes, but a stray `"` in the name would break the header.
        let safeName = filename.replacingOccurrences(of: "\"", with: "_")
        body.append("--\(boundary)\(crlf)".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\(crlf)".data(using: .utf8)!)
        body.append("Content-Type: \(contentType)\(crlf)\(crlf)".data(using: .utf8)!)
        body.append(data)
        body.append("\(crlf)--\(boundary)--\(crlf)".data(using: .utf8)!)

        var request = URLRequest(url: baseURL.appendingPathComponent("/v1/files"))
        request.httpMethod = "POST"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty { request.setValue(token, forHTTPHeaderField: "X-Workspace-Token") }
        request.httpBody = body

        return try await send(request, as: UploadedFile.self)
    }

    // MARK: - Channel CRUD (event-native)

    func createChannel(
        title: String? = nil,
        master: String? = nil,
        participants: [String] = [],
        humanParticipants: [String] = [],
    ) async throws -> Session {
        var payload: [String: any Encodable & Sendable] = [:]
        if let title { payload["title"] = title }
        if let master { payload["master"] = master }
        if !participants.isEmpty { payload["participants"] = participants }
        if !humanParticipants.isEmpty { payload["human_participants"] = humanParticipants }

        let event = try await sendEvent(
            type: "network.channel.create",
            source: "human:user",
            target: "core",
            payload: payload,
        )

        let channelName = event.metadata?["channel_name"]?.stringValue ?? ""
        return Session(
            sessionId: channelName,
            workspaceId: workspaceId,
            createdBy: "human:user",
            title: title ?? "New Chat",
            status: "active",
            starred: false,
            participants: participants,
            master: master,
            createdAt: Date(timeIntervalSince1970: TimeInterval(event.timestamp) / 1000.0).iso8601String,
            lastEventAt: nil,
        )
    }
}

/// Wraps an Encodable so heterogeneous payload dictionaries can be encoded together.
struct JSONEncodableValue: Encodable, @unchecked Sendable {
    let wrapped: any Encodable & Sendable

    func encode(to encoder: Encoder) throws {
        try wrapped.encode(to: encoder)
    }
}
