import SwiftUI

/// Agent picker sheet — creates a new thread with the selected master + participants.
/// Mirrors NewThreadDialog from the Electron app.
struct NewThreadSheet: View {
    @Binding var isPresented: Bool
    @Environment(WorkspaceStore.self) private var store
    @EnvironmentObject private var auth: AuthStore

    @State private var selected: Set<String> = []
    @State private var selectedHumans: Set<String> = []
    @State private var master: String?

    private var onlineAgents: [Agent] { store.onlineAgents }
    // Exclude the signed-in user from the People picker — they're the
    // implicit creator of the chat, so picking themselves is meaningless.
    private var humans: [WorkspaceAPI.Collaborator] {
        let me = auth.user?.email.trimmingCharacters(in: .whitespaces).lowercased()
        return store.humans.filter { $0.email.lowercased() != me }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("New Chat")
                        .font(.headline)
                    Text(onlineAgents.count > 1
                         ? "Pick which agents join this conversation."
                         : "Start a new conversation with your agent.")
                        .font(.subheadline)
                        .foregroundStyle(BrandColors.inkMuted)
                }
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 12)

            Divider()

            // Scrollable agent list
            ScrollView {
                VStack(spacing: 6) {
                    if onlineAgents.isEmpty {
                        // Picker only ever lists online agents (you can't start
                        // a chat with an offline one), but the message depends
                        // on whether any agent is connected at all.
                        Text(store.hasConnectedAgents
                             ? "No agents are currently online."
                             : "Connect an agent to start chatting.")
                            .foregroundStyle(BrandColors.inkMuted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 40)
                    }
                    ForEach(onlineAgents) { agent in
                        AgentRow(
                            agent: agent,
                            isSelected: selected.contains(agent.agentName),
                            isMaster: master == agent.agentName,
                            multipleAgents: onlineAgents.count > 1,
                            toggle: { toggle(agent) },
                            setMaster: { master = agent.agentName },
                        )
                    }

                    if !humans.isEmpty {
                        // Humans get added to channel_human_members on the
                        // backend so every message in this chat pushes to
                        // their devices, not just @-mentions.
                        Text("PEOPLE")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(BrandColors.inkMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.top, 12)
                            .padding(.bottom, 2)
                        ForEach(humans, id: \.email) { human in
                            HumanRow(
                                human: human,
                                isSelected: selectedHumans.contains(human.email),
                                toggle: { toggleHuman(human.email) },
                            )
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
            }

            Divider()

            // Footer (pinned)
            HStack {
                Spacer()
                Button("Cancel") { isPresented = false }
                    .keyboardShortcut(.cancelAction)
                Button("Start Chat") { createThread() }
                    .buttonStyle(.borderedProminent)
                    .disabled(selected.isEmpty && selectedHumans.isEmpty)
                    .keyboardShortcut(.defaultAction)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
        }
        #if os(macOS)
        .frame(minWidth: 420, idealWidth: 460, minHeight: 360, idealHeight: 480, maxHeight: 640)
        #else
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        #endif
        .task { await store.refreshDiscovery() }
    }

    private func toggle(_ agent: Agent) {
        let name = agent.agentName
        if selected.contains(name) {
            selected.remove(name)
            if master == name {
                master = selected.first
            }
        } else {
            selected.insert(name)
            if master == nil { master = name }
        }
    }

    private func toggleHuman(_ email: String) {
        if selectedHumans.contains(email) {
            selectedHumans.remove(email)
        } else {
            selectedHumans.insert(email)
        }
    }

    private func createThread() {
        // Master only matters when at least one agent is selected. A
        // human-only chat sends master="" which the backend ignores.
        let chosenMaster = master ?? selected.first ?? ""
        let participants = Array(selected)
        let humanParticipants = Array(selectedHumans)
        if participants.isEmpty && humanParticipants.isEmpty { return }
        isPresented = false
        Task {
            await store.createThread(
                master: chosenMaster,
                participants: participants,
                humanParticipants: humanParticipants,
            )
        }
    }
}

private struct HumanRow: View {
    let human: WorkspaceAPI.Collaborator
    let isSelected: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(isSelected ? BrandColors.primary : .clear)
                        .frame(width: 18, height: 18)
                        .overlay(
                            RoundedRectangle(cornerRadius: 4)
                                .stroke(isSelected ? BrandColors.primary : BrandColors.hairline, lineWidth: 1.5),
                        )
                    if isSelected {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }
                Circle()
                    .fill(BrandColors.hairline)
                    .frame(width: 28, height: 28)
                    .overlay(
                        Image(systemName: "person.fill")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(BrandColors.inkMuted),
                    )
                VStack(alignment: .leading, spacing: 1) {
                    Text(human.displayName ?? human.email)
                        .font(.body)
                        .lineLimit(1)
                    if human.displayName != nil {
                        Text(human.email)
                            .font(.caption)
                            .foregroundStyle(BrandColors.inkMuted)
                            .lineLimit(1)
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(isSelected ? BrandColors.surfaceHi.opacity(0.6) : .clear),
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(.gray.opacity(isSelected ? 0.2 : 0.0), lineWidth: 1),
            )
            .contentShape(Rectangle())
            .opacity(isSelected ? 1.0 : 0.65)
        }
        .buttonStyle(.plain)
    }
}

private struct AgentRow: View {
    let agent: Agent
    let isSelected: Bool
    let isMaster: Bool
    let multipleAgents: Bool
    let toggle: () -> Void
    let setMaster: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 10) {
                // Checkbox
                ZStack {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(isSelected ? BrandColors.primary : .clear)
                        .frame(width: 18, height: 18)
                        .overlay(
                            RoundedRectangle(cornerRadius: 4)
                                .stroke(isSelected ? BrandColors.primary : BrandColors.hairline, lineWidth: 1.5),
                        )
                    if isSelected {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }

                // Avatar
                RoundedRectangle(cornerRadius: 6)
                    .fill(AgentPalette.color(for: agent.agentName))
                    .frame(width: 28, height: 28)
                    .overlay(
                        Text(agent.initials)
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.white),
                    )

                Text(agent.agentName)
                    .font(.body)
                    .lineLimit(1)
                Spacer()

                if multipleAgents && isSelected {
                    if isMaster {
                        Label("lead", systemImage: "star.fill")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.orange)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(.orange.opacity(0.15), in: Capsule())
                    } else {
                        Button("set lead", action: setMaster)
                            .buttonStyle(.borderless)
                            .font(.caption)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(isSelected ? BrandColors.surfaceHi.opacity(0.6) : .clear),
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(.gray.opacity(isSelected ? 0.2 : 0.0), lineWidth: 1),
            )
            .contentShape(Rectangle())
            .opacity(isSelected ? 1.0 : 0.65)
        }
        .buttonStyle(.plain)
    }
}
