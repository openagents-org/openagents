/**
 * Which env fields hold a model id, and which agents the launcher can list
 * models for.
 *
 * The list itself is resolved in the main process (main/agents/model-catalog);
 * this is only the renderer's answer to "should this input get a model picker".
 * The set of agents is NOT repeated here — it lives in shared/agent-credentials
 * alongside the rest of the per-agent credential facts, because the hand-synced
 * copy that used to sit here had fallen behind: `commandcode` and `openworker`
 * had working model lists that no form ever offered.
 */
import { MODEL_LIST_AGENTS } from "../../shared/agent-credentials"

/** Every model field we ship is named `<PROVIDER>_MODEL`. */
export function isModelField(name: string): boolean {
  return /_MODEL$/.test(name)
}

export function hasModelPicker(agentType: string, fieldName: string): boolean {
  return isModelField(fieldName) && MODEL_LIST_AGENTS.has(agentType)
}
