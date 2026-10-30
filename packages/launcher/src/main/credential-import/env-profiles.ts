/**
 * Credentials out of an environment: the shell's, a `.env` file's, or one the
 * launcher saved for an agent.
 */
import {
  makeProfile,
  type CredentialProfile,
  type ImportSource,
  type Protocol,
  type Vendor,
} from "../../shared/credential-import"
import { OPENWORKER_COMPAT_BASES } from "../agents/provider-bases"
import {
  CLINE_PROVIDERS,
  OPENWORKER_PROVIDERS,
  PI_PROVIDERS,
} from "./providers"
import { compact } from "./read"

type Env = Record<string, string | undefined>

/**
 * The variables each vendor's own SDK reads, in precedence order. A key under
 * one of these names is that vendor's unless its base URL says otherwise.
 * ANTHROPIC_AUTH_TOKEN leads because Claude Code prefers it over the API key,
 * and it is where relays tell people to put their token.
 */
const FAMILIES: Array<{
  protocol: Protocol
  vendor: Vendor
  keys: string[]
  bases: string[]
  models: string[]
}> = [
  {
    protocol: "anthropic",
    vendor: "anthropic",
    keys: ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"],
    bases: ["ANTHROPIC_BASE_URL"],
    models: ["ANTHROPIC_MODEL"],
  },
  {
    protocol: "openai",
    vendor: "openai",
    keys: ["OPENAI_API_KEY"],
    bases: ["OPENAI_BASE_URL", "OPENAI_API_BASE"],
    models: ["OPENAI_MODEL", "CODEX_MODEL"],
  },
  {
    protocol: "openai",
    vendor: "deepseek",
    keys: ["DEEPSEEK_API_KEY"],
    bases: ["DEEPSEEK_BASE_URL", "DEEPSEEK_API_BASE"],
    models: ["DEEPSEEK_MODEL"],
  },
  {
    protocol: "openai",
    vendor: "moonshot",
    keys: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
    bases: ["MOONSHOT_BASE_URL", "KIMI_BASE_URL"],
    models: ["KIMI_MODEL"],
  },
  {
    protocol: "openai",
    vendor: "openrouter",
    keys: ["OPENROUTER_API_KEY"],
    bases: [],
    models: [],
  },
  {
    protocol: "gemini",
    vendor: "google",
    keys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    bases: ["GOOGLE_GEMINI_BASE_URL"],
    models: ["GEMINI_MODEL"],
  },
]

function pick(env: Env, names: string[]): string {
  for (const name of names) {
    const value = (env[name] || "").trim()
    if (value) return value
  }
  return ""
}

/** One profile per vendor family present in a plain environment. */
export function profilesFromEnv(
  env: Env,
  source: ImportSource,
): CredentialProfile[] {
  return compact(
    FAMILIES.map((f) =>
      makeProfile({
        protocol: f.protocol,
        vendor: f.vendor,
        apiKey: pick(env, f.keys),
        baseUrl: pick(env, f.bases),
        model: pick(env, f.models),
        source,
      }),
    ),
  )
}

/**
 * Profiles out of an env saved by one of the launcher's forms, or pasted from
 * one. On top of the vendor variables — which the Claude, Codex, Gemini, Kimi
 * and DeepSeek forms use — some forms spell a credential their own way: the
 * generic LLM_* trio (OpenCode, OpenClaw, Hermes), and the forms that name a
 * provider (Pi, OpenWorker, Cline).
 */
export function profilesFromSavedEnv(
  env: Env,
  source: ImportSource,
): CredentialProfile[] {
  return [
    ...compact([
      llmProfile(env, source),
      piProfile(env, source),
      openworkerProfile(env, source),
      clineProfile(env, source),
    ]),
    ...profilesFromEnv(env, source),
  ]
}

/** The LLM_* forms say nothing about their protocol except through the URL. */
function llmProfile(env: Env, source: ImportSource): CredentialProfile | null {
  const baseUrl = pick(env, ["LLM_BASE_URL"])
  return makeProfile({
    protocol: /anthropic/i.test(baseUrl) ? "anthropic" : "openai",
    vendor: "openai",
    apiKey: pick(env, ["LLM_API_KEY"]),
    baseUrl,
    model: pick(env, ["LLM_MODEL"]),
    source,
  })
}

function piProfile(env: Env, source: ImportSource): CredentialProfile | null {
  // Blank means the form's default, which is anthropic.
  const provider = pick(env, ["PI_PROVIDER"]).toLowerCase() || "anthropic"
  const known = PI_PROVIDERS[provider]
  const format = pick(env, ["PI_API_FORMAT"]).toLowerCase()
  return makeProfile({
    protocol: format.startsWith("anthropic")
      ? "anthropic"
      : format.startsWith("openai")
        ? "openai"
        : (known?.protocol ?? "openai"),
    vendor: known?.vendor ?? "relay",
    apiKey: pick(env, ["PI_API_KEY"]),
    baseUrl: pick(env, ["PI_BASE_URL"]),
    model: pick(env, ["PI_MODEL"]),
    source,
  })
}

function openworkerProfile(
  env: Env,
  source: ImportSource,
): CredentialProfile | null {
  const provider = pick(env, ["OPENWORKER_PROVIDER"]).toLowerCase() || "openai"
  const known = OPENWORKER_PROVIDERS[provider]
  return makeProfile({
    protocol: known?.protocol ?? "openai",
    vendor: known?.vendor ?? "relay",
    apiKey: pick(env, ["OPENWORKER_API_KEY"]),
    // The rest of OpenWorker's providers are OpenAI-compatible endpoints it
    // knows the address of; with that address they are usable elsewhere too.
    baseUrl:
      pick(env, ["OPENWORKER_BASE_URL"]) ||
      (known ? "" : OPENWORKER_COMPAT_BASES[provider] || ""),
    model: pick(env, ["OPENWORKER_MODEL"]),
    source,
  })
}

function clineProfile(
  env: Env,
  source: ImportSource,
): CredentialProfile | null {
  const known = CLINE_PROVIDERS[pick(env, ["CLINE_PROVIDER"]).toLowerCase()]
  if (!known) return null
  return makeProfile({
    protocol: known.protocol,
    vendor: known.vendor,
    apiKey: pick(env, ["CLINE_API_KEY"]),
    model: pick(env, ["CLINE_MODEL"]),
    source,
  })
}
