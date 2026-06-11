import Foundation

/// Persistent record of recently-used workspaces — backed by UserDefaults.
///
/// The (appURL, apiURL) pair is stored together with each workspace so connecting
/// to a self-hosted backend doesn't require flipping a global setting first.
struct WorkspaceHistoryEntry: Codable, Identifiable, Sendable, Equatable {
    let workspaceId: String
    let workspaceToken: String
    var name: String
    var lastUsed: Date
    /// Frontend / share URL host (e.g. `https://workspace.openagents.org`). Optional for
    /// backward compatibility with entries persisted by earlier app versions.
    var appURL: String?
    /// Backend API URL (e.g. `https://workspace-endpoint.openagents.org`).
    var apiURL: String?

    var id: String { workspaceId }

    var displayName: String {
        if !name.isEmpty && name != workspaceId {
            return name
        }
        return String(workspaceId.prefix(8))
    }

    /// Resolve the app URL for this entry, falling back to the canonical default.
    var resolvedAppURL: URL {
        if let raw = appURL, let url = URL(string: raw) { return url }
        return WorkspaceURLs.defaultAppURL
    }

    /// Resolve the API URL for this entry, falling back to (1) derived from app URL,
    /// (2) the canonical default. Any caremojo.app app URL hard-overrides to the
    /// centralized agents-api.caremojo.app, even when a per-entry apiURL was set.
    var resolvedAPIURL: URL {
        let appURL = resolvedAppURL
        if WorkspaceURLs.isCaremojoHost(appURL.host) {
            return WorkspaceURLs.caremojoAPIURL
        }
        if let raw = apiURL, let url = URL(string: raw) { return url }
        return WorkspaceURLs.deriveAPIURL(fromApp: appURL)
    }
}

/// Canonical URL constants and derivation logic. Kept separate so views and the API client
/// share the same defaults without depending on UserDefaults.
enum WorkspaceURLs {
    static let defaultAppURL = URL(string: "https://workspace.openagents.org")!
    static let defaultAPIURL = URL(string: "https://workspace-endpoint.openagents.org")!
    /// Caremojo's deployment uses one centralized API host for every workspace
    /// subdomain — agents.caremojo.app, caremojo.app, etc. all route here.
    static let caremojoAPIURL = URL(string: "https://agents-api.caremojo.app")!

    static func isCaremojoHost(_ host: String?) -> Bool {
        guard let host else { return false }
        return host == "caremojo.app" || host.hasSuffix(".caremojo.app")
    }

    /// Map an app URL to its corresponding API URL when the host follows the canonical
    /// `workspace.<…>` → `workspace-endpoint.<…>` pattern. Otherwise assume the API
    /// shares the app's host (typical of self-hosted setups).
    static func deriveAPIURL(fromApp appURL: URL) -> URL {
        guard let host = appURL.host else { return defaultAPIURL }
        // Caremojo deployment is centralized regardless of subdomain.
        if isCaremojoHost(host) {
            return caremojoAPIURL
        }
        if host.hasPrefix("workspace.") {
            let rest = host.dropFirst("workspace.".count)
            var components = URLComponents()
            components.scheme = appURL.scheme ?? "https"
            components.host = "workspace-endpoint." + rest
            if let port = appURL.port { components.port = port }
            return components.url ?? defaultAPIURL
        }
        // Self-hosted assumption: same host as the app
        return appURL
    }
}

@MainActor
final class WorkspaceHistory {
    static let shared = WorkspaceHistory()

    private let defaultsKey = "workspaceHistory"
    private let currentKey = "currentWorkspace"
    private let baseURLKey = "apiBaseURL"
    private let maxEntries = 10

    private init() {}

    func entries() -> [WorkspaceHistoryEntry] {
        guard let data = UserDefaults.standard.data(forKey: defaultsKey),
              let decoded = try? JSONDecoder().decode([WorkspaceHistoryEntry].self, from: data) else {
            return []
        }
        return decoded.sorted { $0.lastUsed > $1.lastUsed }
    }

    /// Insert or update a history entry, preserving non-overwritten fields when they
    /// were already on disk.
    func touch(
        workspaceId: String,
        token: String,
        name: String,
        appURL: String? = nil,
        apiURL: String? = nil,
    ) {
        let existing = entries().first { $0.workspaceId == workspaceId }
        var all = entries().filter { $0.workspaceId != workspaceId }
        all.insert(
            WorkspaceHistoryEntry(
                workspaceId: workspaceId,
                workspaceToken: token,
                name: name,
                lastUsed: Date(),
                appURL: appURL ?? existing?.appURL,
                apiURL: apiURL ?? existing?.apiURL,
            ),
            at: 0,
        )
        let trimmed = Array(all.prefix(maxEntries))
        if let data = try? JSONEncoder().encode(trimmed) {
            UserDefaults.standard.set(data, forKey: defaultsKey)
        }
    }

    func current() -> WorkspaceHistoryEntry? {
        guard let data = UserDefaults.standard.data(forKey: currentKey),
              let decoded = try? JSONDecoder().decode(WorkspaceHistoryEntry.self, from: data) else {
            return nil
        }
        return decoded
    }

    func setCurrent(_ entry: WorkspaceHistoryEntry?) {
        if let entry, let data = try? JSONEncoder().encode(entry) {
            UserDefaults.standard.set(data, forKey: currentKey)
        } else {
            UserDefaults.standard.removeObject(forKey: currentKey)
        }
    }

    /// Global default API base URL — only used as a fallback when an entry has no
    /// per-workspace apiURL. Most users won't need to set this.
    var apiBaseURL: URL {
        get {
            if let raw = UserDefaults.standard.string(forKey: baseURLKey),
               let url = URL(string: raw) {
                return url
            }
            return WorkspaceURLs.defaultAPIURL
        }
        set {
            UserDefaults.standard.set(newValue.absoluteString, forKey: baseURLKey)
        }
    }

    // MARK: - URL parsing

    struct ParsedWorkspaceURL {
        let workspaceId: String
        let token: String
        /// The frontend/app URL host (e.g. `https://workspace.openagents.org`), or nil
        /// when the input was a bare ID with no host.
        let appURL: URL?
    }

    /// Parse a workspace URL. Accepts:
    ///   - `https://workspace.openagents.org/abc123?token=xyz` (full URL with host)
    ///   - `/abc123?token=xyz` (relative — uses default app URL)
    ///   - `abc123` (bare ID, no token, no host)
    static func parseWorkspaceURL(_ input: String) -> ParsedWorkspaceURL? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        // Try as a fully-formed URL with host first
        if let components = URLComponents(string: trimmed),
           let host = components.host, !host.isEmpty {
            return parsedFromComponents(components, includeHost: true)
        }

        // Try as relative URL with leading slash + query
        if trimmed.hasPrefix("/"),
           let components = URLComponents(string: WorkspaceURLs.defaultAppURL.absoluteString + trimmed) {
            return parsedFromComponents(components, includeHost: false)
        }

        // Try as path with query but no leading slash (e.g. "abc123?token=xyz")
        if trimmed.contains("?") || trimmed.contains("/"),
           let components = URLComponents(string: WorkspaceURLs.defaultAppURL.absoluteString + "/" + trimmed) {
            return parsedFromComponents(components, includeHost: false)
        }

        // Bare ID — no token, no host
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        if trimmed.unicodeScalars.allSatisfy({ allowed.contains($0) }) {
            return ParsedWorkspaceURL(workspaceId: trimmed, token: "", appURL: nil)
        }
        return nil
    }

    private static func parsedFromComponents(_ components: URLComponents, includeHost: Bool) -> ParsedWorkspaceURL? {
        let segments = components.path.split(separator: "/").map(String.init)
        guard let workspaceId = segments.last, !workspaceId.isEmpty else { return nil }
        let token = components.queryItems?.first(where: { $0.name == "token" })?.value ?? ""
        var appURL: URL?
        if includeHost {
            var hostOnly = URLComponents()
            hostOnly.scheme = components.scheme ?? "https"
            hostOnly.host = components.host
            if let port = components.port { hostOnly.port = port }
            appURL = hostOnly.url
        }
        return ParsedWorkspaceURL(workspaceId: workspaceId, token: token, appURL: appURL)
    }
}
