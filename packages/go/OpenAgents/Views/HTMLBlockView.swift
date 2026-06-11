import SwiftUI

/// Renders a fenced \`\`\`html block as an inline interactive preview inside a
/// chat bubble. Mirrors the visual treatment of `CodeBlockView` (rounded
/// container, on-bubble background) but the body is a sandboxed WKWebView
/// instead of monospace source.
///
/// Web view sandbox stance lives in `WebView`.
struct HTMLBlockView: View {
    let html: String
    /// True when this block sits inside an agent (light gray) bubble; false on
    /// user (blue) bubbles. Used to pick a contrasting container background.
    var onLightBubble: Bool = true

    /// Cap on the rendered web view height. Long pages scroll inside the
    /// block rather than blowing out the chat. Empirically ~400pt fits a
    /// typical interactive demo without dominating the chat scroll.
    private static let maxRenderedHeight: CGFloat = 400

    /// Reported height of the rendered document. Starts small so the bubble
    /// doesn't reserve a giant slot during the first paint.
    @State private var measuredHeight: CGFloat = 80

    @State private var fullscreenOpen: Bool = false

    @Environment(WorkspaceStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                Image(systemName: "globe")
                    .font(.system(size: 9))
                Text("html")
                    .font(.caption2.monospaced())
                Spacer(minLength: 0)
                Button {
                    fullscreenOpen = true
                } label: {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.system(size: 10, weight: .semibold))
                        .padding(.horizontal, 4)
                        .padding(.vertical, 2)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open HTML in fullscreen")
                #if os(macOS)
                .help("Fullscreen")
                #endif
            }
            .foregroundStyle(BrandColors.inkMuted)
            .padding(.bottom, 4)

            WebView(
                html: html,
                measuredHeight: $measuredHeight,
                fileRequestProvider: store.fileRequestProvider,
            )
            .frame(height: min(measuredHeight, Self.maxRenderedHeight))
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .padding(8)
        .background(
            (onLightBubble ? Color.black.opacity(0.06) : Color.white.opacity(0.18)),
            in: RoundedRectangle(cornerRadius: 8, style: .continuous),
        )
        .sheet(isPresented: $fullscreenOpen) {
            FullscreenHTMLSheet(
                html: html,
                title: "Inline HTML",
                fileRequestProvider: store.fileRequestProvider,
                isPresented: $fullscreenOpen,
            )
        }
    }
}
