import type { Agent } from "@renderer/types"

/**
 * Row actions, shared by the table and the card grid so both views offer the
 * same set and the page wires them up once.
 */
export interface AgentActionHandlers {
  onToggle: (a: Agent) => void
  onOpenTerminal: (a: Agent) => void
  onConfigure: (a: Agent) => void
  onRename: (a: Agent) => void
  onConnect: (a: Agent) => void
  onDisconnect: (a: Agent) => void
  onOpenWorkspace: (a: Agent) => void
  onRemove: (a: Agent) => void
}

/**
 * What an agent is called on screen.
 *
 * `name` is the identity — it keys the config, the working directory, the
 * sessions and the workspace membership, and every action still takes it. The
 * label is only ever what the user reads, so this is the one place that
 * decides which of the two to show.
 */
export function agentLabel(a: Agent): string {
  return a.displayName?.trim() || a.name
}
