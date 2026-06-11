import SwiftUI
import SwiftUIJSONRender
import FirebaseCore
import GoogleSignIn

@main
struct OpenAgentsApp: App {
    init() {
        // SwiftUIJSONRender's built-in component catalog is registered lazily
        // via a private static let — nothing accesses it on its own, so the
        // registry stays empty and JSONView falls back to "Unsupported"
        // placeholders for everything. Force the init here so Stack / Button
        // / Heading / etc. resolve.
        SwiftUIJSONRender.initializeJSONRender()

        // iOS already calls FirebaseApp.configure() from AppDelegate (for
        // push notifications). macOS has no AppDelegate, so configure here.
        #if os(macOS)
        if FirebaseApp.app() == nil {
            FirebaseApp.configure()
        }
        #endif
    }

    #if os(iOS)
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    private let pushSink = PushSink.shared
    #endif
    @StateObject private var authStore = AuthStore()
    @State private var router = AppRouter()
    @State private var debugLogOpen: Bool = false
    @State private var settingsOpen: Bool = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(router)
                .environmentObject(authStore)
                #if os(iOS)
                .environment(pushSink)
                .task {
                    appDelegate.pushSink = pushSink
                    pushSink.router = router
                }
                #endif
                #if os(macOS)
                .task {
                    // Lazy first-time UNUserNotificationCenter prompt — only
                    // surfaces once the SwiftUI graph is on screen so the
                    // dialog isn't a launch-time surprise.
                    MacNotifier.shared.requestPermission()
                }
                #endif
                .onOpenURL { url in
                    // Google Sign-In callbacks come back here when the user
                    // completes (or cancels) the OAuth flow in the system
                    // browser. GIDSignIn.handle returns true when it owns
                    // the URL; only forward to the file ingester otherwise.
                    if GIDSignIn.sharedInstance.handle(url) { return }

                    // Triggered when another app hands us a file via iOS
                    // "Open in…" / Share Sheet, macOS "Open With", or
                    // drag-onto-dock-icon. The router buffers it until the
                    // chat view drains it into the composer.
                    router.ingestExternalURL(url)
                }
                .sheet(isPresented: $debugLogOpen) {
                    DebugLogSheet(isPresented: $debugLogOpen)
                }
                .sheet(isPresented: $settingsOpen) {
                    SettingsSheet(isPresented: $settingsOpen)
                        .environment(router)
                        .environmentObject(authStore)
                }
                .onAppCommand(.openDebugLog) {
                    debugLogOpen = true
                }
                .onAppCommand(.openSettings) {
                    settingsOpen = true
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active {
                        // Trigger a fresh load when the app becomes active so users
                        // returning to the app don't see stale data.
                        NotificationCenter.default.post(name: AppCommand.refresh.notification, object: nil)
                    }
                }
        }
        #if os(macOS)
        .defaultSize(width: 1100, height: 760)
        .windowResizability(.contentSize)
        .commands {
            OpenAgentsCommands()
        }
        #endif
    }
}
