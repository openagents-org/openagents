#if os(iOS)
import Foundation
import Observation
import UIKit

/// Bridges the iOS `AppDelegate` (UIKit) and SwiftUI state graph. Owned by
/// `OpenAgentsApp` and held by `AppDelegate` via a weak reference so push
/// callbacks can drive token registration, foreground-suppression decisions,
/// and channel deep-linking without `AppDelegate` reaching into the store.
@MainActor
@Observable
final class PushSink {
    /// Single source of truth — matches `MacNotifier.shared` and
    /// `WorkspaceHistory.shared`. AuthStore reaches in via this to
    /// re-register the cached APNs token on sign-in/out without an
    /// injection plumbing dance.
    static let shared = PushSink()

    /// Set by the chat view as it appears so the sink can decide whether
    /// to suppress a banner that's redundant with what the user is already
    /// looking at.
    var currentVisibleChannel: String?

    /// Routed from `OpenAgentsApp` so push handlers can switch workspace/channel
    /// when the user taps a banner.
    weak var router: AppRouter?

    /// Last APNs device token (hex string) we successfully handed to a backend
    /// — persisted so we can re-register on workspace history changes without
    /// waiting for APNs to resurface the token (it normally only re-emits on
    /// restore-from-backup or reinstall).
    private let tokenKey = "pushSink.lastAPNsToken"

    var lastAPNsToken: String? {
        get { UserDefaults.standard.string(forKey: tokenKey) }
        set {
            if let newValue {
                UserDefaults.standard.set(newValue, forKey: tokenKey)
            } else {
                UserDefaults.standard.removeObject(forKey: tokenKey)
            }
        }
    }

    /// The signed-in Google email is cached in UserDefaults the same way
    /// the APNs token is. PushSink lives outside the auth flow, so both
    /// values come in via side channels (AppDelegate for the token,
    /// AuthStore for the email — see `pushSink.lastUserEmail = ...`
    /// after sign-in) and get replayed together on workspace registration.
    private let userEmailKey = "pushSink.lastUserEmail"

    var lastUserEmail: String? {
        get { UserDefaults.standard.string(forKey: userEmailKey) }
        set {
            if let newValue, !newValue.isEmpty {
                UserDefaults.standard.set(newValue, forKey: userEmailKey)
            } else {
                UserDefaults.standard.removeObject(forKey: userEmailKey)
            }
        }
    }

    /// `didRegisterForRemoteNotificationsWithDeviceToken` has handed us the
    /// raw APNs token bytes. Convert to APNs' hex wire format (lowercase, no
    /// separators) and fan out to every workspace this device has connected
    /// to so notifications from any of them reach us.
    func handleAPNsToken(_ deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        logInfo("push", "APNs token received (\(hex.prefix(12))…)")
        lastAPNsToken = hex
        registerCachedTokenWithAllWorkspaces(reason: "apns-token")
    }

    /// Called by `AuthStore` immediately after sign-in / sign-out so the
    /// backend's `device_tokens.user_email` row reflects the current user
    /// without waiting for the next APNs token redelivery (which can be
    /// hours away). Without this, a device that registered before sign-in
    /// has `user_email = NULL` and mention pushes never resolve to it.
    func reregisterAfterAuthChange() {
        guard lastAPNsToken != nil else {
            logInfo("push", "auth changed but no cached APNs token yet — will register when token arrives")
            return
        }
        registerCachedTokenWithAllWorkspaces(reason: "auth-change")
    }

    private func registerCachedTokenWithAllWorkspaces(reason: String) {
        guard let hex = lastAPNsToken else { return }
        let bundleId = Bundle.main.bundleIdentifier ?? "org.openagents.workspace"
        let userEmail = lastUserEmail
        let entries = WorkspaceHistory.shared.entries()
        guard !entries.isEmpty else {
            logInfo("push", "\(reason): no workspaces in history yet — will register on next connect")
            return
        }
        Task.detached {
            for entry in entries {
                let api = WorkspaceAPI(baseURL: entry.resolvedAPIURL)
                await api.configure(
                    workspaceId: entry.workspaceId,
                    token: entry.workspaceToken,
                    baseURL: entry.resolvedAPIURL,
                )
                do {
                    try await api.registerDeviceToken(
                        fcmToken: hex,
                        bundleId: bundleId,
                        userEmail: userEmail,
                    )
                    logInfo("push", "registered (\(reason)) workspace \(entry.workspaceId) email=\(userEmail ?? "<nil>")")
                } catch {
                    // Older backends won't have /v1/devices/register and will 404 —
                    // that's expected during rollout; log and move on.
                    logInfo("push", "device register (\(reason)) failed for \(entry.workspaceId): \(error.localizedDescription)")
                }
            }
        }
    }

    /// Background-delivered push — kick a refresh so the chat list updates
    /// when the user next opens the app, without waiting for the foreground
    /// poll to catch up.
    func handleRemotePush(channelHint: String?) {
        NotificationCenter.default.post(name: AppCommand.refresh.notification, object: nil)
    }

    /// Foreground decision: suppress the banner only when the push is for the
    /// channel the user is already watching in the active app.
    func shouldSuppressForeground(channel: String?) -> Bool {
        guard let channel else { return false }
        guard UIApplication.shared.applicationState == .active else { return false }
        return currentVisibleChannel == channel
    }

    /// User tapped a banner — best-effort hand off to the router so the chat
    /// view opens to that channel. If the workspace isn't the active one, the
    /// router's existing connect flow handles switching first.
    func deepLinkToChannel(_ channel: String, workspaceHint: String?) {
        guard let router else { return }
        if let workspaceHint,
           let entry = WorkspaceHistory.shared.entries().first(where: { $0.workspaceId == workspaceHint }),
           case .workspace(let active) = router.route,
           active.workspaceId != entry.workspaceId {
            router.connect(
                workspaceId: entry.workspaceId,
                token: entry.workspaceToken,
                name: entry.name,
                appURL: URL(string: entry.appURL ?? ""),
                apiURL: URL(string: entry.apiURL ?? ""),
            )
        }
        // The chat view observes `pendingDeepLinkChannel`; setting it here lets
        // the view jump to the right channel as soon as it's on screen.
        pendingDeepLinkChannel = channel
    }

    /// Channel name the next chat view should select on appear. Cleared by the
    /// view once consumed.
    var pendingDeepLinkChannel: String?
}
#endif
