/**
 * Where an agent's MODEL field gets its choices.
 *
 * Every agent the launcher ships used to carry ONE hardcoded model id as the
 * default of its `*_MODEL` env field. That id ages out: `gpt-5-codex` is no
 * longer in OpenAI's Codex line-up at all, so a codex agent signed in with a
 * ChatGPT account — the path where the launcher shows no model input — ran
 * every message against a model its account cannot serve, and the run failed
 * with nothing in the UI to change. Relays are the same story from the other
 * side: their channel names never match whatever we baked in.
 *
 * So the list is READ, not declared. In order of trustworthiness:
 *
 *   • the CLI's own cache — codex writes the exact model line-up its account
 *     may use to `~/.codex/models_cache.json` (slug, display name, deprecation
 *     notice) after `codex login`. This is the ONLY honest source for a
 *     subscription sign-in: no API key exists to ask a server with.
 *   • the provider, over HTTP — with a key + base URL in hand we ask the
 *     endpoint the agent will actually talk to (`/v1/models` and friends), so
 *     a relay answers for its own channels rather than us guessing.
 *   • a small built-in list — last resort, and flagged as such to the UI so it
 *     can say the list may be stale instead of presenting it as truth.
 *
 * Nothing here is authoritative over what the user types: the model field stays
 * free-form everywhere (a private deployment name is still a valid answer), and
 * an empty value keeps meaning "whatever the CLI/provider defaults to".
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { isOfficialAnthropicBase } from "./env-normalize"
import { httpRequestJson } from "./llm-test"

export type ModelChoice = {
  /** The exact value written to the env var. */
  id: string
  /** Human name from the provider, when it gives one. */
  label?: string
  /** One line of provider-supplied context (deprecation, description). */
  note?: string
  /** The provider says this one is going away — the UI sinks/marks it. */
  deprecated?: boolean
}

export type ModelListResult = {
  models: ModelChoice[]
  /** Where the list came from, so the UI can be honest about it. */
  source: "cli" | "api" | "builtin" | "none"
  /** Why the list is empty / fell back. Never carries the key. */
  error?: string
  /**
   * Machine-readable reason, when there is one worth phrasing in the user's
   * language. `need_key` — the API-key path has no key yet; `need_login` — the
   * CLI path has a list to read but nobody is signed in; `no_list` — this agent
   * publishes no list on the CLI path at all, so the id has to be typed.
   */
  code?: "need_key" | "need_login" | "no_list"
}

/**
 * Which auth path the user is configuring. The list has to follow it: someone
 * filling in the API-key form wants the models THAT endpoint serves, even on a
 * machine where the same agent happens to be signed in through its CLI — the
 * account's line-up is the wrong answer there, and a convincing one.
 */
export type ModelListPath = "key" | "login"

type Provider = "openai" | "anthropic" | "gemini" | "none"

type ModelSource = {
  /** The env var this agent's model lives in. */
  envVar: string
  provider: Provider
  /** Candidate key vars, in precedence order. */
  keyVars: string[]
  /** Candidate base-URL vars, in precedence order. */
  baseVars: string[]
  /** Reads a list the agent's own CLI maintains (no API key involved). */
  cliCache?: (env: Record<string, string>) => ModelListResult | null
  /**
   * Asks the agent's CLI for its list (needs `deps.runCli`). `credVars` are the
   * form values handed to the child process, so a CLI that can authenticate
   * either way answers for the credentials being configured rather than for
   * whatever session the machine happens to hold.
   */
  cliCommand?: {
    args: string[]
    parse: (out: string) => ModelChoice[]
    credVars?: string[]
  }
  /** Used only when nothing can be probed. */
  builtin?: ModelChoice[]
}

/**
 * Anthropic's current line-up, for a Claude agent signed in with a Pro/Max
 * subscription — there is no key to list models with, and Claude Code has no
 * on-disk cache like codex's. Deliberately ids only (no dated snapshots): the
 * UI labels this source "built-in", and a key/relay replaces it with the live
 * list the moment one is entered.
 */
const ANTHROPIC_BUILTIN: ModelChoice[] = [
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
]

/** `~/.codex` unless the CLI was pointed elsewhere. */
function codexHome(env: Record<string, string>): string {
  return (env.CODEX_HOME || "").trim() || path.join(os.homedir(), ".codex")
}

/**
 * The line-up codex itself last fetched for the signed-in account.
 *
 * Codex refreshes this file on its own (it carries the fetch time, an ETag and
 * the client version) and it is written for BOTH auth paths, so it answers the
 * question the launcher could not answer before: which models may this ChatGPT
 * account actually run? `visibility: "hide"` entries are internal (e.g. the
 * auto-review model) and are dropped; `upgrade` marks a model the backend is
 * retiring, which we keep but flag — it is still selectable today, and the note
 * tells the user what replaces it.
 */
function codexCliModels(env: Record<string, string>): ModelListResult | null {
  const file = path.join(codexHome(env), "models_cache.json")
  let raw: string
  try {
    raw = fs.readFileSync(file, "utf-8")
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as {
      models?: Array<Record<string, unknown>>
    }
    const list = Array.isArray(parsed.models) ? parsed.models : []
    const models = list
      .filter((m) => (m.visibility as string) !== "hide")
      .filter((m) => typeof m.slug === "string" && (m.slug as string).trim())
      .sort(
        (a, b) =>
          (typeof a.priority === "number" ? a.priority : 999) -
          (typeof b.priority === "number" ? b.priority : 999),
      )
      .map((m) => {
        const upgrade = m.upgrade as { model?: string } | null | undefined
        return {
          id: (m.slug as string).trim(),
          label: (m.display_name as string) || undefined,
          note: upgrade?.model
            ? `Being retired — use ${upgrade.model}`
            : (m.description as string) || undefined,
          deprecated: !!upgrade?.model,
        }
      })
    if (!models.length) return null
    return { models, source: "cli" }
  } catch {
    return null
  }
}

/**
 * `cursor-agent --list-models`, which prints one `slug - Display Name` per line
 * under an "Available models" header and marks the CLI's current pick with a
 * trailing "(current)". Cursor authenticates entirely through its own service,
 * so there is no endpoint the launcher may ask — but the CLI will answer for
 * the signed-in account, which is the same deal codex's cache gives us.
 */
function parseCursorModels(out: string): ModelChoice[] {
  const models: ModelChoice[] = []
  const seen = new Set<string>()
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\S+)\s+-\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    const id = m[1]
    if (seen.has(id)) continue
    seen.add(id)
    models.push({ id, label: m[2].replace(/\s*\(current\)\s*$/i, "") })
  }
  return models
}

/**
 * `command-code --list-models`, which is the only honest source for this agent:
 * the list spans the account's plan models AND whatever BYOK providers the user
 * declared in ~/.commandcode/providers.json, so no single endpoint could answer
 * for it.
 *
 * The output groups models under a provider heading:
 *
 *   Available models  ·  42 models
 *
 *   Command Code
 *
 *   claude-sonnet-4-6      Balanced frontier model (default)
 *   kimi-k2.5              FREE Open-weights
 *
 *   OpenRouter
 *
 *   moonshotai/kimi-k2.5   Via OpenRouter
 *
 *   Pass the full id, or just the short name after the last "/":
 *   cmd --model moonshotai/kimi-k2.5
 *
 * Model ids and group headings are both flush-left, so telling them apart is
 * the whole job. A heading is a display name ("OpenRouter"); an id is either
 * provider-qualified (`moonshotai/kimi-k2.5`) or lower-case
 * (`claude-sonnet-4-6`). Anything with a capital and no slash is a heading.
 */
export function parseCommandCodeModels(out: string): ModelChoice[] {
  const models: ModelChoice[] = []
  const seen = new Set<string>()
  // The CLI colorizes headings, the FREE badge and the (default) marker.
  // Built from a char code so no invisible control character lands in this
  // source file (and no eslint no-control-regex suppression is needed).
  const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")
  const stripAnsi = (s: string): string => s.replace(ANSI_RE, "")

  for (const raw of out.split(/\r?\n/)) {
    const line = stripAnsi(raw).replace(/\s+$/, "")
    if (!line.trim()) continue
    // Header, the usage footer, its example invocations, and the docs link.
    if (/^Available models\b/i.test(line)) continue
    if (/^Pass the full id\b/i.test(line)) continue
    if (/^Docs:/i.test(line)) continue
    if (/^(cmd|cmdc|command-code|commandcode)\b/.test(line)) continue

    const m = /^(\S+)(?:\s{2,}(.*))?$/.exec(line)
    if (!m) continue
    const id = m[1]
    // A provider-qualified id is unambiguous; an unqualified one must be
    // lower-case to be a model rather than a group heading.
    if (!id.includes("/") && id !== id.toLowerCase()) continue
    if (!/^[A-Za-z0-9][\w.\-]*(?:\/[\w.\-]+)*$/.test(id)) continue
    if (seen.has(id)) continue
    seen.add(id)

    const note = (m[2] || "")
      .replace(/\s*\(default\)\s*$/i, "")
      .replace(/^FREE\s+/i, "")
      .trim()
    models.push(note ? { id, note } : { id })
  }
  return models
}

const MODEL_SOURCES: Record<string, ModelSource> = {
  codex: {
    envVar: "CODEX_MODEL",
    provider: "openai",
    keyVars: ["OPENAI_API_KEY"],
    baseVars: ["OPENAI_BASE_URL"],
    cliCache: codexCliModels,
  },
  cursor: {
    envVar: "CURSOR_MODEL",
    // Cursor's key is for Cursor's own service, not an OpenAI-compatible
    // endpoint — there is nothing to GET /models from, so the CLI is the source
    // on both paths. The key is still declared: it is what tells the key path
    // apart from the sign-in path, and what the CLI is handed below.
    provider: "none",
    keyVars: ["CURSOR_API_KEY"],
    baseVars: ["CURSOR_API_ENDPOINT"],
    cliCommand: {
      args: ["--list-models"],
      parse: parseCursorModels,
      // `cursor-agent` reads CURSOR_API_KEY / CURSOR_API_ENDPOINT from the env
      // (its --api-key flag would put the secret in the process list). Passing
      // the form's values makes the key tab list that key's models instead of
      // the local login's.
      credVars: ["CURSOR_API_KEY", "CURSOR_API_ENDPOINT"],
    },
  },
  commandcode: {
    envVar: "COMMANDCODE_MODEL",
    // Like Cursor, there is no endpoint to ask: the list spans Command Code's
    // own plan models AND the user's BYOK providers (declared in
    // ~/.commandcode/providers.json and routed straight from their machine),
    // so only the CLI can enumerate what this account may actually run.
    provider: "none",
    keyVars: ["COMMAND_CODE_API_KEY"],
    baseVars: [],
    cliCommand: {
      args: ["--list-models"],
      parse: parseCommandCodeModels,
      credVars: ["COMMAND_CODE_API_KEY"],
    },
  },
  claude: {
    envVar: "ANTHROPIC_MODEL",
    provider: "anthropic",
    keyVars: ["ANTHROPIC_API_KEY"],
    baseVars: ["ANTHROPIC_BASE_URL"],
    builtin: ANTHROPIC_BUILTIN,
  },
  gemini: {
    envVar: "GEMINI_MODEL",
    provider: "gemini",
    keyVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    baseVars: ["GOOGLE_GEMINI_BASE_URL"],
  },
  // agy reads only GEMINI_API_KEY (never GOOGLE_API_KEY), so the key list is
  // deliberately narrower than gemini's above.
  antigravity: {
    envVar: "ANTIGRAVITY_MODEL",
    provider: "gemini",
    keyVars: ["GEMINI_API_KEY"],
    baseVars: ["GOOGLE_GEMINI_BASE_URL"],
  },
  kimi: {
    envVar: "KIMI_MODEL",
    provider: "openai",
    keyVars: ["KIMI_API_KEY", "MOONSHOT_API_KEY"],
    baseVars: ["KIMI_BASE_URL"],
  },
  deepseek: {
    envVar: "DEEPSEEK_MODEL",
    provider: "openai",
    keyVars: ["DEEPSEEK_API_KEY"],
    baseVars: ["DEEPSEEK_BASE_URL"],
  },
  openclaw: {
    envVar: "LLM_MODEL",
    provider: "openai",
    keyVars: ["LLM_API_KEY"],
    baseVars: ["LLM_BASE_URL"],
  },
  opencode: {
    envVar: "LLM_MODEL",
    provider: "openai",
    keyVars: ["LLM_API_KEY"],
    baseVars: ["LLM_BASE_URL"],
  },
}

/**
 * Pi carries the provider in its own field, so its model source is resolved per
 * value rather than per agent. `openai-codex` means "reuse the Codex
 * subscription login" — same cache file, no key.
 */
function piSource(env: Record<string, string>): ModelSource {
  const provider = (env.PI_PROVIDER || "").trim().toLowerCase()
  const base: ModelSource = {
    envVar: "PI_MODEL",
    provider: "openai",
    keyVars: ["PI_API_KEY"],
    baseVars: ["PI_BASE_URL"],
  }
  switch (provider) {
    case "anthropic":
      return {
        ...base,
        provider: "anthropic",
        keyVars: ["PI_API_KEY", "ANTHROPIC_API_KEY"],
        builtin: ANTHROPIC_BUILTIN,
      }
    case "google":
      return {
        ...base,
        provider: "gemini",
        keyVars: ["PI_API_KEY", "GEMINI_API_KEY"],
      }
    case "deepseek":
      return { ...base, keyVars: ["PI_API_KEY", "DEEPSEEK_API_KEY"] }
    case "openrouter":
      return { ...base, keyVars: ["PI_API_KEY", "OPENROUTER_API_KEY"] }
    case "openai-codex":
      return {
        ...base,
        keyVars: ["PI_API_KEY", "OPENAI_API_KEY"],
        cliCache: codexCliModels,
      }
    default:
      return { ...base, keyVars: ["PI_API_KEY", "OPENAI_API_KEY"] }
  }
}

function resolveSource(
  agentType: string,
  env: Record<string, string>,
): ModelSource | null {
  if (agentType === "pi") return piSource(env)
  return MODEL_SOURCES[agentType] || null
}

/** The model env var an agent's list applies to, or null if it has none. */
export function modelEnvVar(
  agentType: string,
  env: Record<string, string> = {},
): string | null {
  return resolveSource(agentType, env)?.envVar || null
}

function pick(env: Record<string, string>, names: string[]): string {
  for (const n of names) {
    const v = (env[n] || "").trim()
    if (v) return v
  }
  return ""
}

const trimSlash = (u: string): string => u.replace(/\/+$/, "")

/**
 * The one line worth showing from an error body.
 *
 * Relays answer with a nested JSON envelope — `{"error":{"code":"","message":
 * "无效的令牌 (request id: …)","type":"new_api_error"}}` — and pasting that in
 * raw is how a 401 became an unbroken 120-character string that overflowed the
 * model picker. Anything that isn't JSON is passed through, still trimmed.
 */
function briefHttpError(text: string): string {
  try {
    const j = JSON.parse(text) as {
      error?: { message?: string } | string
      message?: string
    }
    const msg = typeof j.error === "string" ? j.error : j.error?.message
    const line = (msg || j.message || "").trim()
    if (line) return line.slice(0, 160)
  } catch {
    // not JSON — fall through to the raw body
  }
  return text.trim().slice(0, 160)
}

/** `parseOpenAiModels` for bodies that may not be JSON at all. */
function safeParseOpenAiModels(text: string): ModelChoice[] {
  try {
    return parseOpenAiModels(text)
  } catch {
    return []
  }
}

/** `data: [{ id }]`, an array, or a relay's `{ models: [...] }` shape. */
function parseOpenAiModels(text: string): ModelChoice[] {
  const parsed: unknown = JSON.parse(text)
  const list = Array.isArray(parsed)
    ? parsed
    : ((parsed as { data?: unknown[] })?.data ??
      (parsed as { models?: unknown[] })?.models ??
      [])
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: ModelChoice[] = []
  for (const entry of list) {
    const id =
      typeof entry === "string"
        ? entry
        : String((entry as { id?: unknown })?.id ?? "")
    const trimmed = id.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push({ id: trimmed })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

async function listOpenAiModels(
  key: string,
  baseInput: string,
): Promise<ModelListResult> {
  let base = trimSlash(baseInput || "https://api.openai.com/v1")
  if (!/\/v\d+$/.test(base)) base += "/v1"
  const { status, text } = await httpRequestJson(
    `${base}/models`,
    "GET",
    { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    null,
  )
  if (status >= 400)
    return {
      models: [],
      source: "none",
      error: `HTTP ${status}: ${briefHttpError(text)}`,
    }
  const models = parseOpenAiModels(text)
  return models.length
    ? { models, source: "api" }
    : { models: [], source: "none", error: "The endpoint listed no models." }
}

async function listAnthropicModels(
  key: string,
  baseInput: string,
): Promise<ModelListResult> {
  const base = trimSlash(baseInput || "https://api.anthropic.com").replace(
    /\/v1$/,
    "",
  )
  // Same header choice as the connection test: official takes `x-api-key`, a
  // relay only ever honors `Authorization: Bearer` (see llm-test).
  const auth: Record<string, string> = isOfficialAnthropicBase(base)
    ? { "x-api-key": key }
    : { Authorization: `Bearer ${key}` }
  const { status, text } = await httpRequestJson(
    `${base}/v1/models?limit=100`,
    "GET",
    { ...auth, "anthropic-version": "2023-06-01" },
    null,
  )
  if (status >= 400)
    return {
      models: [],
      source: "none",
      error: `HTTP ${status}: ${briefHttpError(text)}`,
    }
  try {
    const parsed = JSON.parse(text) as {
      data?: Array<{ id?: string; display_name?: string }>
    }
    const models = (parsed.data || [])
      .filter((m) => typeof m.id === "string" && m.id.trim())
      .map((m) => ({ id: (m.id as string).trim(), label: m.display_name }))
    if (models.length) return { models, source: "api" }
  } catch {
    // fall through — a relay that answers /v1/models with HTML is not a list
  }
  return { models: [], source: "none", error: "The endpoint listed no models." }
}

/** Google's own endpoint, as opposed to a relay or self-hosted gateway. */
function isOfficialGeminiBase(base: string): boolean {
  try {
    return /(^|\.)googleapis\.com$/i.test(new URL(base).hostname)
  } catch {
    return false
  }
}

/** Google's `{ models: [{ name: "models/…" }] }`, or [] for anything else. */
function parseGeminiModels(text: string): ModelChoice[] {
  try {
    const parsed = JSON.parse(text) as {
      models?: Array<{
        name?: string
        displayName?: string
        supportedGenerationMethods?: string[]
      }>
    }
    return (parsed.models || [])
      .filter(
        (m) =>
          !m.supportedGenerationMethods ||
          m.supportedGenerationMethods.includes("generateContent"),
      )
      .map((m) => ({
        // The API returns `models/gemini-…`; the CLI's -m wants the bare id.
        id: String(m.name || "").replace(/^models\//, ""),
        label: m.displayName,
      }))
      .filter((m) => m.id)
  } catch {
    return []
  }
}

async function listGeminiModels(
  key: string,
  baseInput: string,
): Promise<ModelListResult> {
  const base = trimSlash(
    baseInput || "https://generativelanguage.googleapis.com",
  )
  // Relays are usually entered WITH the version segment already in the base
  // URL, so only add one when it isn't there (mirrors llm-test's Gemini path).
  const url = /\/v\d+(beta)?$/.test(base)
    ? `${base}/models`
    : `${base}/v1beta/models`
  const native = await httpRequestJson(
    `${url}?key=${encodeURIComponent(key)}&pageSize=200`,
    "GET",
    { "x-goog-api-key": key },
    null,
  )
  if (native.status < 400) {
    const models = parseGeminiModels(native.text)
    if (models.length) return { models, source: "api" }
    // A gateway may answer this path in the OpenAI dialect regardless of how
    // it was asked, so read the body both ways before calling it empty.
    const compat = safeParseOpenAiModels(native.text)
    if (compat.length) return { models: compat, source: "api" }
  }
  // A relay's `/v1` is an OpenAI-compatible surface. It proxies
  // `:generateContent` off the `?key=` query — which is why Test connection
  // passes — but guards `/v1/models` with `Authorization: Bearer` and answers
  // the Google-style call with 401 "invalid token". So ask again the way that
  // surface expects. Never against Google itself: it reads a Bearer as an
  // OAuth token and rejects a plain API key with the same 401.
  if (!isOfficialGeminiBase(base)) {
    const bearer = await httpRequestJson(
      `${url}?pageSize=200`,
      "GET",
      { Authorization: `Bearer ${key}` },
      null,
    )
    if (bearer.status < 400) {
      const models = safeParseOpenAiModels(bearer.text)
      if (models.length) return { models, source: "api" }
      const google = parseGeminiModels(bearer.text)
      if (google.length) return { models: google, source: "api" }
    }
    if (native.status >= 400)
      return {
        models: [],
        source: "none",
        // Report whichever attempt got furthest — a 401 on both is the
        // relay's verdict on the key, and that is what the user has to act on.
        error: `HTTP ${bearer.status}: ${briefHttpError(bearer.text)}`,
      }
  }
  if (native.status >= 400)
    return {
      models: [],
      source: "none",
      error: `HTTP ${native.status}: ${briefHttpError(native.text)}`,
    }
  return { models: [], source: "none", error: "The endpoint listed no models." }
}

export type ModelCatalogDeps = {
  /**
   * Runs the agent's own CLI and returns its output, or null when the binary
   * isn't installed / the run fails. Injected (rather than spawned here) so the
   * launcher's one Windows-safe spawn path is reused — see LoginProbe.
   */
  runCli?: (
    agentType: string,
    args: string[],
    env?: Record<string, string>,
  ) => Promise<string | null>
}

/**
 * The CLI's answer, from whichever of the two CLI sources this agent has.
 * `creds` are handed to the child when the caller is configuring the API-key
 * path — see cliCommand.credVars.
 */
async function fromCli(
  agentType: string,
  source: ModelSource,
  env: Record<string, string>,
  deps: ModelCatalogDeps,
  creds?: Record<string, string>,
): Promise<ModelListResult | null> {
  const cached = source.cliCache?.(env) || null
  if (cached) return cached
  if (!source.cliCommand || !deps.runCli) return null
  const out = await deps.runCli(agentType, source.cliCommand.args, creds)
  if (!out) return null
  const models = source.cliCommand.parse(out)
  return models.length ? { models, source: "cli" } : null
}

/** The form values a CLI needs to answer for the key being configured. */
function credEnv(
  source: ModelSource,
  env: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of source.cliCommand?.credVars || []) {
    const v = (env[name] || "").trim()
    if (v) out[name] = v
  }
  return out
}

/**
 * The models an agent can be pointed at right now, given the credentials
 * currently in the form (which may not be saved yet — that is the point: the
 * list has to follow the base URL the user is typing).
 *
 * `path` says which half of a dual-auth agent the user is filling in, and it
 * decides the source outright rather than being a hint:
 *
 *   • "key"   — the endpoint in the form, and only that. A machine that also
 *     has the CLI signed in must NOT answer here: someone pointing codex at a
 *     relay was shown their ChatGPT account's line-up, which looks authoritative
 *     and is wrong for that endpoint. With no key yet we say so (`need_key`)
 *     instead of substituting a list from somewhere else. For a CLI that owns
 *     its own service (cursor) the CLI is still the only place a list exists —
 *     so it is run WITH the form's key, answering for that key.
 *   • "login" — the CLI's own list (cache or command), for the session the
 *     agent will actually run under. Any key in the form is ignored.
 *
 * Left unset (a form with no tabs) it keeps the old order: a key means the
 * endpoint, otherwise the CLI, otherwise the built-in list.
 */
export async function listAgentModels(
  agentType: string,
  env: Record<string, string> = {},
  deps: ModelCatalogDeps = {},
  path?: ModelListPath,
): Promise<ModelListResult> {
  const source = resolveSource(agentType, env)
  if (!source)
    return {
      models: [],
      source: "none",
      error: "This agent has no model setting.",
    }

  const key = pick(env, source.keyVars)
  const base = pick(env, source.baseVars)
  // A CLI-only agent (cursor) has no endpoint to query, so the CLI serves both
  // paths — with the form's key on the key path.
  const httpOnlyPath = path === "key" && source.provider !== "none"

  if (path === "key" && !key)
    return {
      models: [],
      source: "none",
      code: "need_key",
      error: "Enter an API key to load this endpoint's models.",
    }

  if ((key || httpOnlyPath) && source.provider !== "none" && path !== "login") {
    try {
      const viaApi =
        source.provider === "anthropic"
          ? await listAnthropicModels(key, base)
          : source.provider === "gemini"
            ? await listGeminiModels(key, base)
            : await listOpenAiModels(key, base)
      if (viaApi.models.length) return viaApi
      // On the key path the endpoint is the only honest source — report why it
      // came back empty rather than quietly showing another account's models.
      if (httpOnlyPath) return viaApi
      const fallback = await fromCli(agentType, source, env, deps)
      if (fallback) return fallback
      if (source.builtin?.length)
        return {
          models: source.builtin,
          source: "builtin",
          error: viaApi.error,
        }
      return viaApi
    } catch (e) {
      const failed = (e as Error)?.message || "Request failed"
      if (httpOnlyPath) return { models: [], source: "none", error: failed }
      const fallback = await fromCli(agentType, source, env, deps)
      if (fallback) return fallback
      if (source.builtin?.length)
        return { models: source.builtin, source: "builtin", error: failed }
      return { models: [], source: "none", error: failed }
    }
  }

  const cli = await fromCli(
    agentType,
    source,
    env,
    deps,
    path === "login" ? undefined : credEnv(source, env),
  )
  if (cli) return cli

  // Nothing answered. Say which kind of "nothing" it was, so the picker can ask
  // for the one thing that would fix it.
  const hasCliSource = !!(source.cliCache || source.cliCommand)
  if (path === "key")
    return {
      models: [],
      source: "none",
      error: hasCliSource
        ? "Couldn't read a model list for this key."
        : "This endpoint returned no model list.",
    }
  if (source.builtin?.length)
    return { models: source.builtin, source: "builtin" }
  return {
    models: [],
    source: "none",
    // An agent with a CLI list just isn't signed in yet; one without (Gemini)
    // never had a list to offer — don't send the user off to sign in again.
    code: hasCliSource ? "need_login" : "no_list",
    error: hasCliSource
      ? "Sign in to load the model list."
      : "This sign-in doesn't publish a model list — type the model id.",
  }
}
