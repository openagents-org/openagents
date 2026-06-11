import SwiftUI

/// A run of consecutive status/thinking messages from one or more agents — rendered
/// as an indented, left-bordered list with per-step icons. Mirrors the React app's
/// IntermediateSteps component.
struct IntermediateStepsView: View {
    let steps: [Message]
    /// True when the agent is still actively producing steps (drives the breathing dots).
    var isActive: Bool = false

    /// Default: collapsed (show only the most recent two steps). User can tap
    /// the "N earlier steps" header to unroll the full history. Resets to
    /// collapsed when the steps array changes underneath us so the rolling
    /// window stays predictable while the agent is working.
    @State private var showAllSteps: Bool = false

    /// How many of the most recent steps stay visible when collapsed.
    private static let collapsedTail: Int = 2

    /// The slice of `steps` that should render right now — either the trailing
    /// `collapsedTail` items (collapsed default) or everything (expanded).
    private var displayedSteps: [Message] {
        if showAllSteps || steps.count <= Self.collapsedTail {
            return steps
        }
        return Array(steps.suffix(Self.collapsedTail))
    }

    /// Number of steps the collapsed view is hiding above the visible tail.
    /// Drives the "▶ N earlier steps" button.
    private var hiddenStepCount: Int {
        max(0, steps.count - displayedSteps.count)
    }

    /// Group consecutive **displayed** steps by sender so we only show the
    /// agent label once per run within the visible window.
    private var senderGroups: [(sender: String, steps: [Message])] {
        var groups: [(String, [Message])] = []
        for step in displayedSteps {
            if let last = groups.last, last.0 == step.senderName {
                groups[groups.count - 1].1.append(step)
            } else {
                groups.append((step.senderName, [step]))
            }
        }
        return groups
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Spacer so the left border lines up with the avatar slot in chat bubbles
            Color.clear.frame(width: 32)

            VStack(alignment: .leading, spacing: 6) {
                if hiddenStepCount > 0 {
                    earlierStepsToggle
                }
                ForEach(Array(senderGroups.enumerated()), id: \.offset) { _, group in
                    if senderGroups.count > 1 || group.steps.first?.isFromUser == false {
                        // Sender chip — only useful when there are multiple agents in this block
                        senderLabel(for: group.sender)
                    }
                    ForEach(group.steps) { message in
                        StepRow(message: message)
                    }
                }
                if isActive {
                    BreathingDots()
                        .padding(.top, 2)
                }
            }
            .padding(.leading, 10)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(.secondary.opacity(0.25))
                    .frame(width: 2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 4)
    }

    /// Header chip shown above the visible tail when there are earlier steps
    /// hidden behind the collapse. Tapping it expands; tapping again collapses.
    @ViewBuilder
    private var earlierStepsToggle: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.18)) {
                showAllSteps.toggle()
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.secondary.opacity(0.6))
                    .rotationEffect(.degrees(showAllSteps ? 90 : 0))
                Text(
                    showAllSteps
                        ? "Hide earlier steps"
                        : "\(hiddenStepCount) earlier step\(hiddenStepCount == 1 ? "" : "s")",
                )
                .font(.caption2)
                .foregroundStyle(.secondary.opacity(0.7))
            }
            .padding(.vertical, 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            showAllSteps
                ? "Hide earlier thinking steps"
                : "Show \(hiddenStepCount) earlier thinking steps",
        )
    }

    @ViewBuilder
    private func senderLabel(for name: String) -> some View {
        HStack(spacing: 5) {
            Circle()
                .fill(AgentPalette.color(for: name))
                .frame(width: 12, height: 12)
                .overlay(
                    Text(initials(for: name))
                        .font(.system(size: 6, weight: .bold))
                        .foregroundStyle(.white),
                )
            Text(name)
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary.opacity(0.7))
        }
        .padding(.top, 2)
    }

    private func initials(for name: String) -> String {
        let parts = name.split(separator: "-").prefix(2)
        if parts.count >= 2 {
            return parts.compactMap { $0.first }.map { String($0).uppercased() }.joined()
        }
        return String(name.prefix(2)).uppercased()
    }
}

// MARK: - Single step row

private struct StepRow: View {
    let message: Message
    @State private var expanded = false

    private var parsed: ParsedStep {
        StepParser.parse(content: message.content, messageType: message.messageType)
    }

    var body: some View {
        switch parsed {
        case .thinking(let text):
            thinkingRow(text: text)
        case .toolCall(let tool, let summary, let args):
            toolRow(tool: tool, summary: summary, args: args)
        case .compacting(let text):
            compactingRow(text: text)
        case .status(let text):
            statusRow(text: text)
        }
    }

    // MARK: Thinking — italic label + indented content if present

    @ViewBuilder
    private func thinkingRow(text: String?) -> some View {
        if let text, !text.isEmpty, text.lowercased() != "thinking..." {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Image(systemName: "brain.head.profile")
                        .font(.system(size: 11))
                        .foregroundStyle(.orange)
                    Text("thinking")
                        .font(.system(size: 10).italic())
                        .foregroundStyle(BrandColors.inkMuted)
                }
                Text(text)
                    .font(.caption)
                    .foregroundStyle(.primary.opacity(0.7))
                    .padding(.leading, 18)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else {
            HStack(spacing: 6) {
                Image(systemName: "brain.head.profile")
                    .font(.system(size: 11))
                    .foregroundStyle(.orange)
                Text("thinking…")
                    .font(.caption.italic())
                    .foregroundStyle(BrandColors.inkMuted)
                    .opacity(0.6)
            }
        }
    }

    // MARK: Tool call — icon + tool name + summary, expandable args

    @ViewBuilder
    private func toolRow(tool: String, summary: String?, args: String?) -> some View {
        let icon = toolIcon(for: tool)
        VStack(alignment: .leading, spacing: 4) {
            Button {
                if args != nil { expanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: icon)
                        .font(.system(size: 11))
                        .foregroundStyle(.blue)
                    Text(tool)
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(.primary.opacity(0.75))
                    if let summary {
                        Text("›")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary.opacity(0.5))
                        Text(summary)
                            .font(.caption)
                            .foregroundStyle(BrandColors.inkMuted)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                    if args != nil {
                        Spacer(minLength: 4)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 9))
                            .foregroundStyle(.secondary.opacity(0.5))
                            .rotationEffect(.degrees(expanded ? 90 : 0))
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(args == nil)

            if expanded, let args {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(args)
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(BrandColors.inkMuted)
                        .padding(8)
                }
                .background(BrandColors.surfaceHi.opacity(0.6), in: RoundedRectangle(cornerRadius: 6))
                .frame(maxHeight: 160)
                .padding(.leading, 18)
            }
        }
    }

    @ViewBuilder
    private func compactingRow(text: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 11))
                .foregroundStyle(.purple)
            Text("Vibing…")
                .font(.caption.italic())
                .foregroundStyle(.purple.opacity(0.7))
        }
    }

    @ViewBuilder
    private func statusRow(text: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: "circle.dotted")
                .font(.system(size: 11))
                .foregroundStyle(.green)
                .padding(.top, 1)
            Text(text)
                .font(.caption)
                .foregroundStyle(BrandColors.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func toolIcon(for tool: String) -> String {
        switch tool {
        case "Write", "Edit": return "pencil"
        case "Read":          return "eye"
        case "Bash":          return "terminal"
        case "Glob", "Grep":  return "magnifyingglass"
        case "workspace_status": return "bolt"
        case "workspace_get_history": return "clock"
        case "workspace_get_agents": return "person.2"
        default:              return "wrench.and.screwdriver"
        }
    }
}

// MARK: - Breathing dots (matches the React `breathing-dots.gif` placeholder)

private struct BreathingDots: View {
    @State private var phase: Double = 0

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .fill(.secondary)
                    .frame(width: 5, height: 5)
                    .opacity(0.3 + 0.7 * abs(sin(phase + Double(i) * 0.6)))
            }
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: false)) {
                phase = .pi * 2
            }
        }
    }
}
