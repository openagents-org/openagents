import SwiftUI

struct DebugLogSheet: View {
    @Binding var isPresented: Bool
    @State private var log = DebugLog.shared
    @State private var filter: String = ""
    @State private var levelFilter: DebugLog.Level? = nil

    private var filteredEntries: [DebugLog.Entry] {
        var items = log.entries
        if let levelFilter {
            items = items.filter { $0.level == levelFilter }
        }
        if !filter.isEmpty {
            let q = filter.lowercased()
            items = items.filter {
                $0.message.lowercased().contains(q)
                    || $0.category.lowercased().contains(q)
            }
        }
        return items.reversed() // newest first
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Debug Log").font(.headline)
                Spacer()
                Button("Copy") { copyAll() }
                    .buttonStyle(.bordered)
                Button("Clear") { log.clear() }
                    .buttonStyle(.bordered)
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
            .padding(.vertical, 14)

            HStack(spacing: 8) {
                TextField("Filter", text: $filter)
                    .textFieldStyle(.roundedBorder)
                Picker("Level", selection: $levelFilter) {
                    Text("All").tag(DebugLog.Level?.none)
                    Text("Info").tag(DebugLog.Level?.some(.info))
                    Text("Warn").tag(DebugLog.Level?.some(.warn))
                    Text("Error").tag(DebugLog.Level?.some(.error))
                }
                .pickerStyle(.segmented)
                .frame(width: 240)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 8)

            Divider()

            if filteredEntries.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "doc.text.magnifyingglass")
                        .font(.system(size: 32))
                        .foregroundStyle(BrandColors.inkFaint)
                    Text(log.entries.isEmpty ? "No log entries yet" : "No entries match the filter")
                        .foregroundStyle(BrandColors.inkMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        ForEach(filteredEntries) { entry in
                            row(entry)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 720, idealWidth: 820, minHeight: 480, idealHeight: 600)
        #else
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        #endif
    }

    @ViewBuilder
    private func row(_ entry: DebugLog.Entry) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(timestampString(entry.date))
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(BrandColors.inkMuted)
                .frame(width: 84, alignment: .leading)
            Text(levelLabel(entry.level))
                .font(.system(.caption2, design: .monospaced).weight(.semibold))
                .foregroundStyle(levelColor(entry.level))
                .frame(width: 50, alignment: .leading)
            Text(entry.category)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.tint)
                .frame(width: 100, alignment: .leading)
                .lineLimit(1)
                .truncationMode(.tail)
            Text(entry.message)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(BrandColors.inkStrong)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 2)
        .padding(.horizontal, 6)
        .background(rowBackground(for: entry.level), in: RoundedRectangle(cornerRadius: 4))
    }

    private func timestampString(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f.string(from: date)
    }

    private func levelLabel(_ level: DebugLog.Level) -> String {
        switch level {
        case .info: return "INFO"
        case .warn: return "WARN"
        case .error: return "ERR"
        }
    }

    private func levelColor(_ level: DebugLog.Level) -> Color {
        switch level {
        case .info: return .secondary
        case .warn: return .orange
        case .error: return .red
        }
    }

    private func rowBackground(for level: DebugLog.Level) -> Color {
        switch level {
        case .info: return .clear
        case .warn: return .orange.opacity(0.07)
        case .error: return .red.opacity(0.08)
        }
    }

    private func copyAll() {
        let text = filteredEntries.reversed()
            .map { entry in
                let ts = timestampString(entry.date)
                return "\(ts) [\(entry.level.rawValue.uppercased())] [\(entry.category)] \(entry.message)"
            }
            .joined(separator: "\n")
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #else
        UIPasteboard.general.string = text
        #endif
    }
}

#if os(macOS)
import AppKit
#else
import UIKit
#endif
