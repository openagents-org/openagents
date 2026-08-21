/**
 * Which env fields hold a model id, and which agents the launcher can list
 * models for.
 *
 * The list itself is resolved in the main process (main/agents/model-catalog) —
 * this is only the renderer's answer to "should this input get a model picker".
 * Keep MODEL_LIST_AGENTS in step with MODEL_SOURCES over there: an agent
 * missing here simply gets the plain text input it had before.
 */

/** Every model field we ship is named `<PROVIDER>_MODEL`. */
export function isModelField(name: string): boolean {
  return /_MODEL$/.test(name)
}

const MODEL_LIST_AGENTS = new Set([
  "codex",
  "cursor",
  "claude",
  "gemini",
  "antigravity",
  "kimi",
  "deepseek",
  "openclaw",
  "opencode",
  "pi",
])

export function hasModelPicker(agentType: string, fieldName: string): boolean {
  return isModelField(fieldName) && MODEL_LIST_AGENTS.has(agentType)
}
