import type { Agent } from "@renderer/types"

/**
 * Model fields the launcher itself defines, in the order to prefer them when an
 * agent carries more than one. This list is a tie-breaker, NOT the match rule —
 * see below.
 */
const PRIMARY_MODEL_KEYS = [
  "ANTHROPIC_MODEL",
  "CODEX_MODEL",
  "OPENAI_MODEL",
  "GEMINI_MODEL",
  "GOOGLE_GEMINI_MODEL",
  "KIMI_MODEL",
  "CURSOR_MODEL",
  "CLINE_MODEL",
  "AIDER_MODEL",
  "OPENCLAW_MODEL",
  "LLM_MODEL",
  "MODEL",
]

/**
 * The model an agent declares in its own env, or null when it never set one.
 * Shared by the agents table and the dashboard, which show the same field.
 *
 * Every agent type names this field differently — ANTHROPIC_MODEL, CODEX_MODEL,
 * KIMI_MODEL, CLINE_MODEL — and new types keep arriving, so the fallback
 * matches the *shape* of the name. A fixed list silently reported "no model"
 * for every type someone forgot to add to it.
 */
export function deriveModel(agent: Agent): string | null {
  const env = agent.env
  if (!env) return null

  for (const key of PRIMARY_MODEL_KEYS) {
    if (env[key]) return env[key]
  }
  // Sorted so an agent with several *_MODEL keys always reports the same one.
  const fallback = Object.keys(env)
    .filter((k) => k.endsWith("_MODEL") && env[k])
    .sort()[0]
  return fallback ? env[fallback] : null
}
