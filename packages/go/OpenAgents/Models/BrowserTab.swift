import Foundation

/// A browser tab opened by an agent via Browser Fabric. We mirror the
/// `_tab_to_dict` shape from `workspace/backend/app/routers/browser.py`:
///
/// ```
/// {
///   "id": "...",
///   "url": "https://...",
///   "title": "...",
///   "live_url": "https://...",   // populated while the session is live
///   "session_id": "...",         // Browser Fabric session id
///   "created_by": "...",         // who opened it
///   "created_at": "...",
///   "last_active_at": "..."
/// }
/// ```
///
/// The Go viewer needs `liveUrl` to render the embedded viewer; the rest is
/// for ordering when multiple sessions are visible.
struct BrowserTab: Identifiable, Decodable, Sendable, Equatable {
    let id: String
    let url: String?
    let title: String?
    let status: String?
    let liveUrl: String?
    let sessionId: String?
    let createdBy: String?
    let sharedWith: [String]
    let createdAt: String?
    let lastActiveAt: String?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case url
        case title
        case status
        case liveUrl = "live_url"
        case sessionId = "session_id"
        case createdBy = "created_by"
        case sharedWith = "shared_with"
        case createdAt = "created_at"
        case lastActiveAt = "last_active_at"
        case updatedAt = "updated_at"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        url = try container.decodeIfPresent(String.self, forKey: .url)
        title = try container.decodeIfPresent(String.self, forKey: .title)
        status = try container.decodeIfPresent(String.self, forKey: .status)
        liveUrl = try container.decodeIfPresent(String.self, forKey: .liveUrl)
        sessionId = try container.decodeIfPresent(String.self, forKey: .sessionId)
        createdBy = try container.decodeIfPresent(String.self, forKey: .createdBy)
        sharedWith = try container.decodeIfPresent([String].self, forKey: .sharedWith) ?? []
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
        lastActiveAt = try container.decodeIfPresent(String.self, forKey: .lastActiveAt)
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
    }

    /// True when the backend has handed us a live URL we can embed. Multiple
    /// historical tabs may exist; the panel renders every live tab.
    var isLive: Bool {
        guard let liveUrl, !liveUrl.isEmpty else { return false }
        return true
    }

    /// Best-effort timestamp for sorting "most recent" — falls back to
    /// `createdAt`. `Date.distantPast` for rows the backend left without
    /// either field so they sort to the bottom.
    var sortKey: Date {
        if let lastActiveAt, let d = Self.parseISO8601(lastActiveAt) { return d }
        if let updatedAt, let d = Self.parseISO8601(updatedAt) { return d }
        if let createdAt, let d = Self.parseISO8601(createdAt) { return d }
        return .distantPast
    }

    private static func parseISO8601(_ raw: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: raw) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: raw)
    }
}
