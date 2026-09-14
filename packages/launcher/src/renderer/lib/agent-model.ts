import type { Agent } from "@renderer/types"

import { deriveModelFromEnv } from "../../shared/agent-model"

/**
 * The model an agent is running, for the agents table and the dashboard.
 *
 * `agent.model` is the main process's answer, resolved against the type env
 * merged with the instance env — the only place both are in hand. The local
 * fallback covers a row that predates it (a cached list from an older build).
 */
export function deriveModel(agent: Agent): string | null {
  return agent.model || deriveModelFromEnv(agent.env)
}
