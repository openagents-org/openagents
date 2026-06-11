import SwiftUI

/// Modal wrapper around `SettingsTabContent` for the entry points that
/// still present settings as a sheet:
///   - global `Cmd+,` keyboard shortcut from `OpenAgentsApp`
///   - settings button on `WorkspaceSelectorView` (no workspace picked
///     yet, so there's no Settings tab/destination to route to)
///
/// Once a workspace is picked, the icon-rail (Mac) and tab-bar (iPhone)
/// Settings destination is the primary entry point; this sheet remains
/// as a fallback for the pre-workspace state and the keyboard shortcut.
struct SettingsSheet: View {
    @Binding var isPresented: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Settings").font(.headline)
                Spacer()
                Button {
                    isPresented = false
                } label: {
                    Image(systemName: "xmark")
                        .foregroundStyle(BrandColors.inkMuted)
                        .padding(8)
                }
                .buttonStyle(.plain)
                .background(.regularMaterial, in: Circle())
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)

            Divider()

            SettingsTabContent()
        }
        #if os(macOS)
        .frame(minWidth: 480, idealWidth: 540, minHeight: 480, idealHeight: 600)
        #else
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        #endif
    }
}
