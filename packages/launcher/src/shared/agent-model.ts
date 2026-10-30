import { isCliLogin } from "./agent-auth-mode"

/**
 * Set by the core (env.js MODEL_MODE_KEY) on an agent whose model was cleared
 * from the workspace: it runs on its CLI's default, and no model in the type
 * env reaches it.
 */
export const MODEL_MODE_KEY = "OPENAGENTS_MODEL_MODE"
export const MODEL_DEFAULT = "default"

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
 * The model an env declares, or null when it sets none.
 *
 * Every agent type names this field differently — ANTHROPIC_MODEL, CODEX_MODEL,
 * KIMI_MODEL, CLINE_MODEL — and new types keep arriving, so the fallback
 * matches the *shape* of the name. A fixed list silently reported "no model"
 * for every type someone forgot to add to it.
 *
 * Lives in shared because the answer depends on env the renderer never sees:
 * an agent configured from the setup wizard or its marketplace page has its
 * model in the TYPE env file, while the agents list only carries the instance
 * env — so the column read "—" for a correctly configured agent, and the one
 * screen that could have said "this one runs deepseek-4-flash" said nothing.
 * The main process merges the two and stamps the answer onto each row.
 */
export function deriveModelFromEnv(
  env: Record<string, string> | null | undefined,
): string | null {
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

/**
 * Instance settings win even when the type default uses a different key. As
 * the core runs it (env.js typeEnvFor), an agent signed in through its CLI or
 * one whose model was cleared takes no model from the type env.
 */
export function deriveAgentModel(
  typeEnv: Record<string, string> | null | undefined,
  instanceEnv: Record<string, string> | null | undefined,
): string | null {
  const ownOnly = isCliLogin(instanceEnv) || instanceEnv?.[MODEL_MODE_KEY] === MODEL_DEFAULT
  return deriveModelFromEnv(instanceEnv) || (ownOnly ? null : deriveModelFromEnv(typeEnv))
}

/**
 * The model for a row of the core's agent list. The row's `env` is the type
 * env with the agent's own over it, so read as the agent's own it turns a
 * model left in the type env into the agent's. `instanceEnv` is the agent's
 * own alone; a core too old to send it gets the merged env, as before.
 */
export function listedAgentModel(
  typeEnv: Record<string, string> | null | undefined,
  row: { env?: Record<string, string> | null; instanceEnv?: Record<string, string> | null },
): string | null {
  return deriveAgentModel(typeEnv, row.instanceEnv ?? row.env)
}
