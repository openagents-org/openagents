import SwiftUI

/// Shown when no Firebase user is signed in. Mirrors the web LoginScreen:
/// centered card with the app icon, title, subtitle, and a single
/// "Sign in with Google" button.
struct LoginView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var signingIn = false
    @State private var appear = false

    var body: some View {
        VStack(spacing: 32) {
            VStack(spacing: 14) {
                appIcon
                Text("Sign in to OpenAgents")
                    .font(BrandFonts.displaySmall)
                    .foregroundStyle(BrandColors.inkStrong)
                Text("AGENT WORKSPACE")
                    .font(BrandFonts.sectionEyebrow)
                    .tracking(3.2)
                    .foregroundStyle(BrandColors.primary)
                    .padding(.top, 2)
                Text("Continue with your Google account to access your workspaces.")
                    .font(BrandFonts.callout)
                    .foregroundStyle(BrandColors.inkMuted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 320)
                    .padding(.top, 8)
            }

            Button {
                Task {
                    signingIn = true
                    await auth.signIn()
                    signingIn = false
                }
            } label: {
                HStack(spacing: 12) {
                    if signingIn {
                        ProgressView()
                            .controlSize(.small)
                            .tint(.white)
                    } else {
                        Image(systemName: "g.circle.fill")
                            .font(.system(size: 18))
                    }
                    Text(signingIn ? "Signing in…" : "Sign in with Google")
                        .font(BrandFonts.bodyMedium)
                }
                .frame(maxWidth: 280)
                .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandColors.primary)
            .controlSize(.large)
            .disabled(signingIn)

            if let error = auth.lastError {
                Text(error)
                    .font(BrandFonts.footnote)
                    .foregroundStyle(BrandColors.error)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 320)
            }
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BrandColors.bg)
        .opacity(appear ? 1 : 0)
        .scaleEffect(appear ? 1 : 0.96)
        .animation(.easeOut(duration: 0.45), value: appear)
        .onAppear { appear = true }
    }

    @ViewBuilder
    private var appIcon: some View {
        #if os(macOS)
        // macOS exposes the running app's icon at runtime — prefer it so the
        // user's custom-icon override (if any) carries through.
        if let nsImage = NSImage(named: "AppIcon") {
            Image(nsImage: nsImage)
                .resizable()
                .interpolation(.high)
                .frame(width: 88, height: 88)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        } else {
            AppIconBadge(size: 88)
        }
        #else
        // iOS has no equivalent runtime API — `UIImage(named: "AppIcon")`
        // returns nil because AppIcon assets aren't loadable as regular
        // images. Render the SwiftUI badge that mirrors the master PNG.
        AppIconBadge(size: 88)
        #endif
    }
}
