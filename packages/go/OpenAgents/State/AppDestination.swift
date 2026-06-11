import SwiftUI

/// Top-level destination inside a workspace — what the iPhone tab bar
/// and the Mac icon rail both bind to. Each destination is a peer
/// surface, not a sub-navigation: switching destinations does NOT push
/// or modal — it replaces the middle-column content (or the entire
/// screen on iPhone).
///
/// - `chats`: regular conversations (non-routine threads). The default
///   landing destination when entering a workspace.
/// - `inbox`: routine / notification channels (sessions whose id starts
///   with `routines:`). Was a segmented control inside ThreadListView
///   pre-v0.6.
/// - `settings`: account, workspace switcher, preferences. Was a sheet
///   pre-v0.6 (`SettingsSheet`); now a first-class destination so the
///   account row can leave the sidebar footer.
enum AppDestination: String, Hashable, CaseIterable, Identifiable {
    case chats
    case inbox
    case settings

    var id: String { rawValue }

    var label: String {
        switch self {
        case .chats: return "Chats"
        case .inbox: return "Inbox"
        case .settings: return "Settings"
        }
    }

    /// SF Symbol used on both the iPhone tab bar and the Mac icon rail.
    /// Filled variant is rendered when the destination is active.
    var icon: String {
        switch self {
        case .chats: return "bubble.left.and.bubble.right"
        case .inbox: return "tray"
        case .settings: return "gearshape"
        }
    }

    var iconFilled: String {
        switch self {
        case .chats: return "bubble.left.and.bubble.right.fill"
        case .inbox: return "tray.fill"
        case .settings: return "gearshape.fill"
        }
    }
}
