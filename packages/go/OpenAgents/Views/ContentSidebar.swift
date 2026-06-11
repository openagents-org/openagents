import SwiftUI

/// Right-side panel that holds either a workspace-file list or a single-file
/// detail view, swapping based on `ContentSidebarController.selectedFileId`.
/// Mirrors the "Content" sidebar in the React workspace UI.
struct ContentSidebar: View {
    /// Default / minimum width — fits a single column of file cards. The
    /// resize handle in ChatView lets the user grow this up to
    /// `twoColumnWidth` where the list switches to a 2-column grid.
    static let singleColumnWidth: CGFloat = 280
    static let twoColumnWidth: CGFloat = 560

    @Environment(WorkspaceStore.self) private var store
    @Environment(ContentSidebarController.self) private var controller

    @State private var files: [WorkspaceFile] = []
    @State private var loading: Bool = false
    @State private var loadError: String?

    @State private var pendingDownload: DataDocument?
    @State private var pendingDownloadName: String = "file"
    @State private var isDownloading: Bool = false
    @State private var showExporter: Bool = false

    var body: some View {
        VStack(spacing: 0) {
            // Tab bar only renders when the Browser tab is available; when
            // it's just Content there's nothing to switch between and the
            // original header is enough. Keeps the v0.2 visual when nothing
            // is live and there's no toggle on.
            if store.browserPanelAvailable {
                tabBar
                Divider()
            }
            switch effectiveTab {
            case .browser:
                BrowserPanel()
            case .content:
                contentBody
            }
        }
        .background(sidebarBackground)
        .task(id: store.workspaceId) {
            await refresh()
        }
        .onChange(of: store.browserPanelAvailable) { _, available in
            // If the Browser tab vanishes (toggle off, session ended), drop
            // back to Content so the panel doesn't get stuck on a tab that
            // is no longer in the header.
            if !available, controller.selectedTab == .browser {
                controller.selectedTab = .content
            }
        }
        .fileExporter(
            isPresented: $showExporter,
            document: pendingDownload ?? DataDocument(data: Data()),
            contentType: .data,
            defaultFilename: pendingDownloadName,
        ) { result in
            if case .failure(let err) = result {
                logError("ui", "fileExporter failed: \(err.localizedDescription)")
            }
            pendingDownload = nil
        }
    }

    /// Falls back to .content if the controller wants .browser but the
    /// browser panel isn't currently available (toggle off / no live tabs).
    private var effectiveTab: ContentSidebarTab {
        if controller.selectedTab == .browser, !store.browserPanelAvailable {
            return .content
        }
        return controller.selectedTab
    }

    /// Two-tab header at the top of the panel, shown only when the Browser
    /// tab is available. Tapping a tab flips `controller.selectedTab`.
    private var tabBar: some View {
        HStack(spacing: 0) {
            tabButton(.content, label: "Content", icon: "doc.text")
            tabButton(.browser, label: "Browser", icon: "globe")
            Spacer(minLength: 0)
            Button {
                controller.close()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(BrandColors.inkMuted)
                    .frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close panel")
            #if os(macOS)
            .help("Close")
            #endif
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
    }

    private func tabButton(_ tab: ContentSidebarTab, label: String, icon: String) -> some View {
        let selected = effectiveTab == tab
        return Button {
            controller.selectedTab = tab
        } label: {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .medium))
                Text(label)
                    .font(.system(size: 12, weight: .medium))
            }
            .foregroundStyle(selected ? BrandColors.primary : Color.secondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(selected ? BrandColors.primary.opacity(0.12) : .clear),
            )
            .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    /// Original Content sidebar behavior — file list or detail with their
    /// own headers. Now wrapped so it's swappable with the Browser tab.
    @ViewBuilder
    private var contentBody: some View {
        if let fileId = controller.selectedFileId {
            detailHeader
            Divider()
            FileDetailView(
                fileId: fileId,
                labelHint: controller.selectedFileLabelHint,
            )
        } else {
            listHeader
            Divider()
            listBody
        }
    }

    // MARK: - List header (with refresh + close)

    private var listHeader: some View {
        HStack(spacing: 8) {
            Text("Content")
                .font(.headline)
            Spacer()
            Button {
                Task { await refresh() }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(BrandColors.inkMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Refresh files")
            #if os(macOS)
            .help("Refresh")
            #endif

            Button {
                controller.close()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(BrandColors.inkMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close content sidebar")
            #if os(macOS)
            .help("Close")
            #endif
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    // MARK: - Detail header (back + close)

    private var detailHeader: some View {
        HStack(spacing: 8) {
            Button {
                controller.backToList()
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 12, weight: .semibold))
                    Text("Files")
                        .font(.system(size: 13))
                }
                .foregroundStyle(BrandColors.inkMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Back to file list")

            Spacer()

            Button {
                Task { await downloadCurrentFile() }
            } label: {
                ZStack {
                    Image(systemName: "arrow.down.circle")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(BrandColors.inkMuted)
                        .opacity(isDownloading ? 0 : 1)
                    if isDownloading {
                        ProgressView()
                            .controlSize(.small)
                    }
                }
            }
            .buttonStyle(.plain)
            .disabled(isDownloading || controller.selectedFileId == nil)
            .accessibilityLabel("Download file")
            #if os(macOS)
            .help("Download")
            #endif

            Button {
                controller.close()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(BrandColors.inkMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close content sidebar")
            #if os(macOS)
            .help("Close")
            #endif
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private func downloadCurrentFile() async {
        guard let fileId = controller.selectedFileId else { return }
        isDownloading = true
        defer { isDownloading = false }
        do {
            let request = await store.authorizedFileDownloadRequest(fileId: fileId)
            let (data, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                logError("ui", "download failed: HTTP \(http.statusCode)")
                return
            }
            let suggested = suggestedFilename(from: response) ?? controller.selectedFileLabelHint ?? "file"
            pendingDownload = DataDocument(data: data)
            pendingDownloadName = suggested
            showExporter = true
        } catch {
            logError("ui", "download failed: \(error.localizedDescription)")
        }
    }

    /// Pulls `filename=...` out of a `Content-Disposition` header when the
    /// server provides one. Falls back to nil so the caller can use its own
    /// hint. Handles plain (`filename="foo.pdf"`) and RFC 5987 (`filename*=UTF-8''foo.pdf`)
    /// forms; doesn't bother with full quote-escape handling because the
    /// backend only emits ASCII-safe names today.
    private func suggestedFilename(from response: URLResponse) -> String? {
        guard let http = response as? HTTPURLResponse,
              let disp = http.value(forHTTPHeaderField: "Content-Disposition") else { return nil }
        if let range = disp.range(of: #"filename\*=UTF-8''([^;]+)"#, options: .regularExpression) {
            let raw = String(disp[range]).replacingOccurrences(of: "filename*=UTF-8''", with: "")
            return raw.removingPercentEncoding ?? raw
        }
        if let range = disp.range(of: #"filename=\"?([^\";]+)\"?"#, options: .regularExpression) {
            return String(disp[range])
                .replacingOccurrences(of: "filename=", with: "")
                .trimmingCharacters(in: CharacterSet(charactersIn: "\""))
        }
        return nil
    }

    @ViewBuilder
    private var listBody: some View {
        if loading && files.isEmpty {
            loadingState
        } else if let loadError, files.isEmpty {
            errorState(message: loadError)
        } else if files.isEmpty {
            emptyState
        } else {
            fileList
        }
    }

    private var loadingState: some View {
        VStack(spacing: 10) {
            ProgressView()
            Text("Loading files…")
                .font(.caption)
                .foregroundStyle(BrandColors.inkMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(message: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
                .foregroundStyle(.orange)
            Text(message)
                .font(.caption)
                .foregroundStyle(BrandColors.inkMuted)
                .multilineTextAlignment(.center)
            Button("Retry") {
                Task { await refresh() }
            }
            .buttonStyle(.bordered)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "folder")
                .font(.system(size: 28))
                .foregroundStyle(BrandColors.inkFaint)
            Text("No files yet")
                .font(.caption)
                .foregroundStyle(BrandColors.inkMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var fileList: some View {
        ScrollView {
            // Adaptive grid: 1 column at minimum sidebar width, 2 columns when
            // the user drags the sidebar wider. SwiftUI computes the column
            // count from `minimum:` and the available width.
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 240), spacing: 8)],
                spacing: 8,
            ) {
                ForEach(sortedFiles) { file in
                    Button {
                        controller.openFile(id: file.id, label: file.basename)
                    } label: {
                        FileCard(file: file)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
        }
    }

    /// Newest first. Files with no createdAt sink to the bottom so the
    /// recent-activity affordance stays correct on the (rare) legacy rows.
    private var sortedFiles: [WorkspaceFile] {
        files.sorted { lhs, rhs in
            switch (lhs.createdAtDate, rhs.createdAtDate) {
            case (let l?, let r?): return l > r
            case (_?, nil):        return true
            case (nil, _?):        return false
            case (nil, nil):       return lhs.filename < rhs.filename
            }
        }
    }

    private var sidebarBackground: Color {
        // BrandColors.bg gives the warm graphite surface in dark mode and the
        // off-white cream in light mode, instead of the cooler system grey.
        // On macOS 26 / iOS 26, system controls inside the sidebar still
        // pick up Liquid Glass automatically — this just sets the canvas.
        BrandColors.bg
    }

    // MARK: - Loading

    private func refresh() async {
        loading = true
        defer { loading = false }
        do {
            files = try await store.listFiles(channel: nil, limit: 100)
            loadError = nil
        } catch {
            loadError = error.localizedDescription
            logError("ui", "ContentSidebar listFiles failed: \(error.localizedDescription)")
        }
    }
}

// MARK: - File card

private struct FileCard: View {
    let file: WorkspaceFile

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            thumbnail
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                Text(file.basename)
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                HStack(spacing: 6) {
                    Text(file.kind.label)
                        .font(.system(size: 9, weight: .semibold))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(file.kind.tint.opacity(0.18), in: Capsule())
                        .foregroundStyle(file.kind.tint)
                    if file.size > 0 {
                        Text(byteString(file.size))
                            .font(.caption2)
                            .foregroundStyle(BrandColors.inkMuted)
                    }
                }
                if let date = file.createdAtDate {
                    Text(relativeTime(from: date))
                        .font(.caption2)
                        .foregroundStyle(BrandColors.inkFaint)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(.gray.opacity(0.08)),
        )
    }

    @ViewBuilder
    private var thumbnail: some View {
        switch file.kind {
        case .image:
            AuthorizedAsyncImage(fileId: file.id)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        default:
            ZStack {
                Rectangle()
                    .fill(.gray.opacity(0.18))
                Image(systemName: file.kind.systemImage)
                    .font(.system(size: 18))
                    .foregroundStyle(file.kind.tint)
            }
        }
    }

    private func byteString(_ size: Int) -> String {
        let f = ByteCountFormatter()
        f.allowedUnits = [.useKB, .useMB, .useGB]
        f.countStyle = .file
        return f.string(fromByteCount: Int64(size))
    }

    /// "3d ago", "12m ago" — same shape the React sidebar uses.
    private func relativeTime(from date: Date) -> String {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f.localizedString(for: date, relativeTo: Date())
    }
}
