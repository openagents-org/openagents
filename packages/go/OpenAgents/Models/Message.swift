import Foundation

/// A chat message rendered in the conversation view.
struct Message: Identifiable, Sendable, Equatable {
    let messageId: String
    let sessionId: String
    /// "human" or "agent".
    let senderType: String
    let senderName: String
    let content: String
    let mentions: [String]
    /// "chat", "status", "thinking", etc.
    let messageType: String
    /// Unix milliseconds.
    let timestamp: Int64

    var id: String { messageId }
    var isFromUser: Bool { senderType == "human" }
    var isStatus: Bool { messageType == "status" || messageType == "thinking" }
    var date: Date { Date(timeIntervalSince1970: TimeInterval(timestamp) / 1000.0) }

    /// Synthesize a local status row used as an optimistic UI update when the
    /// user invokes a control action (Stop, /restart, etc.). The next real
    /// status from the backend overwrites it via the normal message-poll path.
    static func localStatus(channel: String, content: String, idPrefix: String = "local-status-") -> Message {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        return Message(
            messageId: "\(idPrefix)\(now)",
            sessionId: channel,
            senderType: "agent",
            senderName: "system",
            content: content,
            mentions: [],
            messageType: "status",
            timestamp: now,
        )
    }

    static func localStoppingStatus(channel: String) -> Message {
        localStatus(channel: channel, content: "Stopping...", idPrefix: "local-stopping-")
    }
}
