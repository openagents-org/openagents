import type { Agent } from "@renderer/types"

import { deriveModelFromEnv } from "../../shared/agent-model"

/**
 * The model an agent is running, for the agents table and the dashboard.
 *
 * `agent.model` is the main process's answer, resolved against the type env
 * merged with the instance env — the only place both are in hand. Its null is
 * an answer too (the agent runs on its CLI's default): the row's env has the
 * type env merged in and would name a model the agent does not use. The local
 * fallback covers only a row without the field (a list cached by an older build).
 */
export function deriveModel(agent: Agent): string | null {
  return agent.model !== undefined ? agent.model : deriveModelFromEnv(agent.env)
}
