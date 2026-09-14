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
