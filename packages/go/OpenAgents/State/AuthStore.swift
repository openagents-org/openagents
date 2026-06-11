import Foundation
import FirebaseCore
import GoogleSignIn

#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

/// Identity exposed to the rest of the app.
struct AuthUser: Equatable {
    let email: String
    let displayName: String
    let photoURL: URL?
}

/// Google Sign-In wrapper, deliberately *without* FirebaseAuth.
///
/// FirebaseAuth's keychain persistence on macOS sets `kSecAttrAccessGroup`,
/// which makes the Sec API reject every operation unless the app is signed
/// with a `keychain-access-groups` entitlement — and that entitlement is
/// "restricted" so it requires an embedded provisioning profile at runtime
/// (amfid rejects with `-413 No matching profile found` otherwise). We
/// ship Developer ID outside the App Store and don't have a profile, so
/// FirebaseAuth simply can't run here.
///
/// GoogleSignIn alone is enough for what the app needs: a verified email +
/// display name + photoURL + an OIDC ID token. The token is a standard
/// Google JWT that the workspace backend can validate the same way it
/// validates Firebase-issued ones. FirebaseCore is still linked because
/// `FirebaseApp.app()?.options.clientID` is the cleanest place to read the
/// Google OAuth client ID for GIDSignIn configuration.
@MainActor
final class AuthStore: ObservableObject {
    @Published private(set) var user: AuthUser?
    @Published private(set) var idToken: String?
    @Published private(set) var loading: Bool = true
    @Published private(set) var lastError: String?

    init() {
        // Try to silently restore a previously signed-in user. GoogleSignIn
        // caches tokens in the app's standard keychain (no access-group);
        // the restore is best-effort and never throws to the UI.
        Task { @MainActor in
            await restorePreviousSignIn()
            self.loading = false
        }
    }

    private func restorePreviousSignIn() async {
        guard GIDSignIn.sharedInstance.hasPreviousSignIn() else { return }
        do {
            let restored = try await GIDSignIn.sharedInstance.restorePreviousSignIn()
            apply(googleUser: restored)
        } catch {
            // Restoration failed — user will need to sign in interactively.
            // Don't surface this as an error banner; it's a normal cold start.
            print("[AuthStore] restorePreviousSignIn: \(error)")
        }
    }

    private func apply(googleUser: GIDGoogleUser) {
        let profile = googleUser.profile
        let email = profile?.email ?? ""
        let displayName = profile?.name ?? email
        let photoURL: URL? = profile?.hasImage == true
            ? profile?.imageURL(withDimension: 96)
            : nil
        user = AuthUser(email: email, displayName: displayName, photoURL: photoURL)
        idToken = googleUser.idToken?.tokenString
        // PushSink (iOS) and WorkspaceStore.bootstrap (both platforms)
        // read this UserDefaults key when registering device tokens, so
        // mention pushes can be scoped to "@me". Empty email clears it
        // — happens on sign-out via the no-user branch in apply(user:).
        let trimmed = email.trimmingCharacters(in: .whitespaces).lowercased()
        if trimmed.isEmpty {
            UserDefaults.standard.removeObject(forKey: "pushSink.lastUserEmail")
            UserDefaults.standard.removeObject(forKey: "pushSink.lastUserDisplayName")
        } else {
            UserDefaults.standard.set(trimmed, forKey: "pushSink.lastUserEmail")
            let trimmedDisplay = displayName.trimmingCharacters(in: .whitespaces)
            if trimmedDisplay.isEmpty {
                UserDefaults.standard.removeObject(forKey: "pushSink.lastUserDisplayName")
            } else {
                UserDefaults.standard.set(trimmedDisplay, forKey: "pushSink.lastUserDisplayName")
            }
        }
        // Re-register the cached APNs token with the new email so mention
        // pushes can scope to this user without waiting for the next workspace
        // bootstrap (which may not happen if the app stays foregrounded).
        // No-op on macOS where PushSink doesn't deal in APNs tokens.
        #if os(iOS)
        PushSink.shared.reregisterAfterAuthChange()
        #endif
    }

    // MARK: — Sign in

    /// Launches the Google Sign-In flow and publishes the resulting user.
    func signIn() async {
        lastError = nil
        do {
            guard let clientID = FirebaseApp.app()?.options.clientID else {
                throw NSError(domain: "AuthStore", code: -1, userInfo: [
                    NSLocalizedDescriptionKey: "Missing Firebase client ID — check GoogleService-Info.plist",
                ])
            }
            GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)

            let result = try await presentGoogleSignIn()
            apply(googleUser: result.user)
        } catch {
            // User-cancelled is normal and shouldn't appear as a banner.
            let nsError = error as NSError
            let cancelled =
                nsError.domain == "com.google.GIDSignIn"
                && nsError.code == GIDSignInError.canceled.rawValue
            if !cancelled {
                var parts: [String] = ["[\(nsError.domain) #\(nsError.code)] \(nsError.localizedDescription)"]
                if let reason = nsError.localizedFailureReason {
                    parts.append("Reason: \(reason)")
                }
                if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? NSError {
                    parts.append("Underlying: [\(underlying.domain) #\(underlying.code)] \(underlying.localizedDescription)")
                }
                let extraKeys = nsError.userInfo.keys.filter {
                    $0 != NSLocalizedDescriptionKey
                    && $0 != NSLocalizedFailureReasonErrorKey
                    && $0 != NSUnderlyingErrorKey
                }
                for key in extraKeys.sorted() {
                    parts.append("\(key): \(nsError.userInfo[key] ?? "nil")")
                }
                lastError = parts.joined(separator: "\n")
                print("[AuthStore] signIn failed: \(nsError) userInfo=\(nsError.userInfo)")
            }
        }
    }

    /// Platform-specific bridge into the Google Sign-In SDK. On iOS we hand
    /// it the topmost view controller; on macOS we hand it the key window.
    private func presentGoogleSignIn() async throws -> GIDSignInResult {
        #if os(iOS)
        guard let presenter = await topMostViewController() else {
            throw NSError(domain: "AuthStore", code: -3, userInfo: [
                NSLocalizedDescriptionKey: "No presenting view controller available",
            ])
        }
        return try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)
        #elseif os(macOS)
        guard let window = NSApp.keyWindow ?? NSApp.windows.first else {
            throw NSError(domain: "AuthStore", code: -3, userInfo: [
                NSLocalizedDescriptionKey: "No presenting window available",
            ])
        }
        return try await GIDSignIn.sharedInstance.signIn(withPresenting: window)
        #endif
    }

    #if os(iOS)
    private func topMostViewController() async -> UIViewController? {
        let root = await MainActor.run { () -> UIViewController? in
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }
                .first(where: { $0.isKeyWindow })?
                .rootViewController
        }
        var top = root
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
    #endif

    // MARK: — Sign out

    func signOut() {
        GIDSignIn.sharedInstance.signOut()
        user = nil
        idToken = nil
        UserDefaults.standard.removeObject(forKey: "pushSink.lastUserEmail")
        UserDefaults.standard.removeObject(forKey: "pushSink.lastUserDisplayName")
        // Re-register so the device_tokens row clears its user_email and
        // we stop receiving mention pushes addressed to the signed-out user.
        #if os(iOS)
        PushSink.shared.reregisterAfterAuthChange()
        #endif
    }

    // MARK: — Helpers

    /// The display name used to tag outgoing chat messages — mirrors the web's
    /// `senderName = user.displayName ?? user.email ?? 'user'` fallback chain.
    var senderName: String {
        let candidate = user?.displayName.trimmingCharacters(in: .whitespaces) ?? ""
        if !candidate.isEmpty { return candidate }
        let email = user?.email.trimmingCharacters(in: .whitespaces) ?? ""
        if !email.isEmpty { return email }
        return "user"
    }
}
