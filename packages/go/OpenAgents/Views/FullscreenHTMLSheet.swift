import SwiftUI

/// Modal viewer used by both `HTMLBlockView` (inline html in messages) and
/// `HTMLFileBody` (workspace .html files) when the user taps "expand". The
/// WKWebView fills the sheet and owns its own scrolling so long documents
/// reach their last byte — unlike the embedded variants which clamp their
/// height to the measured `body.scrollHeight`.
struct FullscreenHTMLSheet: View {
    let html: String
    let title: String
    var fileRequestProvider: WorkspaceFileSchemeHandler.RequestProvider? = nil

    @Binding var isPresented: Bool

    /// Required by `WebView` but ignored here — the sheet hands all of its
    /// area to the WKWebView, so the measured height never feeds back into
    /// SwiftUI layout. Kept as @State so the binding stays stable.
    @State private var measuredHeight: CGFloat = 0

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            WebView(
                html: html,
                measuredHeight: $measuredHeight,
                fileRequestProvider: fileRequestProvider,
                ownsScroll: true,
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        #if os(macOS)
        // Big window-sized sheet on macOS so wide HTML demos have real space.
        // Apple's default sheet sizing would constrain to ~600pt wide.
        .frame(minWidth: 720, idealWidth: 960, minHeight: 540, idealHeight: 720)
        #endif
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "globe")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(BrandColors.inkMuted)
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
            Button {
                isPresented = false
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(BrandColors.inkMuted)
                    .padding(6)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close fullscreen HTML viewer")
            #if os(macOS)
            .help("Close")
            #endif
            .keyboardShortcut(.cancelAction)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }
}
