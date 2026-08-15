import type { Agent } from "@renderer/types"

/**
 * Row actions, shared by the table and the card grid so both views offer the
 * same set and the page wires them up once.
 */
export interface AgentActionHandlers {
  onToggle: (a: Agent) => void
  onOpenTerminal: (a: Agent) => void
  onConfigure: (a: Agent) => void
  onConnect: (a: Agent) => void
  onDisconnect: (a: Agent) => void
  onOpenWorkspace: (a: Agent) => void
  onRemove: (a: Agent) => void
}
