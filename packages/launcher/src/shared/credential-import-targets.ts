// ── How each agent's form spells an imported credential ──
//
// One entry per agent whose form takes a model key the user may already have
// somewhere. Agents that authenticate against their vendor's own service —
// Cursor, Amp, Command Code, CodeBuddy, Copilot — are absent on purpose: a model
// key from anywhere else cannot work there, so there is nothing to offer.
//
// Every patch sets the credential, the endpoint and the model together. A model
// left over from the previous endpoint is exactly the value that makes a freshly
// imported key fail, so an import that names no model clears the field and the
// picker loads what the new endpoint serves.

import {
  effectiveBase,
  VENDOR_BASES,
  type CredentialProfile,
  type Protocol,
  type Vendor,
} from "./credential-import"

export type ImportableCredential = Omit<CredentialProfile, "source">
type Patch = Record<string, string>
type Target = (c: ImportableCredential) => Patch | null

/** The base URL for a field where blank means "the vendor's own endpoint". */
function customBase(c: ImportableCredential): string {
  if (c.vendor === "relay") return c.baseUrl
  return c.baseUrl && c.baseUrl !== VENDOR_BASES[c.vendor] ? c.baseUrl : ""
}

/** Key + OpenAI-compatible base URL + model: any key that speaks that protocol. */
function openaiCompatible(key: string, base: string, model: string): Target {
  return (c) =>
    c.protocol === "openai"
      ? { [key]: c.apiKey, [base]: effectiveBase(c), [model]: c.model }
      : null
}

function geminiForm(model: string): Target {
  return (c) =>
    c.protocol === "gemini"
      ? {
          GEMINI_API_KEY: c.apiKey,
          GOOGLE_GEMINI_BASE_URL: effectiveBase(c),
          [model]: c.model,
        }
      : null
}

const PI_PROVIDERS: Partial<Record<Vendor, string>> = {
  anthropic: "anthropic",
  openai: "openai",
  deepseek: "deepseek",
  openrouter: "openrouter",
  google: "google",
}

/**
 * Pi names a provider. A vendor's own key goes to that provider as it is;
 * anything else is a relay, reached through the provider for its protocol with
 * the endpoint and wire format spelled out.
 */
function pi(c: ImportableCredential): Patch | null {
  const common = { PI_API_KEY: c.apiKey, PI_MODEL: c.model }
  const native = PI_PROVIDERS[c.vendor]
  if (native && !customBase(c))
    return {
      PI_PROVIDER: native,
      PI_BASE_URL: "",
      PI_API_FORMAT: "auto",
      ...common,
    }
  if (c.protocol === "gemini") return null
  return {
    PI_PROVIDER: c.protocol,
    PI_BASE_URL: effectiveBase(c),
    PI_API_FORMAT:
      c.protocol === "anthropic" ? "anthropic-messages" : "openai-completions",
    ...common,
  }
}

const OPENWORKER_PROVIDERS: Partial<Record<Vendor, string>> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "gemini",
  deepseek: "deepseek",
  moonshot: "kimi",
  openrouter: "openrouter",
}

const PROTOCOL_PROVIDERS: Record<Protocol, string> = {
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
}

/** OpenWorker finds a vendor's endpoint from the provider; a relay keeps its own. */
function openworker(c: ImportableCredential): Patch {
  return {
    OPENWORKER_PROVIDER:
      OPENWORKER_PROVIDERS[c.vendor] ?? PROTOCOL_PROVIDERS[c.protocol],
    OPENWORKER_API_KEY: c.apiKey,
    OPENWORKER_BASE_URL: customBase(c),
    OPENWORKER_MODEL: c.model,
  }
}

/**
 * Cline's own provider ids. Its form has no endpoint field, so a key that needs
 * one — a relay, or a vendor reached at another address — cannot be carried
 * over. `openai-native` is OpenAI itself; Cline's `openai` provider is the
 * compatible-endpoint one, which needs exactly the URL this form lacks.
 */
const CLINE_PROVIDERS: Partial<Record<Vendor, string>> = {
  anthropic: "anthropic",
  openai: "openai-native",
  google: "gemini",
  deepseek: "deepseek",
  moonshot: "moonshot",
  openrouter: "openrouter",
}

function cline(c: ImportableCredential): Patch | null {
  const provider = CLINE_PROVIDERS[c.vendor]
  if (!provider || customBase(c)) return null
  return {
    CLINE_PROVIDER: provider,
    CLINE_API_KEY: c.apiKey,
    CLINE_MODEL: c.model,
  }
}

const TARGETS: Record<string, Target> = {
  claude: (c) =>
    c.protocol === "anthropic"
      ? {
          ANTHROPIC_API_KEY: c.apiKey,
          ANTHROPIC_BASE_URL: effectiveBase(c),
          ANTHROPIC_MODEL: c.model,
        }
      : null,
  // Codex is built around OpenAI's own API. A key issued by another vendor is
  // offered to the agents made for that vendor instead.
  codex: (c) =>
    c.protocol === "openai" && (c.vendor === "openai" || c.vendor === "relay")
      ? {
          OPENAI_API_KEY: c.apiKey,
          OPENAI_BASE_URL: effectiveBase(c),
          CODEX_MODEL: c.model,
        }
      : null,
  opencode: openaiCompatible("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"),
  openclaw: openaiCompatible("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"),
  hermes: openaiCompatible("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"),
  kimi: (c) =>
    c.vendor === "moonshot"
      ? {
          KIMI_API_KEY: c.apiKey,
          KIMI_BASE_URL: effectiveBase(c),
          KIMI_MODEL: c.model,
        }
      : null,
  deepseek: (c) =>
    c.vendor === "deepseek"
      ? {
          DEEPSEEK_API_KEY: c.apiKey,
          DEEPSEEK_BASE_URL: customBase(c),
          DEEPSEEK_MODEL: c.model,
        }
      : null,
  gemini: geminiForm("GEMINI_MODEL"),
  antigravity: geminiForm("ANTIGRAVITY_MODEL"),
  pi,
  openworker,
  cline,
}

/** The form values for this credential, or null when this agent cannot use it. */
export function importPatch(
  agentType: string,
  c: ImportableCredential,
): Patch | null {
  return TARGETS[agentType]?.(c) ?? null
}

/** Whether this agent's form can take an imported credential at all. */
export function canImportCredentials(agentType: string): boolean {
  return Object.prototype.hasOwnProperty.call(TARGETS, agentType)
}

export const IMPORT_TARGET_AGENTS: readonly string[] = Object.keys(TARGETS)
