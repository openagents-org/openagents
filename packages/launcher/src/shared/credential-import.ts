// ── A model credential this machine already has ──
//
// People set a model key up once — in Claude Code's settings, in OpenCode's
// sign-in, in their shell profile — and then met a launcher form asking for it
// again, one agent at a time. This is the vocabulary both processes share for
// offering those keys back: what a found credential IS, independent of which
// tool it came from or which agent's form it goes into.
//
// Main finds the credentials and keeps them. The renderer only ever holds an
// `ImportCandidate`, whose key is a masked hint. See main/credential-import.

/** The wire protocol an endpoint speaks. */
export type Protocol = "openai" | "anthropic" | "gemini"

/**
 * Who issued the key. A key only works against its issuer, so for most agents
 * this — not the protocol — decides whether it fits: a DeepSeek key speaks the
 * OpenAI protocol and is still useless to Kimi. `relay` is any endpoint we do
 * not recognise: a gateway, a proxy, a self-hosted server.
 */
export type Vendor =
  | "anthropic"
  | "openai"
  | "google"
  | "deepseek"
  | "moonshot"
  | "openrouter"
  | "relay"

type NativeVendor = Exclude<Vendor, "relay">

/** Each vendor's own endpoint, in the form its SDK takes as a base URL. */
export const VENDOR_BASES: Record<NativeVendor, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com",
  deepseek: "https://api.deepseek.com",
  moonshot: "https://api.moonshot.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
}

/** The protocol each vendor's own endpoint speaks. */
const NATIVE_PROTOCOL: Record<NativeVendor, Protocol> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "gemini",
  deepseek: "openai",
  moonshot: "openai",
  openrouter: "openai",
}

const VENDOR_HOSTS: Array<[RegExp, NativeVendor]> = [
  [/(^|\.)anthropic\.com$/i, "anthropic"],
  [/(^|\.)openai\.com$/i, "openai"],
  [/(^|\.)googleapis\.com$/i, "google"],
  [/(^|\.)deepseek\.com$/i, "deepseek"],
  [/(^|\.)moonshot\.(ai|cn)$/i, "moonshot"],
  [/(^|\.)openrouter\.ai$/i, "openrouter"],
]

export type ImportSourceKind = "cli" | "agent" | "shell" | "paste"

export interface ImportSource {
  kind: ImportSourceKind
  /** The CLI id for `cli`, the agent type for `agent`; empty otherwise. */
  ref: string
  /** A name to show when `ref` is not one — an agent the user named. */
  label?: string
}

/** A credential found on this machine. Main process only: it carries the key. */
export interface CredentialProfile {
  protocol: Protocol
  vendor: Vendor
  apiKey: string
  /** As found. Empty means the vendor's own endpoint; a relay always has one. */
  baseUrl: string
  /** Empty when the source named none. */
  model: string
  source: ImportSource
}

/** One offer in the import dialog: everything about a credential but its key. */
export interface ImportCandidate {
  id: string
  protocol: Protocol
  vendor: Vendor
  /** The endpoint the key will be sent to. */
  baseUrl: string
  model: string
  /** The key's recognisable prefix and last characters — enough to tell two apart. */
  keyHint: string
  /** Everywhere this same key and endpoint were found. */
  sources: ImportSource[]
}

/** Product names of the tools whose own config is read. Not translated. */
export const CLI_SOURCE_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
  pi: "Pi",
  gemini: "Gemini CLI",
  cline: "Cline",
  hermes: "Hermes",
}

/**
 * The vendor behind a base URL: a known host's issuer, `relay` for any other
 * web URL, or null for a value that is not one.
 */
export function vendorFromBase(baseUrl: string): Vendor | null {
  let host: string
  try {
    const url = new URL(baseUrl.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    host = url.hostname
  } catch {
    return null
  }
  return VENDOR_HOSTS.find(([re]) => re.test(host))?.[1] ?? "relay"
}

/**
 * What a source found, as a profile — or null when it cannot be one.
 *
 * The base URL outranks the vendor the source implied: an `OPENAI_API_KEY` next
 * to a relay's `OPENAI_BASE_URL` is the relay's key. A vendor's host spoken to
 * in another protocol (DeepSeek's Anthropic-compatible endpoint) is a relay as
 * far as any agent is concerned, since no agent's native provider would reach
 * it. And a relay with no endpoint is nothing anyone can use.
 */
export function makeProfile(input: {
  protocol: Protocol
  vendor: Vendor
  apiKey: string
  baseUrl?: string
  model?: string
  source: ImportSource
}): CredentialProfile | null {
  const apiKey = input.apiKey.trim()
  const baseUrl = (input.baseUrl || "").trim().replace(/\/+$/, "")
  if (!apiKey) return null
  let vendor = baseUrl ? vendorFromBase(baseUrl) : input.vendor
  if (!vendor || (vendor === "relay" && !baseUrl)) return null
  if (vendor !== "relay" && NATIVE_PROTOCOL[vendor] !== input.protocol)
    vendor = "relay"
  let model = (input.model || "").trim()
  // A vendor's own model ids carry no slash, so a qualified one is some tool's
  // spelling ("openai/gpt-5") of a plain id. Relays and OpenRouter really do
  // name models that way, and keep theirs.
  if (vendor !== "relay" && vendor !== "openrouter" && model.includes("/"))
    model = model.slice(model.indexOf("/") + 1)
  return {
    protocol: input.protocol,
    vendor,
    apiKey,
    baseUrl,
    model,
    source: input.source,
  }
}

/** Where the key will actually be sent. */
export function effectiveBase(
  p: Pick<CredentialProfile, "vendor" | "baseUrl">,
): string {
  return p.baseUrl || (p.vendor === "relay" ? "" : VENDOR_BASES[p.vendor])
}

/**
 * One credential found twice is one offer — the key Pi mirrors into
 * ANTHROPIC_API_KEY, a relay set up in both Claude Code and the shell.
 */
export function credentialIdentity(p: CredentialProfile): string {
  const base = effectiveBase(p).toLowerCase()
  const endpoint = p.protocol === "anthropic" ? base.replace(/\/v1$/, "") : base
  return `${p.protocol} ${endpoint} ${p.apiKey}`
}

/** `sk-ant-…a1b2`: the key's recognisable prefix and its tail, never the middle. */
export function maskKey(key: string): string {
  const k = key.trim()
  if (k.length <= 12) return "••••"
  const dash = k.slice(0, 8).lastIndexOf("-")
  const head = dash > 0 ? k.slice(0, dash + 1) : k.slice(0, 3)
  return `${head}…${k.slice(-4)}`
}
