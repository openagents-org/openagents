// ── What an agent's credential fields actually MEAN ──
//
// Two different questions kept being answered by guesswork, in two different
// places, and both got it wrong for the same agents:
//
//   1. main asked "can I probe this key?" by looking at which variable names
//      the env happened to carry. An agent whose key is called something of
//      its own matched nothing and was reported as having NO KEY AT ALL.
//   2. the renderer asked nothing. It offered "Test connection" for every
//      agent, including the ones where no endpoint exists to test against — a
//      button that cannot succeed, wired to a wizard step that only advances
//      on success. CodeBuddy users could not finish setup at all.
//
// So the answer lives here once, in shared/, where both sides read it — the
// same reason `agent-login` lives here.
//
// This file is data about PROTOCOLS, not about vendors: what an endpoint field
// points at, and whether anything on the other side will answer a probe.

/**
 * What an agent's endpoint ("base URL") field points at.
 *
 * The distinction that matters is `platform` versus everything else. For every
 * other value the field is a MODEL endpoint, so a relay, a proxy or a model
 * gateway can be dropped in and the agent will use it. For `platform` the
 * field selects another deployment of the VENDOR'S OWN service — CodeBuddy
 * enterprise, an Amp server — and a model-gateway URL there is not a
 * misconfiguration the agent can recover from; it is a category error.
 */
export type EndpointKind = "openai" | "anthropic" | "gemini" | "platform" | "none"

/** Whether "Test connection" can reach anything for this agent. */
export type Probeable =
  /** A key and an endpoint are enough to run a real completion. */
  | "always"
  /** Depends on a provider field in the form (Pi, Goose, Cline, Aider…). */
  | "conditional"
  /** Nothing to probe, ever — the vendor publishes no key-check endpoint. */
  | "never"

export type AgentCredentials = {
  endpoint: EndpointKind
  probeable: Probeable
  /**
   * For `probeable: "never"`, the i18n key under `agents.credentials.unprobeable`
   * explaining how the credential IS verified. Shown instead of a test button,
   * so the user reads it before spending a minute on a button that cannot pass.
   */
  reason?: string
  /**
   * This agent's form has NO endpoint field, and that is deliberate — but an
   * absence explains nothing. Next to agents that do have one, a missing base
   * URL reads as a bug or an oversight, and the user goes looking for the
   * setting rather than for the place it actually lives.
   *
   * Keys `agents.credentials.noEndpoint`, shown under the form.
   */
  noEndpoint?: string
}

const DEFAULT: AgentCredentials = { endpoint: "openai", probeable: "always" }

/**
 * Only the agents that differ from "an OpenAI-compatible endpoint we can
 * probe" are listed. Everything absent takes DEFAULT, which is correct for
 * codex, opencode, openclaw, hermes, kimi, deepseek and anything added later
 * that follows the same shape.
 */
const CREDENTIALS: Record<string, AgentCredentials> = {
  // ── Hosted platforms: the key is for the vendor's service. ──
  codebuddy: {
    // CODEBUDDY_BASE_URL is an enterprise/self-hosted CodeBuddy, not a model
    // endpoint. This is the one that cost a tester an afternoon: a model
    // gateway's key and URL went in, and nothing in the product said they
    // could not work here.
    endpoint: "platform",
    probeable: "never",
    reason: "codebuddy",
  },
  cursor: {
    endpoint: "platform",
    probeable: "never",
    reason: "cursor",
    noEndpoint: "cursor",
  },
  amp: { endpoint: "platform", probeable: "never", reason: "amp" },
  commandcode: {
    endpoint: "none",
    probeable: "never",
    reason: "commandcode",
    // Command Code DOES do BYOK — through its own providers.json, not through
    // anything the launcher writes. Without saying so, its missing base URL
    // looks like the feature is absent rather than elsewhere.
    noEndpoint: "commandcode",
  },
  copilot: {
    endpoint: "none",
    probeable: "never",
    reason: "copilot",
    noEndpoint: "copilot",
  },

  // ── Provider-driven: the form's provider field decides the protocol. ──
  pi: { endpoint: "openai", probeable: "conditional" },
  openworker: { endpoint: "openai", probeable: "conditional" },
  goose: { endpoint: "openai", probeable: "conditional" },
  aider: { endpoint: "openai", probeable: "conditional" },
  cline: {
    endpoint: "none",
    probeable: "conditional",
    // Same shape as Command Code: providers and their endpoints are set up by
    // `cline auth`, and the provider field here only picks among them.
    noEndpoint: "cline",
  },

  // ── Native protocols other than OpenAI's. ──
  claude: { endpoint: "anthropic", probeable: "always" },
  gemini: { endpoint: "gemini", probeable: "always" },
  antigravity: { endpoint: "gemini", probeable: "always" },

  // No credential fields at all.
  nanoclaw: { endpoint: "none", probeable: "never" },
}

export function agentCredentials(agentType: string): AgentCredentials {
  return CREDENTIALS[agentType] || DEFAULT
}

/**
 * Agents whose `*_MODEL` field gets a picker instead of a text box.
 *
 * This is the renderer's half of a pair: main resolves the list itself (see
 * main/agents/model-catalog MODEL_SOURCES), and this says which fields should
 * ask for one. The two used to be hand-synced sets in separate files and had
 * drifted — `commandcode` and `openworker` had working model lists that no
 * form ever showed, because only main's copy knew about them. A test asserts
 * the two stay equal; both live here so there is one place to add an agent.
 */
export const MODEL_LIST_AGENTS: ReadonlySet<string> = new Set([
  "antigravity",
  "claude",
  "codebuddy",
  "codex",
  "commandcode",
  "cursor",
  "deepseek",
  "gemini",
  "kimi",
  "openclaw",
  "opencode",
  "openworker",
  "pi",
])

/** True when offering a "Test connection" button would be a dead end. */
export function isUnprobeable(agentType: string): boolean {
  return agentCredentials(agentType).probeable === "never"
}

/**
 * Hosts we know serve an OpenAI-compatible model API, including our own model
 * gateway. Used only to recognise a URL the user has clearly taken from a
 * model provider, so it can be refused BEFORE it is saved.
 */
const MODEL_ENDPOINT_HOSTS =
  /(^|\.)(api-gateway\.openagents\.org|openai\.com|anthropic\.com|moonshot\.ai|deepseek\.com|openrouter\.ai|x\.ai|mistral\.ai|groq\.com|together\.xyz|fireworks\.ai|generativelanguage\.googleapis\.com)$/i

/**
 * Why the URL typed into this agent's endpoint field cannot work, or null.
 *
 * Deliberately narrow. A `platform` endpoint takes a host we have no way to
 * validate — any company's internal CodeBuddy — so guessing would block real
 * deployments. What we CAN recognise is the opposite mistake: a URL that is
 * unmistakably a model API, either by host or by the `/v1` path every
 * OpenAI-compatible endpoint carries. That is the mistake people actually
 * make, and the only one worth refusing.
 *
 * Returns an i18n key under `agents.credentials.endpointMismatch`.
 */
export function endpointMismatch(
  agentType: string,
  value: string,
): "gatewayIntoPlatform" | null {
  const url = (value || "").trim()
  if (!url) return null
  if (agentCredentials(agentType).endpoint !== "platform") return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null // not a URL yet — the user is still typing
  }
  const looksLikeModelApi =
    MODEL_ENDPOINT_HOSTS.test(parsed.hostname) ||
    /\/v\d+\/?$/.test(parsed.pathname)
  return looksLikeModelApi ? "gatewayIntoPlatform" : null
}

/**
 * Fields that should not be on screen until asked for.
 *
 * A warning under a field the user has already filled in is a fix applied too
 * late: they had to believe the field would work to type in it, and the field
 * looking exactly like every other agent's base URL is what told them so. The
 * endpoint of a hosted platform is therefore not shown at all by default —
 * it exists for enterprise and self-hosted deployments, which is a deliberate
 * act, not something anyone reaches for by accident.
 *
 * Nothing else is hidden. Tuning knobs are harmless where they are, and
 * hiding a real credential field would be worse than the problem.
 */
export function isAdvancedField(agentType: string, name: string): boolean {
  if (agentCredentials(agentType).endpoint !== "platform") return false
  return /_BASE_URL$|_URL$|_ENDPOINT$|_HOST$/.test(name)
}

/**
 * Every field of this form whose value cannot work, as field name → i18n key.
 *
 * Used to REFUSE the save, not just to annotate it. The mistake this exists
 * for — a model-gateway key and URL in an agent that speaks its vendor's own
 * protocol — produces an agent that saves cleanly, starts cleanly, and fails
 * on its first message with an error from a CLI that never mentions the URL.
 * Nothing about that chain leads back to the field, so the field has to hold
 * the line.
 */
export function credentialErrors(
  agentType: string,
  values: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const [name, value] of Object.entries(values || {})) {
    const mismatch = endpointMismatch(agentType, value)
    if (mismatch && /_BASE_URL$|_URL$|_ENDPOINT$|_HOST$/.test(name)) {
      errors[name] = mismatch
    }
  }
  return errors
}

/**
 * Sort order for an agent's env fields.
 *
 * The registry lists them in the order they were written, which put
 * CodeBuddy's endpoint field last — below two advanced tuning knobs, off the
 * bottom of a scrolling dialog — while the fields someone must fill in to get
 * anywhere sat above it in no particular order. This orders them by what the
 * user has to decide, in the order they have to decide it:
 *
 *   provider/region first (it changes what the rest of the form means),
 *   then the credential, then where to send it, then which model,
 *   then everything that has a working default.
 *
 * Stable: fields of equal rank keep their registry order.
 */
const FIELD_RANKS: Array<[RegExp, number]> = [
  [/_PROVIDER$|_REGION$|_API_FORMAT$/, 0],
  [/_API_KEY$|_AUTH_TOKEN$|_TOKEN$|_KEY$/, 1],
  [/_BASE_URL$|_HOST$|_URL$|_API_BASE$|_ENDPOINT$/, 2],
  [/_MODEL$|_MODEL_NAME$/, 3],
]

export function fieldRank(name: string): number {
  for (const [re, rank] of FIELD_RANKS) if (re.test(name)) return rank
  return 4
}

/** Order a form's fields by what the user has to decide first. */
export function sortCredentialFields<T extends { name?: unknown }>(
  fields: T[],
): T[] {
  return fields
    .map((f, i) => ({ f, i, rank: fieldRank(String(f.name || "")) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.f)
}
