import SwiftUI
import WebKit

#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Right-side panel that embeds every live Browser Fabric session in a
/// scrollable stack. Each card is a WKWebView pointed at that tab's `liveUrl`;
/// validation auto-wakes a dead session backend-side without adding duplicate
/// browser chrome around the embedded session.
struct BrowserPanel: View {
    @Environment(WorkspaceStore.self) private var store

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(store.browserSessionTabs) { tab in
                        BrowserSessionCard(
                            tab: tab,
                            height: cardHeight(for: proxy.size)
                        )
                    }
                }
                .padding(10)
            }
            .background(Color.primary.opacity(0.025))
        }
    }

    private func cardHeight(for size: CGSize) -> CGFloat {
        min(max(300, size.height * 0.42), 420)
    }
}

private struct BrowserSessionCard: View {
    @Environment(WorkspaceStore.self) private var store

    let tab: BrowserTab
    let height: CGFloat

    @State private var loadedTabId: String?
    @State private var loadedLiveUrl: String?
    @State private var loadError: String?
    @State private var fullscreenOpen: Bool = false

    var body: some View {
        content
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color.secondary.opacity(0.16), lineWidth: 1)
            }
            .overlay(alignment: .topTrailing) {
                if loadedLiveUrl?.isEmpty == false {
                    Button {
                        fullscreenOpen = true
                    } label: {
                        Image(systemName: "arrow.up.left.and.arrow.down.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(BrandColors.inkMuted)
                            .frame(width: 28, height: 28)
                            .background(.regularMaterial, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .padding(8)
                    .accessibilityLabel("Open browser fullscreen")
                    #if os(macOS)
                    .help("Fullscreen")
                    #endif
                }
            }
        .task(id: tab.id) {
            await loadFreshIfNeeded()
        }
        .onChange(of: tab.liveUrl) { _, newURL in
            // If the backend rotated the liveUrl (e.g. session reconnected),
            // pick it up without a full card teardown.
            loadedLiveUrl = newURL
        }
        .sheet(isPresented: $fullscreenOpen) {
            if let liveUrl = loadedLiveUrl, let url = URL(string: liveUrl) {
                BrowserFullscreenSheet(
                    url: url,
                    title: tab.title ?? tab.url ?? "Browser",
                    isPresented: $fullscreenOpen
                )
            }
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if let liveUrl = loadedLiveUrl,
           let url = URL(string: liveUrl) {
            BrowserWebView(url: url)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let err = loadError {
            VStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle")
                    .foregroundStyle(.orange)
                Text(err)
                    .font(.caption)
                    .foregroundStyle(BrandColors.inkMuted)
                    .multilineTextAlignment(.center)
                Button("Retry") { Task { await reload(tabId: tab.id) } }
                    .buttonStyle(.bordered)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding()
        } else {
            VStack(spacing: 10) {
                ProgressView()
                Text("Connecting to browser session...")
                    .font(.caption)
                    .foregroundStyle(BrandColors.inkMuted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // MARK: - Loading

    private func loadFreshIfNeeded() async {
        if loadedTabId == tab.id, loadedLiveUrl == tab.liveUrl { return }
        await reload(tabId: tab.id)
    }

    private func reload(tabId: String) async {
        do {
            let validated = try await store.validateBrowserTab(tabId: tabId)
            loadedTabId = validated.id
            loadedLiveUrl = validated.liveUrl
            loadError = (validated.liveUrl?.isEmpty != false) ? "Session is not live yet. Try again in a moment." : nil
        } catch {
            loadError = error.localizedDescription
            logError("browser", "validate tab failed: \(error.localizedDescription)")
        }
    }
}

// MARK: - Web view bridge

private struct BrowserFullscreenSheet: View {
    let url: URL
    let title: String
    @Binding var isPresented: Bool

    var body: some View {
        VStack(spacing: 0) {
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
                .accessibilityLabel("Close fullscreen browser")
                #if os(macOS)
                .help("Close")
                #endif
                .keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            Divider()
            BrowserWebView(url: url)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        #if os(macOS)
        .frame(minWidth: 900, idealWidth: 1180, minHeight: 640, idealHeight: 820)
        #endif
    }
}

/// Minimal WKWebView wrapper that loads a remote URL and lets WKWebView own
/// scrolling. Distinct from `WebView` (which loads raw HTML strings); we
/// don't reuse that one because we want a remote URL load, no measured
/// height, no oafile scheme handler.
private struct BrowserWebView {
    let url: URL

    private static let hideBrowserFabricChromeScript = """
    (function () {
      function textOf(node) {
        return (node && node.textContent ? node.textContent : '').replace(/\\s+/g, ' ').trim();
      }

      function isSmallTopChrome(node) {
        if (!node || !node.getBoundingClientRect) return false;
        var rect = node.getBoundingClientRect();
        if (rect.width < 240) return false;
        if (rect.height < 24 || rect.height > 180) return false;
        if (rect.top < -1 || rect.top > 180) return false;
        return true;
      }

      function hideNode(node) {
        if (!node || node.__openAgentsChromeHidden || !isSmallTopChrome(node)) return false;
        node.__openAgentsChromeHidden = true;
        node.style.setProperty('display', 'none', 'important');
        node.style.setProperty('height', '0', 'important');
        node.style.setProperty('min-height', '0', 'important');
        node.style.setProperty('padding', '0', 'important');
        node.style.setProperty('margin', '0', 'important');
        node.style.setProperty('border', '0', 'important');
        return true;
      }

      function hideBrowserChrome() {
        var candidates = Array.from(document.querySelectorAll('body *'));
        for (var i = 0; i < candidates.length; i += 1) {
          var node = candidates[i];
          if (node.__openAgentsChromeHidden) continue;
          var text = textOf(node);
          if (!text || text.indexOf('BrowserFabric') === -1) continue;

          var chrome = node;
          for (var depth = 0; depth < 5 && chrome && chrome.parentElement; depth += 1) {
            var parentText = textOf(chrome.parentElement);
            if (!isSmallTopChrome(chrome.parentElement)) break;
            if (
              parentText.indexOf('BrowserFabric') !== -1 &&
              (parentText.indexOf('Live') !== -1 ||
                parentText.indexOf('https://') !== -1 ||
                parentText.indexOf('http://') !== -1)
            ) {
              chrome = chrome.parentElement;
            } else {
              break;
            }
          }

          hideNode(chrome);
        }
      }

      hideBrowserChrome();
      if (typeof MutationObserver !== 'undefined') {
        new MutationObserver(hideBrowserChrome).observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
      }
      window.addEventListener('load', hideBrowserChrome);
    })();
    """

    @MainActor
    private static func makeConfiguration() -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        let script = WKUserScript(
            source: hideBrowserFabricChromeScript,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        configuration.userContentController.addUserScript(script)
        return configuration
    }
}

#if os(macOS)
extension BrowserWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: Self.makeConfiguration())
        view.load(URLRequest(url: url))
        return view
    }
    func updateNSView(_ nsView: WKWebView, context: Context) {
        if nsView.url != url {
            nsView.load(URLRequest(url: url))
        }
    }
}
#else
extension BrowserWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: Self.makeConfiguration())
        view.load(URLRequest(url: url))
        return view
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {
        if uiView.url != url {
            uiView.load(URLRequest(url: url))
        }
    }
}
#endif
