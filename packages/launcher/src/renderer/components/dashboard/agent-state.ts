import type { Agent } from "../../types"

export type StateKey = "running" | "idle" | "starting" | "error" | "offline"

export const RUNNING_STATES = ["online", "running", "idle"]

/** Lifecycle state → the label key and the tint the dashboard shows for it. */
export function stateKeyOf(agent: Agent): StateKey {
  if (agent.state === "error" || agent.lastError) return "error"
  if (["online", "running"].includes(agent.state)) return "running"
  if (agent.state === "idle") return "idle"
  if (["starting", "reconnecting"].includes(agent.state)) return "starting"
  return "offline"
}

export const STATE_TEXT_CLASS: Record<StateKey, string> = {
  running: "text-(--success-text)",
  idle: "text-(--warning-text)",
  starting: "text-(--warning-text)",
  error: "text-(--danger-text)",
  offline: "text-muted-foreground",
}

export const AGENT_FILTERS = ["all", "running", "error", "stopped"] as const
export type AgentFilter = (typeof AGENT_FILTERS)[number]

export function matchesFilter(agent: Agent, filter: AgentFilter): boolean {
  const key = stateKeyOf(agent)
  if (filter === "running") return key === "running" || key === "idle"
  if (filter === "error") return key === "error"
  if (filter === "stopped") return key === "offline" || key === "starting"
  return true
}

/** Workspace label, preferring the human name over the raw network id. */
export function workspaceLabel(agent: Agent): string {
  if (!agent.network) return ""
  return agent.networkName && agent.networkName !== agent.network
    ? agent.networkName
    : agent.network
}
