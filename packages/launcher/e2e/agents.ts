// Per-agent config table for the launcher GUI E2E matrix.
//
// `slug` MUST match the catalog/registry name (it's the data-testid suffix
// the renderer emits, e.g. `install-btn-openclaw`). Models / credential env
// vars mirror tests/platform/config.yaml where they already exist; the three
// newer agents (hermes, opencode, gemini) are marked TBD until the user
// supplies keys + confirms the model the launcher's adapter expects.
//
// nanoclaw is intentionally absent — dropped from the target matrix.

export interface AgentSpec {
  /** Registry/catalog slug — also the data-testid suffix. */
  slug: string
  /** Human label, for log lines only. */
  label: string
  /** Model string to enter in the Configure dialog. */
  model: string
  /** Any ONE of these env vars present => the keyed flow can run. */
  credentialEnv: string[]
  /** Whether the Configure dialog expects a base URL (OpenAI-compatible). */
  needsBaseUrl?: boolean
}

export const AGENTS: AgentSpec[] = [
  { slug: "claude",   label: "Claude Code", model: "claude-sonnet-4-6", credentialEnv: ["ANTHROPIC_API_KEY"] },
  { slug: "codex",    label: "Codex",       model: "gpt-5.4",           credentialEnv: ["LLM_API_KEY", "OPENAI_API_KEY"], needsBaseUrl: true },
  { slug: "openclaw", label: "OpenClaw",    model: "claude-sonnet-4-6", credentialEnv: ["LLM_API_KEY", "OPENAI_API_KEY"], needsBaseUrl: true },
  { slug: "opencode", label: "OpenCode",    model: "claude-sonnet-4-6", credentialEnv: ["LLM_API_KEY", "OPENAI_API_KEY"], needsBaseUrl: true }, // model TBD
  { slug: "hermes",   label: "Hermes",      model: "claude-sonnet-4-6", credentialEnv: ["LLM_API_KEY", "OPENAI_API_KEY"], needsBaseUrl: true }, // model TBD
  { slug: "gemini",   label: "Gemini CLI",  model: "gemini-2.5-pro",    credentialEnv: ["GEMINI_API_KEY"] }, // key/model TBD
  { slug: "cursor",   label: "Cursor",      model: "claude-sonnet-4-6", credentialEnv: ["LLM_API_KEY", "OPENAI_API_KEY"] },
]

export function agentBySlug(slug: string): AgentSpec | undefined {
  return AGENTS.find((a) => a.slug === slug)
}
