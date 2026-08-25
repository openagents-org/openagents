import type { Agent } from "@renderer/types"

export type StateKey =
  | "running"
  | "idle"
  | "starting"
  | "error"
  | "offline"
  /** No workspace: registered with the daemon, but nothing is driving it. */
  | "notConnected"

export const RUNNING_STATES = ["online", "running", "idle"]

/**
 * Lifecycle state → the label key and the tint every list shows for it.
 *
 * Membership is not a separate question here, because the core does not treat
 * it as one. An agent with a workspace runs the adapter loop — poll the
 * workspace, run the CLI per message. An agent without one takes the branch in
 * daemon.js that writes `state: 'running'` and starts nothing at all
 * ("running (local only, no workspace connected)"): no message source, no
 * process, nothing to be running. Passing that `running` through to the UI
 * reports work that is not happening, so the absence of a workspace is
 * reported as what it is.
 *
 * A workspace whose credential has gone (this device was unpaired) is a
 * different case again: the core sets `error` with "workspace credentials
 * missing — re-pair this device", which is exactly what the user needs to
 * read, so it stays an error.
 */
export function stateKeyOf(agent: Agent): StateKey {
  if (!agent.network) return "notConnected"
  if (agent.state === "error" || agent.lastError) return "error"
  if (["online", "running"].includes(agent.state)) return "running"
  if (agent.state === "idle") return "idle"
  if (["starting", "reconnecting"].includes(agent.state)) return "starting"
  return "offline"
}

/**
 * Running as every surface reports it — counts and the command palette
 * included. Not `RUNNING_STATES.includes(agent.state)`: see `stateKeyOf` for
 * why an agent with no workspace is not running whatever the core wrote.
 */
export function isRunning(agent: Agent): boolean {
  const key = stateKeyOf(agent)
  return key === "running" || key === "idle"
}

export const STATE_TEXT_CLASS: Record<StateKey, string> = {
  running: "text-(--success-text)",
  idle: "text-(--warning-text)",
  starting: "text-(--warning-text)",
  error: "text-(--danger-text)",
  offline: "text-muted-foreground",
  notConnected: "text-muted-foreground",
}

export const AGENT_FILTERS = ["all", "running", "error", "stopped"] as const
export type AgentFilter = (typeof AGENT_FILTERS)[number]

export function matchesFilter(agent: Agent, filter: AgentFilter): boolean {
  const key = stateKeyOf(agent)
  if (filter === "running") return key === "running" || key === "idle"
  if (filter === "error") return key === "error"
  if (filter === "stopped")
    return key === "offline" || key === "starting" || key === "notConnected"
  return true
}

/** Workspace label, preferring the human name over the raw network id. */
export function workspaceLabel(agent: Agent): string {
  if (!agent.network) return ""
  return agent.networkName && agent.networkName !== agent.network
    ? agent.networkName
    : agent.network
}
