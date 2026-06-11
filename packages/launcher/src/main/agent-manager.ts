import path from "path"
import fs from "fs"
import os from "os"
import https from "https"
import crypto from "crypto"
import { net } from "electron"
import { spawn, spawnSync } from "child_process"
import { withPathEnv, readPathEnv } from "./env"
import { EventEmitter } from "events"
// Bundled fallback registry. When the agent-launcher core hasn't installed
// yet (slow network, antivirus interference on Windows, etc) the connector's
// catalog comes back empty and the onboarding step shows nothing to pick.
// Inlining the registry at build time gives the UI a guaranteed catalog so
// "Pick your first agent" is always populated.
import BUNDLED_REGISTRY from "../../../agent-connector/registry.json"

const CONFIG_DIR = path.join(os.homedir(), ".openagents")
const GLOBAL_CORE = path.join(
  CONFIG_DIR,
  "nodejs",
  "node_modules",
  "@openagents-org",
  "agent-launcher",
)
const LOCAL_CORE = path.resolve(__dirname, "../../../agent-connector")
const INSTALLED_HISTORY_FILE = path.join(
  CONFIG_DIR,
  "installed_agents_history.json",
)
const DAEMON_PID_FILE = path.join(CONFIG_DIR, "daemon.pid")
const DAEMON_STATUS_FILE = path.join(CONFIG_DIR, "daemon.status.json")
const DAEMON_CMD_FILE = path.join(CONFIG_DIR, "daemon.cmd")
const DAEMON_LOG_FILE = path.join(CONFIG_DIR, "daemon.log")

const LAUNCHER_SESSIONS_DIR = path.join(CONFIG_DIR, "launcher-sessions")
const DEFAULT_CHAT_CHANNEL = "main"
const CHAT_POLL_INTERVAL_MS = 2500

interface LauncherSettingsStore {
  get(key?: string): unknown
}

/**
 * A fully-resolved agent for the onboarding picker. Unlike a raw CatalogEntry
 * this is guaranteed to be runnable by the loaded core, and its auth mode is
 * resolved authoritatively (so an agent that needs a key/login is never
 * mislabelled as "no configuration needed").
 */
export interface OnboardingAgent {
  name: string
  label: string
  description: string
  featured: boolean
  order: number
  installed: boolean
  authMode: "env" | "login" | "none"
  loginCommand: string | null
  envFields: Array<Record<string, unknown>>
  docsUrl: string | null
  notReadyMessage: string | null
}

/**
 * Launcher-side auth overrides for agents that authenticate with an API key /
 * base URL. These agents ship in the shared registry with an interactive
 * terminal login (`claude login`, `gemini`, `codex login`), but the launcher
 * prefers to collect the key/base-URL directly in onboarding and inject it into
 * the agent's env — no external terminal. We apply this purely in launcher code
 * so the bundled registry.json (and its source SDK YAML) stays untouched.
 *
 * When an entry exists for an agent we: use these fields as the onboarding
 * inputs, force "env" auth mode, and drop the login command so the terminal
 * path never appears.
 */
const LAUNCHER_AUTH_OVERRIDES: Record<
  string,
  Array<Record<string, unknown>>
> = {
  claude: [
    {
      name: "ANTHROPIC_API_KEY",
      description: "Anthropic API key",
      required: true,
      password: true,
    },
    {
      name: "ANTHROPIC_BASE_URL",
      description: "Anthropic-compatible base URL (the default works for direct Anthropic API; change it for a proxy or relay)",
      required: true,
      default: "https://api.anthropic.com",
      placeholder: "https://api.anthropic.com",
    },
    {
      name: "ANTHROPIC_MODEL",
      description:
        "Model name (change it when using a relay/proxy — its channels rarely match the default)",
      required: true,
      default: "claude-sonnet-4-6",
      placeholder: "claude-sonnet-4-6",
    },
  ],
  gemini: [
    {
      name: "GEMINI_API_KEY",
      description: "Google AI Studio API key — get one at https://aistudio.google.com/apikey",
      required: true,
      password: true,
    },
    {
      name: "GOOGLE_GEMINI_BASE_URL",
      description: "Gemini-compatible base URL (the default works for Google AI Studio; change it for a proxy or custom gateway)",
      required: true,
      default: "https://generativelanguage.googleapis.com",
      placeholder: "https://generativelanguage.googleapis.com",
    },
    {
      name: "GEMINI_MODEL",
      description:
        "Model name (change it when using a relay/proxy — its channels rarely match the default)",
      required: true,
      default: "gemini-2.5-pro",
      placeholder: "gemini-2.5-pro",
    },
  ],
  codex: [
    {
      name: "OPENAI_API_KEY",
      description: "OpenAI API key",
      required: true,
      password: true,
    },
    {
      name: "OPENAI_BASE_URL",
      description: "OpenAI-compatible base URL (the default works for the OpenAI API; change it for a proxy or relay)",
      required: true,
      default: "https://api.openai.com/v1",
      placeholder: "https://api.openai.com/v1",
    },
    {
      name: "CODEX_MODEL",
      description:
        "Model name (change it when using a relay/proxy — its channels rarely match the default)",
      required: true,
      default: "gpt-5-codex",
      placeholder: "gpt-5-codex",
    },
  ],
  kimi: [
    {
      name: "KIMI_API_KEY",
      description: "Moonshot / Kimi API key (also accepts MOONSHOT_API_KEY)",
      required: true,
      password: true,
    },
    {
      name: "KIMI_BASE_URL",
      description: "Kimi API base URL (OpenAI-compatible endpoint)",
      required: true,
      default: "https://api.moonshot.ai/v1",
      placeholder: "https://api.moonshot.ai/v1",
    },
    {
      name: "KIMI_MODEL",
      description: "Kimi model name",
      required: true,
      default: "kimi-k2.6",
      placeholder: "kimi-k2.6",
    },
  ],
  openclaw: [
    {
      name: "LLM_API_KEY",
      description: "API key",
      required: true,
      password: true,
    },
    {
      name: "LLM_BASE_URL",
      description: "API base URL (OpenAI-compatible endpoint)",
      required: true,
      default: "https://api.openai.com/v1",
      placeholder: "https://api.openai.com/v1",
    },
    {
      name: "LLM_MODEL",
      description: "Model name",
      required: true,
      default: "gpt-4o",
      placeholder: "gpt-4o, claude-sonnet-4-6, deepseek-chat, etc.",
    },
  ],
  opencode: [
    {
      name: "LLM_API_KEY",
      description: "API key",
      required: true,
      password: true,
    },
    {
      name: "LLM_BASE_URL",
      description: "API base URL (OpenAI-compatible endpoint)",
      required: true,
      default: "https://api.openai.com/v1",
      placeholder: "https://api.openai.com/v1",
    },
    {
      name: "LLM_MODEL",
      description: "Model name",
      required: true,
      default: "gpt-4o",
      placeholder: "gpt-4o, claude-sonnet-4-6, etc.",
    },
  ],
}

/**
 * Agents that authenticate through their OWN hosted login flow (a browser /
 * device sign-in built into the CLI), not an API key the launcher collects or
 * can probe. Cursor is the canonical example — `cursor-agent` signs in via
 * Cursor's service, so there is no key endpoint to "Test connection" against and
 * no env for the user to fill in. The launcher cannot capture the token (the CLI
 * stores it locally, e.g. under ~/.cursor); it can only drive the CLI's own
 * `login` command and read its `status`. For these agents the launcher:
 *   • shows no API-key config (getEnvFields → []), so the post-install wizard
 *     and the Configure dialog skip the "Save & test connection" step that can
 *     only ever fail;
 *   • surfaces the CLI's `loginCommand` so Configure shows a "Login" button
 *     (opens a terminal running the sign-in) instead of key fields; and
 *   • derives readiness from the CLI's own `status` output (signed in?) rather
 *     than an API key. The shared registry's check_ready for these carries only
 *     a binary hint and no credential/login rule, so the core otherwise reports
 *     ready:false ("CLI not found") even when the CLI IS installed — which is
 *     exactly why the Agents list showed "Not installed" while the marketplace
 *     showed "Installed".
 *
 * `apiKeyEnv` lets a power user skip the browser login by setting that env var
 * (Cursor accepts CURSOR_API_KEY); when present the agent is ready without a
 * `status` probe. `statusArgs` is run against the resolved binary; sign-in is
 * derived from its output via EXACTLY ONE of:
 *   • `loggedOutPattern` — match ⇒ signed OUT (for terse CLIs like Cursor whose
 *     status is just "Not logged in" vs an account line); or
 *   • `loggedInPattern`  — match ⇒ signed IN (for verbose CLIs like Hermes whose
 *     status always lists "not logged in" for every unconfigured provider, so a
 *     negative match is useless — we look for a positive "✓ logged in" instead).
 * The probe runs ASYNC (status can take seconds, e.g. Hermes ~2.5s) and the
 * result is cached; sync health reads the cache and never blocks the main loop.
 */
interface HostedLoginSpec {
  loginCommand: string
  statusArgs: string[]
  loggedOutPattern?: RegExp
  loggedInPattern?: RegExp
  apiKeyEnv?: string
  // Env vars wiped when the user signs in via the browser flow. Hosted-login
  // agents have no env UI (getEnvFields → []), so any saved value is stale
  // leftover that overrides the login session — e.g. an invalid CURSOR_API_KEY
  // or CURSOR_MODEL from the old setup wizard, which is what broke the workspace
  // chat ("API key is invalid"). Clearing them lets the CLI use its own login +
  // account defaults.
  loginClearsEnv?: string[]
}

const HOSTED_LOGIN_AGENTS: Record<string, HostedLoginSpec> = {
  cursor: {
    loginCommand: "cursor-agent login",
    statusArgs: ["status"],
    loggedOutPattern: /not logged in|logged out|signed out/i,
    apiKeyEnv: "CURSOR_API_KEY",
    loginClearsEnv: ["CURSOR_API_KEY", "CURSOR_MODEL"],
  },
  hermes: {
    // `hermes setup` is the interactive wizard; `hermes status` prints a rich
    // report where a configured auth provider reads "✓ logged in" (everything
    // unconfigured reads "✗ not logged in"), so match the positive marker.
    loginCommand: "hermes setup",
    statusArgs: ["status"],
    loggedInPattern: /✓\s*logged in/i,
  },
}

/**
 * Agents hidden from the onboarding picker (Step 1). They remain fully
 * installable and configurable from the Install tab — we just don't surface
 * them to first-time users. Cursor and Hermes need an external CLI install +
 * an API key, so they're a rougher first-run experience than the key-only
 * agents; keep onboarding to the smoother options.
 */
const ONBOARDING_HIDDEN = new Set<string>(["cursor", "hermes"])

/**
 * The agents the launcher/workspace core officially supports today, in the
 * order product wants them surfaced (the "8 核心 agent" list). Anything NOT in
 * this set is shown as "coming soon" in the Install marketplace — visible but
 * not installable, sorted to the bottom — and omitted from onboarding, so users
 * stay on the supported set. Kept in launcher code (not the shared registry) so
 * the supported list can move independently of the catalog, and `coreOrder`
 * gives a single display order regardless of the registry's own
 * featured/order (which is inconsistent for e.g. gemini).
 */
const CORE_AGENTS: readonly string[] = [
  "claude",
  "openclaw",
  "codex",
  "cursor",
  "opencode",
  "hermes",
  "kimi",
  "gemini",
]
const CORE_AGENT_ORDER = new Map<string, number>(
  CORE_AGENTS.map((name, i) => [name, i]),
)

type LLMTestResult = {
  success: boolean
  model?: string
  response?: string
  error?: string
}

function httpRequestJson(
  urlStr: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
  timeoutMs = 15000,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    try {
      // Validate early so a bad base URL fails fast instead of via the socket.
      void new URL(urlStr)
    } catch {
      reject(new Error(`Invalid URL: ${urlStr}`))
      return
    }
    // Use Electron's net (Chromium network stack) rather than Node's https.
    // Node's http/https ignores the OS proxy, so on Windows — where the user's
    // proxy/VPN is usually configured as a *system* HTTP proxy that only
    // WinINET/Chromium honor — requests to api.openai.com / api.anthropic.com /
    // generativelanguage.googleapis.com never connect and hit the timeout,
    // while macOS (typically a transparent/global proxy) passes. net.request
    // resolves the system proxy exactly like the browser, so "Test connection"
    // behaves the same on every platform.
    const req = net.request({ method, url: urlStr })
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v)

    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      finish(() => {
        try {
          req.abort()
        } catch {}
        reject(new Error("Request timed out"))
      })
    }, timeoutMs)

    req.on("response", (res) => {
      let data = ""
      res.on("data", (c: Buffer) => {
        data += c.toString("utf8")
      })
      res.on("end", () =>
        finish(() => resolve({ status: res.statusCode || 0, text: data })),
      )
      res.on("error", (e: Error) => finish(() => reject(e)))
    })
    req.on("error", (e) => finish(() => reject(e)))
    if (body) req.write(body)
    req.end()
  })
}

/**
 * Test an agent's LLM credentials directly from the launcher's main process,
 * independent of the installed core's version (the core's own testLLM is older
 * and only knows the OpenAI-compatible path, so Claude/Gemini keys fail there).
 * We route by which key/base-URL the env carries so the "Test connection"
 * button works for any key-based agent: Anthropic (Claude), Google Gemini, and
 * any OpenAI-compatible endpoint (OpenAI/Codex, Kimi/Moonshot, OpenClaw,
 * OpenCode, custom gateways). Agents that authenticate through a hosted service
 * with no probe-able endpoint (e.g. Cursor) get an honest message instead of a
 * misleading request.
 */
async function testLLMConnection(
  env: Record<string, string>,
): Promise<LLMTestResult> {
  const pick = (...names: string[]): string => {
    for (const n of names) {
      const v = (env[n] || "").trim()
      if (v) return v
    }
    return ""
  }
  const trimSlash = (u: string): string => u.replace(/\/+$/, "")

  try {
    // ── Google Gemini ──
    const geminiKey = pick("GEMINI_API_KEY", "GOOGLE_API_KEY")
    if (geminiKey) {
      const base = trimSlash(
        pick("GOOGLE_GEMINI_BASE_URL") ||
          "https://generativelanguage.googleapis.com",
      )
      const model =
        pick("GEMINI_MODEL", "GOOGLE_GEMINI_MODEL") || "gemini-2.0-flash"
      // Google's REST path is /v1beta/models/<model>:generateContent. Relays
      // and custom gateways are usually entered WITH the version already in the
      // base URL (e.g. https://host/v1beta), so only add it when the base URL
      // doesn't already carry a /v1 or /v1beta segment — otherwise we'd POST to
      // …/v1beta/v1beta/… and the relay never answers (the request hangs to the
      // socket timeout instead of returning a clean error).
      const geminiPath = /\/v\d+(beta)?$/.test(base)
        ? `/models/${model}:generateContent`
        : `/v1beta/models/${model}:generateContent`
      const { status, text } = await httpRequestJson(
        `${base}${geminiPath}?key=${encodeURIComponent(geminiKey)}`,
        "POST",
        // Native Google also accepts the key via x-goog-api-key; harmless next
        // to ?key=. Deliberately NOT sending Authorization: Bearer — Google
        // would treat it as an OAuth token and reject a plain API key with 401.
        { "content-type": "application/json", "x-goog-api-key": geminiKey },
        JSON.stringify({
          contents: [{ parts: [{ text: "Say hi in 5 words." }] }],
        }),
      )
      if (status >= 400)
        return { success: false, error: `HTTP ${status}: ${text.slice(0, 200)}` }
      let reply = ""
      try {
        reply =
          JSON.parse(text)?.candidates?.[0]?.content?.parts?.[0]?.text || ""
      } catch {}
      return { success: true, model, response: reply.slice(0, 80) }
    }

    const anthropicKey = pick("ANTHROPIC_API_KEY")
    const openaiKey = pick(
      "OPENAI_API_KEY",
      "LLM_API_KEY",
      "KIMI_API_KEY",
      "MOONSHOT_API_KEY",
      "OPENROUTER_API_KEY",
    )

    // ── Cursor: hosted login, no public key endpoint to probe ──
    if (pick("CURSOR_API_KEY") && !anthropicKey && !openaiKey) {
      return {
        success: false,
        error:
          "Cursor signs in through its own service — there's no key endpoint to test here. Save the key and launch the agent to verify.",
      }
    }

    // ── Anthropic (Claude) ──
    if (anthropicKey && !openaiKey) {
      const base = trimSlash(
        pick("ANTHROPIC_BASE_URL") || "https://api.anthropic.com",
      ).replace(/\/v1$/, "")
      const model = pick("ANTHROPIC_MODEL") || "claude-3-5-haiku-latest"
      // Mirror exactly how the spawned `claude` CLI will authenticate, so the
      // test predicts the real run: the official endpoint uses `x-api-key`,
      // while a relay/proxy base goes through `Authorization: Bearer` (the CLI
      // gets that via ANTHROPIC_AUTH_TOKEN — see normalizeEnvForSave). Sending
      // x-api-key to a Bearer-only relay is precisely what makes it 401 with
      // "invalid token", so the test must use the same header the agent does.
      const authHeader: Record<string, string> = isOfficialAnthropicBase(base)
        ? { "x-api-key": anthropicKey }
        : { Authorization: `Bearer ${anthropicKey}` }
      const { status, text } = await httpRequestJson(
        `${base}/v1/messages`,
        "POST",
        {
          ...authHeader,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        JSON.stringify({
          model,
          max_tokens: 16,
          messages: [{ role: "user", content: "Say hi in 5 words." }],
        }),
      )
      if (status >= 400)
        return { success: false, error: `HTTP ${status}: ${text.slice(0, 200)}` }
      let reply = "",
        used = model
      try {
        const p = JSON.parse(text)
        reply = p?.content?.[0]?.text || ""
        used = p?.model || model
      } catch {}
      return { success: true, model: used, response: reply.slice(0, 80) }
    }

    // ── OpenAI-compatible (OpenAI/Codex, Kimi/Moonshot, OpenClaw, OpenCode) ──
    const apiKey = openaiKey || anthropicKey
    if (!apiKey) {
      return {
        success: false,
        error:
          "No API key to test for this agent. Enter a key above — or this agent may authenticate a different way (e.g. a hosted login).",
      }
    }
    const hasKimi = !!pick(
      "KIMI_API_KEY",
      "MOONSHOT_API_KEY",
      "KIMI_BASE_URL",
      "KIMI_MODEL",
    )
    let base = trimSlash(
      pick("OPENAI_BASE_URL", "LLM_BASE_URL", "KIMI_BASE_URL") ||
        (hasKimi ? "https://api.moonshot.ai/v1" : "https://api.openai.com/v1"),
    )
    if (!/\/v\d+$/.test(base)) base += "/v1"
    const model =
      pick(
        "OPENAI_MODEL",
        "CODEX_MODEL",
        "LLM_MODEL",
        "KIMI_MODEL",
        "OPENCLAW_MODEL",
      ) || (hasKimi ? "kimi-k2.6" : "gpt-4o-mini")
    const { status, text } = await httpRequestJson(
      `${base}/chat/completions`,
      "POST",
      { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: "user", content: "Say hi in 5 words." }],
      }),
    )
    if (status >= 400)
      return { success: false, error: `HTTP ${status}: ${text.slice(0, 200)}` }
    let reply = "",
      used = model
    try {
      const p = JSON.parse(text)
      reply = p?.choices?.[0]?.message?.content || ""
      used = p?.model || model
    } catch {}
    return { success: true, model: used, response: reply.slice(0, 80) }
  } catch (e) {
    return { success: false, error: (e as Error)?.message || "Request failed" }
  }
}

function normalizeWorkspaceEndpoint(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const raw = value.trim()
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    if (url.hostname === "workspace.openagents.org") {
      return url.origin.replace("workspace.openagents.org", "workspace-endpoint.openagents.org")
    }
    return url.origin
  } catch {
    return undefined
  }
}

/**
 * True when an Anthropic base URL points at Anthropic's own API (not a
 * third-party relay/proxy). The official endpoint authenticates with the API
 * key via the `x-api-key` header; everything else is treated as a relay that
 * wants `Authorization: Bearer` (see normalizeEnvForSave). An unparseable value
 * is treated as NON-official so we don't accidentally suppress the relay path.
 */
function isOfficialAnthropicBase(base: string): boolean {
  try {
    const h = new URL(base).hostname.toLowerCase()
    return h === "anthropic.com" || h.endsWith(".anthropic.com")
  } catch {
    return false
  }
}

/**
 * Normalize provider base URLs before they're persisted to env, so what we
 * SAVE matches what we TEST (testLLMConnection). The mismatch this guards
 * against: a user pastes an Anthropic-compatible relay URL that already ends
 * in `/v1` (e.g. https://relay.example/v1). The connection test strips the
 * trailing `/v1` before probing `${base}/v1/messages`, so it passes — but the
 * spawned `claude` CLI appends `/v1/messages` to the raw value, hitting
 * `…/v1/v1/messages` → 404, which the CLI mis-reports as "model not found".
 *
 * Anthropic's SDK owns the `/v1` segment, so the base must NOT carry it. We do
 * NOT touch OpenAI-style bases (OPENAI_BASE_URL etc.) — those are SUPPOSED to
 * include `/v1` (the defaults do), and the OpenAI client appends only the
 * sub-path. Gemini already tolerates either form in its REST path builder.
 */
function normalizeEnvForSave(
  env: Record<string, string>,
): Record<string, string> {
  const out = { ...env }
  const anthropicBase = out.ANTHROPIC_BASE_URL
  if (typeof anthropicBase === "string" && anthropicBase.trim()) {
    out.ANTHROPIC_BASE_URL = anthropicBase
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/v1$/, "")
  }

  // Route Claude through Bearer auth on third-party relays. The Claude CLI
  // sends ANTHROPIC_API_KEY as the `x-api-key` header, but most Anthropic-
  // compatible relays/proxies — the usual reason a custom ANTHROPIC_BASE_URL is
  // set — only honor `Authorization: Bearer`. With just the API key those relays
  // reject every request as 401 "invalid token / 无效的令牌", which is exactly the
  // failure seen creating a workspace through such a relay. ANTHROPIC_AUTH_TOKEN
  // is sent as Bearer and, per Claude Code's auth precedence, outranks the API
  // key, so mirroring the key into it makes the CLI authenticate the way relays
  // expect. The daemon passes this env straight through to the spawned CLI, so
  // the fix works without changing the installed core. We do this ONLY for a
  // non-official base; for api.anthropic.com x-api-key is correct, so any stale
  // token from a previous relay save is cleared (saving "" drops the line) to
  // stop it overriding the API key.
  const anthropicKey = (out.ANTHROPIC_API_KEY || "").trim()
  const resolvedBase = (out.ANTHROPIC_BASE_URL || "").trim()
  if (anthropicKey && resolvedBase) {
    if (isOfficialAnthropicBase(resolvedBase)) {
      out.ANTHROPIC_AUTH_TOKEN = ""
    } else if (!(out.ANTHROPIC_AUTH_TOKEN || "").trim()) {
      out.ANTHROPIC_AUTH_TOKEN = anthropicKey
    }
  }

  return out
}

export interface InstalledAgentRecord {
  name: string
  version: string | null
  installedAt: string
  previousVersion?: string | null
  history?: Array<{ version: string; installedAt: string }>
}

// ── Chat types (Stage 3.1) ──

export interface ChatToolCall {
  id: string
  name: string
  category?:
    | "workspace"
    | "files"
    | "browser"
    | "tunnel"
    | "todos"
    | "timers"
    | "terminal"
    | "other"
  status: "pending" | "success" | "error"
  args?: unknown
  result?: unknown
  durationMs?: number
}

export interface ChatAttachment {
  fileId?: string
  filename?: string
  contentType?: string
  size?: number
  url?: string
}

export interface ChatMessage {
  messageId: string
  sessionId: string
  senderType: "human" | "agent" | "system"
  senderName: string
  content: string
  mentions?: string[]
  messageType?: string
  metadata?: Record<string, unknown>
  attachments?: ChatAttachment[]
  createdAt?: string
  toolCalls?: ChatToolCall[]
}

export interface ChatSessionMeta {
  id: string
  workspaceId: string
  workspaceSlug?: string
  workspaceName?: string
  channelName: string
  title: string
  lastMessageAt: string | null
  lastMessagePreview: string | null
  messageCount: number
  participants: string[]
  createdAt: string
}

export interface SendMessageInput {
  workspaceId: string
  channelName?: string
  agentId?: string
  content: string
  mentions?: string[]
  attachments?: ChatAttachment[]
}

export interface SendMessageResult {
  success: boolean
  messageId: string
  error?: string
}

export type ChatStreamEvent =
  | {
      type: "message"
      channel: string
      workspaceId: string
      message: ChatMessage
    }
  | {
      type: "agent-status"
      channel: string
      workspaceId: string
      agentName: string
      status: "thinking" | "idle" | "error"
      detail?: string
    }
  | { type: "error"; channel: string; workspaceId: string; error: string }

interface WorkspaceConfig {
  id: string
  slug: string
  name?: string
  endpoint?: string
  token: string
}

interface ChatPollingState {
  workspaceId: string
  channelName: string
  token: string
  cursor: string | null
  seenIds: Set<string>
  timer: NodeJS.Timeout | null
  refs: number
  inFlight: boolean
  workspace: WorkspaceConfig
}

function ensureDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
}

function sessionFilePath(workspaceId: string, channelName: string): string {
  return path.join(LAUNCHER_SESSIONS_DIR, workspaceId, `${channelName}.json`)
}

function classifyTool(name: string): ChatToolCall["category"] {
  const n = (name || "").toLowerCase()
  if (n.includes("browser")) return "browser"
  if (n.includes("file")) return "files"
  if (n.includes("tunnel")) return "tunnel"
  if (n.includes("todo")) return "todos"
  if (n.includes("timer")) return "timers"
  if (
    n.includes("shell") ||
    n.includes("exec") ||
    n.includes("terminal") ||
    n.includes("bash")
  )
    return "terminal"
  if (n.includes("workspace")) return "workspace"
  return "other"
}

// The agent adapters (see agent-connector/src/adapters/utils.js
// formatAttachmentsForPrompt) read attachments in camelCase — they look up
// att.fileId, att.contentType. The workspace API stores attachments verbatim
// and replays them through _eventToMessage. So we MUST send camelCase end to
// end. Snake_case here would land in the agent prompt as an empty file_id,
// which is the literal bug the user reported.
function attachmentsToServer(
  attachments?: ChatAttachment[],
): unknown[] | undefined {
  if (!attachments || attachments.length === 0) return undefined
  return attachments.map((a) => {
    const out: Record<string, unknown> = {}
    if (a.fileId) out.fileId = a.fileId
    if (a.filename) out.filename = a.filename
    if (a.contentType) out.contentType = a.contentType
    if (typeof a.size === "number") out.size = a.size
    if (a.url) out.url = a.url
    return out
  })
}

// Defensive: tolerate either casing on the way in (older messages, future
// schema changes) and normalize to camelCase for the renderer.
function attachmentsFromServer(raw: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  return raw.map((entry) => {
    const e = (entry || {}) as Record<string, unknown>
    return {
      fileId:
        (e.fileId as string) ||
        (e.file_id as string) ||
        (e.id as string) ||
        undefined,
      filename: (e.filename as string) || (e.name as string) || undefined,
      contentType:
        (e.contentType as string) || (e.content_type as string) || undefined,
      size: typeof e.size === "number" ? e.size : undefined,
      url: (e.url as string) || undefined,
    }
  })
}

function normalizeIncomingMessage(m: ChatMessage): ChatMessage {
  return {
    ...m,
    attachments: m.attachments
      ? attachmentsFromServer(m.attachments)
      : undefined,
    toolCalls: extractToolCalls(m),
  }
}

function extractToolCalls(msg: ChatMessage): ChatToolCall[] | undefined {
  const meta = (msg.metadata || {}) as Record<string, unknown>
  const raw =
    (meta.tool_calls as unknown[] | undefined) ||
    (meta.toolCalls as unknown[] | undefined) ||
    undefined
  if (!Array.isArray(raw) || raw.length === 0) return undefined

  return raw.map((entry, i) => {
    const e = (entry || {}) as Record<string, unknown>
    const name = (e.name as string) || (e.tool as string) || `tool_${i}`
    const status =
      (e.status as ChatToolCall["status"]) ||
      (e.error ? "error" : e.result !== undefined ? "success" : "pending")
    return {
      id: (e.id as string) || `${msg.messageId}:${i}`,
      name,
      category: classifyTool(name),
      status,
      args: e.args ?? e.arguments,
      result: e.result ?? e.error,
      durationMs:
        typeof e.duration_ms === "number"
          ? e.duration_ms
          : typeof e.durationMs === "number"
            ? e.durationMs
            : undefined,
    }
  })
}

export function extractMentions(text: string): string[] {
  const out: string[] = []
  const re = /(^|\s)@([a-zA-Z0-9_-]+)/g
  let match = re.exec(text)
  while (match !== null) {
    if (!out.includes(match[2])) out.push(match[2])
    match = re.exec(text)
  }
  return out
}

interface NpmRegistryInfo {
  "dist-tags"?: { latest?: string }
  versions?: Record<string, unknown>
  time?: Record<string, string>
  homepage?: string
}

function loadCore(): Record<string, unknown> | null {
  if (fs.existsSync(path.join(LOCAL_CORE, "package.json"))) {
    try {
      return require(LOCAL_CORE)
    } catch (e) {
      console.error("Failed to load local core:", e)
    }
  }
  if (fs.existsSync(path.join(GLOBAL_CORE, "package.json"))) {
    try {
      return require(GLOBAL_CORE)
    } catch {}
  }
  try {
    return require("@openagents-org/agent-launcher")
  } catch {}
  return null
}

function appendDaemonLog(message: string): void {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    fs.appendFileSync(
      DAEMON_LOG_FILE,
      `[${new Date().toISOString()}] launcher: ${message}\n`,
      "utf-8",
    )
  } catch {}
}

function isPidAlive(pid: number | null): boolean {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e: unknown) {
    return (e as NodeJS.ErrnoException).code === "EPERM"
  }
}

/**
 * Smoke-test a node binary by running `--version`. Returns false if the
 * binary is missing, blocked by Defender/SmartScreen, has an arch mismatch,
 * or any other CreateProcess failure. Used to avoid spawning the daemon with
 * a bundled node.exe that Windows refuses to load — which would otherwise
 * leave the daemon perpetually offline.
 */
function canExecuteNode(binaryPath: string): boolean {
  try {
    const r = spawnSync(binaryPath, ["--version"], {
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    return r.status === 0 && !r.error
  } catch {
    return false
  }
}

/**
 * Resolve a working node binary, preferring the bundled portable runtime
 * when it actually launches, otherwise falling back to a system `node` on
 * PATH. Returns null if nothing works.
 */
function resolveWorkingNode(
  portableNodeDir: string,
  enhancedPath: string,
): string | null {
  const candidates = [
    path.join(
      portableNodeDir,
      "node" + (process.platform === "win32" ? ".exe" : ""),
    ),
    path.join(portableNodeDir, "bin", "node"),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c) && canExecuteNode(c)) return c
  }
  // Bundled node missing or won't run — try the system one.
  try {
    const which = process.platform === "win32" ? "where" : "which"
    const out = require("child_process").execFileSync(which, ["node"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      windowsHide: true,
      env: withPathEnv(enhancedPath),
    }) as string
    for (const line of out
      .split(/\r?\n/)
      .map((s: string) => s.trim())
      .filter(Boolean)) {
      if (canExecuteNode(line)) return line
    }
  } catch {}
  return null
}

/**
 * Resolve how to invoke npm for an install. Prefers running the bundled
 * `node` binary directly against `npm-cli.js` (argv passed array-style, no
 * shell) — on Windows that goes through CreateProcessW as UTF-16, so a home
 * dir with non-ASCII characters (e.g. `C:\Users\用户名\...`) is preserved
 * exactly. The legacy path (spawning `npm.cmd` via `shell:true`) instead
 * relied on a hand-written .cmd batch shim whose UTF-8 bytes cmd.exe decodes
 * with the OEM code page (936/GBK on zh-CN), corrupting the embedded node
 * path and silently breaking every install. We only fall back to that legacy
 * shell path when the bundled node / npm-cli layout is missing, so the common
 * (ASCII) case still works identically.
 */
function resolveNpmInvocation(): {
  cmd: string
  preArgs: string[]
  useShell: boolean
} {
  const portableNodeDir = path.join(os.homedir(), ".openagents", "nodejs")
  const exists = (p: string): boolean => {
    try {
      return fs.existsSync(p)
    } catch {
      return false
    }
  }
  const nodeBin = [
    path.join(
      portableNodeDir,
      process.platform === "win32" ? "node.exe" : "node",
    ),
    path.join(portableNodeDir, "bin", "node"),
  ].find(exists)
  if (nodeBin) {
    const npmCli = [
      path.join(portableNodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
      path.join(
        portableNodeDir,
        "lib",
        "node_modules",
        "npm",
        "bin",
        "npm-cli.js",
      ),
    ].find(exists)
    if (npmCli) return { cmd: nodeBin, preArgs: [npmCli], useShell: false }
  }
  // Bundled node/npm-cli not found — preserve legacy behaviour exactly.
  return {
    cmd: process.platform === "win32" ? "npm.cmd" : "npm",
    preArgs: [],
    useShell: true,
  }
}

let core: Record<string, unknown> | null = loadCore()

export class AgentManager extends EventEmitter {
  private _store: LauncherSettingsStore
  private _healthByType = new Map<string, unknown>()
  private _healthRefreshInFlight = new Set<string>()
  private _lastHealthRefreshAt = 0
  private _healthQueue: string[] = []
  private _healthProcessing = false
  // Cached sign-in state for hosted-login agents (e.g. Cursor), keyed by type.
  // value: true = signed in, false = signed out, null = unknown (probe failed /
  // timed out → treated optimistically). Probing spawns the CLI's `status`, so
  // we cache for 30s and only re-probe off the hot getAgents path.
  private _hostedLoginAuth = new Map<
    string,
    { value: boolean | null; at: number }
  >()
  // In-flight `status` probes, so concurrent callers share one CLI spawn.
  private _hostedLoginProbe = new Map<string, Promise<boolean | null>>()
  private _agentsCache: { value: unknown[]; at: number } = { value: [], at: 0 }
  private _catalogCache: {
    value: unknown[] | null
    at: number
    inFlight: Promise<unknown[]> | null
  } = {
    value: null,
    at: 0,
    inFlight: null,
  }
  private _updatesCache: {
    value: Array<{
      name: string
      current: string | null
      latest: string | null
    }>
    at: number
    inFlight: Promise<
      Array<{ name: string; current: string | null; latest: string | null }>
    > | null
  } = {
    value: [],
    at: 0,
    inFlight: null,
  }
  private _statusCache: { value: unknown; at: number } = { value: {}, at: 0 }
  private _chatPolls = new Map<string, ChatPollingState>()
  _connector: Record<string, unknown> | null = null

  constructor(store: LauncherSettingsStore) {
    super()
    this._store = store
    if (!core) core = loadCore()
    if (core) {
      this._connector = this.createConnector()
    }
    ensureDir(LAUNCHER_SESSIONS_DIR)
  }

  private createConnector(): Record<string, unknown> {
    const AgentConnector = (core as Record<string, unknown>)
      .AgentConnector as new (opts: unknown) => Record<string, unknown>
    const workspaceEndpoint = normalizeWorkspaceEndpoint(
      this._store.get("workspaceEndpoint"),
    )
    return new AgentConnector({
      configDir: CONFIG_DIR,
      ...(workspaceEndpoint ? { workspaceEndpoint } : {}),
    })
  }

  private configuredWorkspaceEndpoint(): string | undefined {
    return normalizeWorkspaceEndpoint(this._store.get("workspaceEndpoint"))
  }

  getSupportedAgentTypes(): string[] {
    const supported = (core as Record<string, unknown> | null)?.adapters
      ? Object.keys(
          (
            (core as Record<string, unknown>).adapters as Record<
              string,
              unknown
            >
          ).ADAPTER_MAP as Record<string, unknown>,
        )
      : []
    return (supported as string[]).sort()
  }

  getCoreInfo(): unknown {
    return {
      version: this.coreVersion,
      supportedTypes: this.getSupportedAgentTypes(),
      globalCorePath: GLOBAL_CORE,
      globalCorePresent: fs.existsSync(path.join(GLOBAL_CORE, "package.json")),
    }
  }

  reloadCore(): boolean {
    const cacheKeys = Object.keys(require.cache).filter(
      (k) => k.includes("agent-launcher") || k.includes("agent-connector"),
    )
    for (const k of cacheKeys) delete require.cache[k]
    core = loadCore()
    if (core) {
      this._connector = this.createConnector()
    }
    this.clearCatalogCache()
    this._agentsCache = { value: [], at: 0 }
    this._healthByType.clear()
    return !!core
  }

  get coreVersion(): string | null {
    try {
      const pkg = path.join(LOCAL_CORE, "package.json")
      if (fs.existsSync(pkg))
        return JSON.parse(fs.readFileSync(pkg, "utf-8")).version
    } catch {}
    try {
      const pkg = path.join(GLOBAL_CORE, "package.json")
      if (fs.existsSync(pkg))
        return JSON.parse(fs.readFileSync(pkg, "utf-8")).version
    } catch {}
    try {
      return require("@openagents-org/agent-launcher/package.json").version
    } catch {}
    return null
  }

  private _ensureConnector(): void {
    if (!this._connector) {
      if (!this.reloadCore()) {
        throw new Error(
          "Core library not installed. Install an agent first via the Install tab.",
        )
      }
    }
  }

  getAgents(): unknown[] {
    const now = Date.now()
    if (
      this._agentsCache.value.length > 0 &&
      now - this._agentsCache.at < 1500
    ) {
      return this._agentsCache.value
    }
    if (!this._connector) return []
    const listAgents = this._connector.listAgents as () => unknown[]
    const agents = listAgents.call(this._connector)
    const status = this.getAllStatus() as Record<
      string,
      { state?: string; restarts?: number; last_error?: string }
    >
    this._scheduleHealthRefresh(
      agents as Array<{ type?: string; name: string }>,
    )

    const supportedTypes = new Set(this.getSupportedAgentTypes())
    const value = (agents as Array<Record<string, unknown>>).map((a) => {
      const type = (a.type as string) || "openclaw"
      const runtimeMismatch = !supportedTypes.has(type)
      const runtimeMessage = runtimeMismatch
        ? `Agent runtime '${type}' is not available in the currently loaded core. Update Launcher and restart it.`
        : null
      const statusEntry = status[a.name as string]
      const statusError = statusEntry?.last_error || null
      return {
        ...a,
        state: statusEntry?.state || "stopped",
        restarts: statusEntry?.restarts || 0,
        lastError: statusError || runtimeMessage,
        health: this._reconcileAgentHealth(
          type,
          a.env as Record<string, string> | undefined,
          this._healthByType.get(type) || null,
        ),
        runtimeMismatch,
      }
    })
    this._agentsCache = { value, at: now }
    return value
  }

  private _scheduleHealthRefresh(
    agents: Array<{ type?: string; name: string }>,
  ): void {
    const now = Date.now()
    if (now - this._lastHealthRefreshAt < 30_000) return
    this._lastHealthRefreshAt = now

    const types = [...new Set((agents || []).map((a) => a.type || "openclaw"))]
    for (const type of types) {
      if (this._healthRefreshInFlight.has(type)) continue
      if (this._healthQueue.includes(type)) continue
      this._healthRefreshInFlight.add(type)
      this._healthQueue.push(type)
    }
    this._processHealthQueue()
  }

  private _processHealthQueue(): void {
    if (this._healthProcessing) return
    this._healthProcessing = true
    const tick = (): void => {
      const type = this._healthQueue.shift()
      if (!type) {
        this._healthProcessing = false
        return
      }
      setTimeout(() => {
        try {
          // Hosted-login agents derive readiness from the CLI's `status`, not
          // the core's check_ready (which has no login rule). Compute it here,
          // in the 30s refresh, so the per-call getAgents path never spawns.
          if (HOSTED_LOGIN_AGENTS[type]) {
            this._healthByType.set(type, this._hostedLoginHealth(type))
          } else {
            const healthCheck = this._connector?.healthCheck as
              | ((type: string) => unknown)
              | undefined
            const health = healthCheck
              ? healthCheck.call(this._connector, type)
              : null
            this._healthByType.set(type, health)
          }
        } catch {
          this._healthByType.set(type, null)
        } finally {
          this._healthRefreshInFlight.delete(type)
        }
        setTimeout(tick, 250)
      }, 0)
    }
    tick()
  }

  /**
   * Correct a false "Not installed" from the core health check.
   *
   * The core resolves an agent's binary with `which`/`where` against PATH, but
   * agents the launcher installs live in isolated runtimes
   * (~/.openagents/runtimes/<type>/node_modules/.bin) that are NOT on the user's
   * PATH. So a freshly-installed agent can report `installed:false` ("Not
   * installed") from the health check even though the marketplace — which uses a
   * filesystem package.json check (getInstallInfo) — correctly shows it
   * installed. That mismatch surfaced in the Agents list as a confusing
   * "⚠ Not installed" badge on a working agent. Trust the filesystem: if the npm
   * package is present on disk, mark it installed and re-derive readiness from
   * saved credentials so the label reflects configuration, not binary lookup.
   */
  private _reconcileHealth(type: string, health: unknown): unknown {
    if (!health || typeof health !== "object") return health
    const h = health as Record<string, unknown>
    if (h.installed !== false) return health
    // Only override when the launcher can independently confirm the install via
    // the filesystem. api_only agents (no npm package) are already handled
    // correctly by the core via its marker check, so getInstalledVersion being
    // null there means "leave the core's verdict alone".
    if (!this.getInstalledVersion(type)) return health
    const ready = this._hasConfiguredCredentials(type)
    return {
      ...h,
      installed: true,
      ready,
      auth_mode: ready ? "api_key" : null,
      execution_mode: ready ? h.execution_mode || "direct" : "unavailable",
      message: ready ? "Ready" : this._notReadyMessage(type),
    }
  }

  /**
   * Per-agent health, fixing two false negatives in the core's per-TYPE check:
   *  1. "Not installed" — the core resolves binaries with `which`, which misses
   *     isolated-runtime installs (handled by _reconcileHealth via filesystem).
   *  2. "Not configured" — the core evaluates readiness against TYPE-level saved
   *     env (~/.openagents/env/<type>.env) ONLY. But Configure on an existing
   *     agent saves INSTANCE env into daemon.yaml (saveAgentInstanceEnv), so a
   *     fully-configured agent (valid key/base/model, Test connection passes)
   *     still shows "Not configured". Trust the instance's own env here.
   */
  private _reconcileAgentHealth(
    type: string,
    instanceEnv: Record<string, string> | undefined,
    typeHealth: unknown,
  ): unknown {
    // Hosted-login agents (e.g. Cursor, Hermes) sign in through their own CLI,
    // not an API key the launcher collects. Readiness = installed + signed in
    // (or, where the CLI accepts one, an API key set in env). A power user who
    // set CURSOR_API_KEY skips the browser login, so honor that before login.
    const hostedLogin = HOSTED_LOGIN_AGENTS[type]
    if (hostedLogin) {
      const hasApiKey =
        !!(
          hostedLogin.apiKeyEnv &&
          (instanceEnv?.[hostedLogin.apiKeyEnv] || "").trim()
        ) || this._hasConfiguredCredentials(type)
      if (this._isInstalled(type) && hasApiKey) {
        return {
          installed: true,
          ready: true,
          auth_mode: "api_key",
          execution_mode: "direct",
          message: "Ready",
        }
      }
      // Prefer the cached login-aware health from the 30s refresh. Until it
      // populates, return an optimistic install-only verdict rather than probing
      // `status` here — getAgents runs every ~1.5s and must not spawn the CLI.
      if (typeHealth && typeof typeHealth === "object") return typeHealth
      return this._isInstalled(type)
        ? {
            installed: true,
            ready: true,
            auth_mode: "cli_login",
            execution_mode: "subprocess",
            message: "Ready",
          }
        : {
            installed: false,
            ready: false,
            auth_mode: null,
            execution_mode: "unavailable",
            message: this._notReadyMessage(type),
          }
    }
    const health = this._reconcileHealth(type, typeHealth)
    const hasCreds =
      this._envHasApiKey(instanceEnv) || this._hasConfiguredCredentials(type)
    // The type-level health is populated asynchronously (see
    // _scheduleHealthRefresh), so right after onboarding it is still null. Don't
    // fall back to a misleading "Not configured" when the agent actually has a
    // saved API key — synthesize a ready status from the configured credentials.
    if (!health || typeof health !== "object") {
      if (hasCreds) {
        return {
          installed: true,
          ready: true,
          auth_mode: "api_key",
          execution_mode: "direct",
          message: "Ready",
        }
      }
      return health
    }
    const h = health as Record<string, unknown>
    if (h.installed === false || h.ready === true) return health
    if (hasCreds) {
      return {
        ...h,
        installed: true,
        ready: true,
        auth_mode: "api_key",
        execution_mode:
          h.execution_mode && h.execution_mode !== "unavailable"
            ? h.execution_mode
            : "direct",
        message: "Ready",
      }
    }
    return health
  }

  /**
   * Health for hosted-login agents (e.g. Cursor). Install is confirmed with the
   * connector's isInstalled — the same check the marketplace's "Installed" badge
   * uses, so the two views never disagree. Readiness then follows the CLI's own
   * sign-in state (its `status` command): signed in ⇒ Ready; signed out ⇒ a
   * clear "click Login" hint rather than a misleading "Ready"; unknown (probe
   * failed/timed out) ⇒ optimistic Ready so a working agent is never blocked.
   */
  private _hostedLoginHealth(type: string): Record<string, unknown> {
    if (!this._isInstalled(type)) {
      return {
        installed: false,
        ready: false,
        auth_mode: null,
        execution_mode: "unavailable",
        message: this._notReadyMessage(type),
      }
    }
    if (this._hostedLoginIsAuthed(type) === false) {
      return {
        installed: true,
        ready: false,
        auth_mode: null,
        execution_mode: "unavailable",
        message: "Not signed in — open Configure and click Login",
      }
    }
    return {
      installed: true,
      ready: true,
      auth_mode: "cli_login",
      execution_mode: "subprocess",
      message: "Ready",
    }
  }

  /** Install check matching the marketplace's "Installed" badge (getInstallInfo). */
  private _isInstalled(type: string): boolean {
    try {
      const isInstalled = this._connector?.isInstalled as
        | ((t: string) => boolean)
        | undefined
      return !!isInstalled?.call(this._connector, type)
    } catch {
      return false
    }
  }

  /**
   * Cached sign-in state for a hosted-login agent: true (signed in) / false
   * (signed out) / null (unknown — never probed, or the probe couldn't decide).
   * NON-BLOCKING: returns the cache immediately and kicks off a background probe
   * when the cache is stale (>30s). The CLI's `status` can take seconds (Hermes
   * ~2.5s), so it must never run on a sync path. The Configure dialog uses the
   * awaitable refreshHostedLogin() instead when it needs a guaranteed-fresh read.
   */
  private _hostedLoginIsAuthed(type: string): boolean | null {
    const spec = HOSTED_LOGIN_AGENTS[type]
    if (!spec) return null
    const cached = this._hostedLoginAuth.get(type)
    const fresh = !!cached && Date.now() - cached.at < 30_000
    if (!fresh) void this._probeHostedLogin(type)
    return cached ? cached.value : null
  }

  /**
   * Resolve an agent type's CLI to an ABSOLUTE binary path (via the core's
   * `installer.which`, which searches the enhanced PATH incl. the Cursor/Hermes
   * native install dirs). Returns null when the binary can't be located.
   */
  resolveBinary(type: string): string | null {
    try {
      const installer = this._connector?.installer as
        | Record<string, unknown>
        | undefined
      const which = installer?.which as
        | ((t: string) => string | null)
        | undefined
      return which?.call(installer, type) || null
    } catch {
      return null
    }
  }

  /**
   * Rewrite a hosted-login command (e.g. "cursor-agent login", "hermes setup")
   * so its leading binary token becomes the resolved ABSOLUTE path. This is the
   * fix for the Windows "'cursor-agent' is not recognized as an internal or
   * external command" failure: the native installer drops the CLI under
   * %LOCALAPPDATA%\cursor-agent and only edits the *registry* PATH, which a
   * freshly-spawned login terminal inherits stale — so a bare `cursor-agent
   * login` dies. Resolving to an absolute path makes the login PATH-independent.
   * Returns the original command unchanged when it isn't a known hosted-login
   * binary or the binary can't be resolved (callers still inject PATH as a
   * fallback). The returned binary path is quoted so spaces in the home dir
   * (e.g. C:\Users\First Last\...) survive.
   */
  resolveLoginCommand(cmd: string): string {
    if (!cmd || !cmd.trim()) return cmd
    const trimmed = cmd.trim()
    // First whitespace-delimited token, with any surrounding quotes stripped.
    const m = trimmed.match(/^("[^"]*"|'[^']*'|\S+)(\s+[\s\S]*)?$/)
    if (!m) return cmd
    const rawFirst = m[1].replace(/^["']|["']$/g, "")
    const rest = m[2] || ""
    // Map the CLI binary name to its agent type so we can resolve via the core.
    const base = rawFirst
      .replace(/\.(exe|cmd|ps1|bat)$/i, "")
      .split(/[\\/]/)
      .pop()
    const BINARY_TO_TYPE: Record<string, string> = {
      "cursor-agent": "cursor",
      agent: "cursor",
      hermes: "hermes",
    }
    const type = base ? BINARY_TO_TYPE[base] : undefined
    if (!type) return cmd
    const abs = this.resolveBinary(type)
    if (!abs) return cmd
    return `"${abs}"${rest}`
  }

  /**
   * Run a FRESH sign-in probe for a hosted-login agent and resolve its health.
   * Awaitable — the Configure dialog calls this after the user confirms they
   * completed the terminal login, so the result reflects reality rather than an
   * optimistic guess.
   */
  async refreshHostedLogin(type: string): Promise<unknown> {
    if (!HOSTED_LOGIN_AGENTS[type]) return this.healthCheck(type)
    await this._probeHostedLogin(type, true)
    return this._hostedLoginHealth(type)
  }

  /**
   * Spawn the hosted-login CLI's `status` asynchronously and cache the parsed
   * sign-in state. Deduped per type (concurrent callers share one probe) and
   * throttled (no re-spawn within 2s unless `force`d) so polling can't pile up
   * CLI processes. On completion it refreshes the cached type health and busts
   * the agents cache so the Agents list picks up the new state.
   */
  private _probeHostedLogin(type: string, force = false): Promise<boolean | null> {
    const spec = HOSTED_LOGIN_AGENTS[type]
    if (!spec) return Promise.resolve(null)
    const inflight = this._hostedLoginProbe.get(type)
    if (inflight) return inflight
    const cached = this._hostedLoginAuth.get(type)
    if (!force && cached && Date.now() - cached.at < 2_000) {
      return Promise.resolve(cached.value)
    }
    const p = this._runHostedLoginProbe(type, spec)
    this._hostedLoginProbe.set(type, p)
    void p.finally(() => this._hostedLoginProbe.delete(type))
    return p
  }

  private _runHostedLoginProbe(
    type: string,
    spec: HostedLoginSpec,
  ): Promise<boolean | null> {
    return new Promise((resolve) => {
      let bin: string | null = null
      try {
        const installer = this._connector?.installer as
          | Record<string, unknown>
          | undefined
        const which = installer?.which as
          | ((t: string) => string | null)
          | undefined
        bin = which?.call(installer, type) || null
      } catch {}

      const settle = (value: boolean | null): void => {
        this._hostedLoginAuth.set(type, { value, at: Date.now() })
        // Cache is fresh now, so this re-derive won't re-probe. Refresh the type
        // health + bust the agents cache so the list reflects the new state.
        this._healthByType.set(type, this._hostedLoginHealth(type))
        this._agentsCache = { value: [], at: 0 }
        resolve(value)
      }

      if (!bin) {
        settle(null)
        return
      }
      try {
        const child = spawn(bin, spec.statusArgs, {
          stdio: ["ignore", "pipe", "pipe"],
        })
        let out = ""
        let settled = false
        const finish = (value: boolean | null): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          settle(value)
        }
        const timer = setTimeout(() => {
          try {
            child.kill()
          } catch {}
          finish(null)
        }, 8000)
        child.stdout?.on("data", (c: Buffer) => (out += c.toString("utf-8")))
        child.stderr?.on("data", (c: Buffer) => (out += c.toString("utf-8")))
        child.on("error", () => finish(null))
        child.on("close", (code) => {
          // Decide via whichever direction the spec declares. A clean run with
          // output but no match is "definitive" → the opposite of the pattern;
          // anything else stays null (unknown) so a hiccup never reads as out.
          const definitive = !!out.trim() && code === 0
          let value: boolean | null = null
          if (spec.loggedInPattern) {
            value = spec.loggedInPattern.test(out)
              ? true
              : definitive
                ? false
                : null
          } else if (spec.loggedOutPattern) {
            value = spec.loggedOutPattern.test(out)
              ? false
              : definitive
                ? true
                : null
          }
          finish(value)
        })
      } catch {
        settle(null)
      }
    })
  }

  /**
   * Clear a hosted-login agent's stale env (e.g. CURSOR_API_KEY, CURSOR_MODEL)
   * from both the type-level and instance env. Cursor's CLI prefers an explicit
   * key/model over its own browser-login session and account defaults, so values
   * left over from the old setup wizard (an invalid key, a bogus model like
   * "gpt-5.4") make the agent fail — "API key is invalid" — even after a
   * successful `cursor-agent login`. When the user signs in via the browser flow
   * we wipe them so the login session + account defaults are what get used.
   * Saving an empty value removes the line (env.save filters out empties).
   */
  clearHostedLoginApiKey(type: string, agentName?: string): void {
    const keys = HOSTED_LOGIN_AGENTS[type]?.loginClearsEnv
    if (!keys?.length) return
    try {
      const typeEnv = (this.getAgentEnv(type) as Record<string, string>) || {}
      const drop = keys.filter((k) => (typeEnv[k] || "").trim())
      if (drop.length)
        this.saveAgentEnv(type, Object.fromEntries(drop.map((k) => [k, ""])))
    } catch {}
    if (agentName) {
      try {
        const instEnv =
          (this.getAgentInstanceEnv(agentName) as Record<string, string>) || {}
        const drop = keys.filter((k) => (instEnv[k] || "").trim())
        if (drop.length)
          this.saveAgentInstanceEnv(
            agentName,
            Object.fromEntries(drop.map((k) => [k, ""])),
          )
      } catch {}
    }
    this._agentsCache = { value: [], at: 0 }
  }

  /** True when an env map carries any non-empty API key (e.g. *_API_KEY). */
  private _envHasApiKey(env: Record<string, string> | undefined): boolean {
    if (!env || typeof env !== "object") return false
    return Object.entries(env).some(
      ([k, v]) => /API_KEY$/.test(k) && !!(v || "").trim(),
    )
  }

  /** True when saved TYPE-level env for this agent carries any non-empty key. */
  private _hasConfiguredCredentials(type: string): boolean {
    try {
      return this._envHasApiKey(
        this.getAgentEnv(type) as Record<string, string> | undefined,
      )
    } catch {
      return false
    }
  }

  /** Registry's not-ready hint for an agent type, with a sensible fallback. */
  private _notReadyMessage(type: string): string {
    try {
      const entry = this._getRegistryEntry(type)
      const checkReady = entry?.check_ready as
        | { not_ready_message?: string }
        | undefined
      if (checkReady?.not_ready_message) return checkReady.not_ready_message
    } catch {}
    return "Not configured — add an API key in Configure"
  }

  async addAgent(agentConfig: {
    name: string
    type?: string
    path?: string
    env?: Record<string, string>
  }): Promise<unknown> {
    const name = agentConfig.name
    const type = agentConfig.type || "openclaw"
    const supportedTypes = this.getSupportedAgentTypes()

    if (supportedTypes.length > 0 && !supportedTypes.includes(type)) {
      throw new Error(
        `Agent type '${type}' is not supported. Supported: ${supportedTypes.join(", ")}`,
      )
    }

    const addAgent = this._connector!.addAgent as (opts: unknown) => void
    addAgent.call(this._connector, {
      name,
      type,
      role: "worker",
      path: agentConfig.path,
      env: agentConfig.env,
    })
    // Bust the 1.5s agents cache so the renderer's immediate post-mutation
    // refresh() returns fresh data instead of the stale pre-add list.
    this._agentsCache = { value: [], at: 0 }
    return { success: true, agent: agentConfig }
  }

  async removeAgent(name: string): Promise<unknown> {
    try {
      await this.stopAgent(name)
    } catch {}
    const removeAgent = this._connector!.removeAgent as (name: string) => void
    removeAgent.call(this._connector, name)
    // See addAgent: bust the cache so the deleted agent doesn't linger.
    this._agentsCache = { value: [], at: 0 }
    return { success: true }
  }

  async updateAgent(
    name: string,
    updates: { env?: Record<string, string> },
  ): Promise<unknown> {
    if (updates.env) {
      const saveEnv = this._connector!.saveAgentInstanceEnv as (
        name: string,
        env: unknown,
      ) => void
      saveEnv.call(this._connector, name, normalizeEnvForSave(updates.env))
    }
    this._agentsCache = { value: [], at: 0 }
    return { success: true }
  }

  clearCatalogCache(): void {
    this._catalogCache = { value: null, at: 0, inFlight: null }
    this._updatesCache = { value: [], at: 0, inFlight: null }
    try {
      const clearCache = this._connector?.clearCatalogCache as
        | (() => void)
        | undefined
      clearCache?.call(this._connector)
    } catch {}
  }

  async getCatalog(force = false): Promise<unknown[]> {
    const now = Date.now()
    const ttl = process.platform === "win32" ? 60_000 : 10_000
    // Empty arrays must NOT count as a valid cached value — otherwise a
    // transient miss (connector not loaded yet, network blocked, etc) gets
    // pinned for the full TTL and onboarding shows "no agents" until the
    // user restarts. Treat non-empty cached entries as fresh; empty ones
    // always re-fetch.
    const cached = this._catalogCache.value
    const haveFresh =
      Array.isArray(cached) &&
      cached.length > 0 &&
      now - this._catalogCache.at < ttl
    if (!force && haveFresh) return cached as unknown[]
    if (!force && this._catalogCache.inFlight)
      return this._catalogCache.inFlight

    const load = this._loadCatalog()
      .then((catalog) => {
        const value =
          Array.isArray(catalog) && catalog.length > 0
            ? catalog
            : this._fallbackCatalog()
        this._catalogCache = {
          value,
          // Pin the cache only when we got a real catalog. A fallback result
          // (connector still warming up) should keep retrying so the UI
          // updates as soon as the connector recovers.
          at: value === catalog ? Date.now() : 0,
          inFlight: null,
        }
        return value
      })
      .catch(() => {
        this._catalogCache.inFlight = null
        // Surface a fallback rather than a rejection — onboarding's IPC
        // handler swallows errors silently and would otherwise leave the
        // picker permanently empty.
        return this._fallbackCatalog()
      })
    this._catalogCache.inFlight = load
    return load
  }

  /**
   * Bundled fallback when the connector hasn't loaded yet. Annotates each
   * entry with `installed: false` so the UI treats them as "needs install".
   */
  private _fallbackCatalog(): unknown[] {
    const entries = Array.isArray(BUNDLED_REGISTRY)
      ? (BUNDLED_REGISTRY as Array<Record<string, unknown>>)
      : []
    return entries.map((e) => {
      const spec = HOSTED_LOGIN_AGENTS[e.name as string]
      const check_ready = spec
        ? {
            ...((e.check_ready as Record<string, unknown>) || {}),
            login_command: spec.loginCommand,
          }
        : e.check_ready
      return {
        ...e,
        check_ready,
        installed: false,
        managed: false,
        location: null,
      }
    })
  }

  private async _loadCatalog(): Promise<unknown[]> {
    if (!this._connector) return []
    let catalog: unknown[]
    try {
      const getCatalog = this._connector.getCatalog as () => Promise<unknown[]>
      catalog = await getCatalog.call(this._connector)
    } catch {
      try {
        const registry = this._connector.registry as Record<string, unknown>
        const getCatalogSync = registry.getCatalogSync as () => unknown[]
        const installer = this._connector.installer as Record<string, unknown>
        const getInstallInfo = installer.getInstallInfo as (name: string) => {
          installed: boolean
          managed?: boolean
          location?: string
        }
        catalog = getCatalogSync.call(registry).map((e) => {
          const entry = e as Record<string, unknown>
          const info = getInstallInfo.call(installer, entry.name as string)
          return {
            ...entry,
            installed: info.installed,
            managed: info.managed,
            location: info.location,
          }
        })
      } catch {
        return []
      }
    }
    try {
      const registry = this._connector.registry as Record<string, unknown>
      const loadBundled = registry._loadBundled as () => unknown[]
      const bundled = loadBundled.call(registry)
      for (const entry of catalog) {
        const e = entry as Record<string, unknown>
        const b = (bundled as Array<Record<string, unknown>>).find(
          (x) => x.name === e.name,
        )
        if (b) {
          if (!e.check_ready && b.check_ready) e.check_ready = b.check_ready
          if (
            (!e.env_config || !(e.env_config as unknown[]).length) &&
            (b.env_config as unknown[] | undefined)?.length
          )
            e.env_config = b.env_config
          if (b.install) e.install = { ...b.install }
          if (!e.launch && b.launch) e.launch = b.launch
        }
      }
    } catch {}
    // Launcher-side login wiring for hosted-login agents (e.g. Cursor): the
    // shared registry has no login_command for these, so expose the CLI's own
    // sign-in here. This makes the Configure dialog render its "Login" flow
    // (open a terminal running `cursor-agent login`) instead of falling back to
    // "No configuration required". Kept in launcher code so the shared registry
    // stays untouched — same rationale as LAUNCHER_AUTH_OVERRIDES.
    for (const entry of catalog) {
      const e = entry as Record<string, unknown>
      const spec = HOSTED_LOGIN_AGENTS[e.name as string]
      if (!spec) continue
      const checkReady = (e.check_ready as Record<string, unknown>) || {}
      e.check_ready = { ...checkReady, login_command: spec.loginCommand }
    }
    // Stamp the supported-core flag + display order. Non-core agents become
    // "coming soon" (the UI sinks + disables them); core agents carry the
    // product-defined order from CORE_AGENTS.
    for (const entry of catalog) {
      const e = entry as Record<string, unknown>
      const idx = CORE_AGENT_ORDER.get(e.name as string)
      e.comingSoon = idx === undefined
      e.coreOrder = idx ?? 999
    }
    return catalog
  }

  async getEnvFields(agentType: string): Promise<unknown[]> {
    // Launcher-side override is authoritative. Agents like claude/gemini ship
    // in the shared registry with an EMPTY env_config (they default to a
    // terminal login), but the launcher authenticates them with an API key /
    // base URL entered in-app. Returning the override fields here makes those
    // inputs appear everywhere env is edited — onboarding AND the Install
    // detail page — and stay editable after the agent is configured (otherwise
    // the detail page hides the setup wizard once an instance exists yet has no
    // inline fields to show, leaving no way to change the key/base URL).
    // Hosted-login agents (e.g. Cursor) sign in through their own service —
    // there are no launcher-collected keys to show and nothing to test.
    // Returning [] makes every env-editing surface (post-install wizard, the
    // Configure dialog) skip the API-key / "Test connection" step entirely.
    // See HOSTED_LOGIN_AGENTS.
    if (HOSTED_LOGIN_AGENTS[agentType]) return []

    const override = LAUNCHER_AUTH_OVERRIDES[agentType]
    if (override) return override

    // Mirror getCatalog's bundled fallback: when the agent-launcher core
    // hasn't installed yet, _ensureConnector throws ("Core library not
    // installed"). Without a fallback that rejection bubbles up to the
    // onboarding Step 2 Promise.all, which then collapses every agent to the
    // default mode:"none" — so the "Configure agent" step shows "no
    // configuration needed" for codex/kimi/etc that actually require API keys.
    // Fall back to the inlined registry so env fields are always available.
    try {
      this._ensureConnector()
      const getEnvFields = this._connector!.getEnvFields as (
        type: string,
      ) => unknown[]
      const fields = getEnvFields.call(this._connector, agentType)
      if (Array.isArray(fields)) return fields
    } catch {
      // fall through to bundled fallback
    }
    return this._fallbackEnvFields(agentType)
  }

  /**
   * env_config from the bundled registry for a single agent. Used when the
   * connector isn't loaded yet so onboarding's API-key step still renders the
   * right fields. Mirrors _fallbackCatalog.
   */
  private _fallbackEnvFields(agentType: string): unknown[] {
    const entries = Array.isArray(BUNDLED_REGISTRY)
      ? (BUNDLED_REGISTRY as Array<Record<string, unknown>>)
      : []
    const entry = entries.find((e) => e.name === agentType)
    const env = entry?.env_config
    return Array.isArray(env) ? env : []
  }

  getAgentEnv(agentType: string): unknown {
    const getAgentEnv = this._connector!.getAgentEnv as (
      type: string,
    ) => unknown
    return getAgentEnv.call(this._connector, agentType)
  }

  getAgentInstanceEnv(agentName: string): unknown {
    const getInstanceEnv = this._connector!.getAgentInstanceEnv as (
      name: string,
    ) => unknown
    return getInstanceEnv.call(this._connector, agentName)
  }

  deleteAgentEnv(agentType: string): unknown {
    const deleteEnv = this._connector!.deleteAgentEnv as (
      type: string,
    ) => unknown
    return deleteEnv.call(this._connector, agentType)
  }

  saveAgentEnv(agentType: string, env: Record<string, string>): unknown {
    env = normalizeEnvForSave(env)
    const saveEnv = this._connector!.saveAgentEnv as (
      type: string,
      env: unknown,
    ) => void
    saveEnv.call(this._connector, agentType, env)

    try {
      if (agentType === "openclaw") {
        const OpenClawAdapter = require("@openagents-org/agent-launcher/src/adapters/openclaw")
        OpenClawAdapter.configureNativeAuth(env)
      }
    } catch {}

    this.signalReload()
    return { success: true }
  }

  saveAgentInstanceEnv(
    agentName: string,
    env: Record<string, string>,
  ): unknown {
    env = normalizeEnvForSave(env)
    const saveEnv = this._connector!.saveAgentInstanceEnv as (
      name: string,
      env: unknown,
    ) => void
    saveEnv.call(this._connector, agentName, env)
    this.signalReload()
    return { success: true }
  }

  async testLLM(env: Record<string, string>): Promise<LLMTestResult> {
    // Run the test in-launcher rather than delegating to the installed core's
    // testLLM: the core that ships on a user's machine is often older and only
    // probes the OpenAI-compatible path, so Claude/Gemini keys come back as
    // "No API key provided". testLLMConnection covers every provider and works
    // even before the core is installed.
    return testLLMConnection(env)
  }

  signalReload(): void {
    const getDaemonPid = this._connector!.getDaemonPid as () => number | null
    const pid = getDaemonPid.call(this._connector)
    if (!pid) return

    if (process.platform === "win32") {
      const sendCmd = this._connector!.sendDaemonCommand as (
        cmd: string,
      ) => void
      sendCmd.call(this._connector, "reload")
    } else {
      try {
        process.kill(pid, "SIGHUP")
      } catch {}
    }
  }

  getNetworks(): unknown[] {
    const listWorkspaces = this._connector!.listWorkspaces as () => unknown[]
    return listWorkspaces.call(this._connector)
  }

  async createWorkspace(name: string): Promise<unknown> {
    const createWorkspace = this._connector!.createWorkspace as (
      opts: unknown,
    ) => Promise<unknown>
    return createWorkspace.call(this._connector, {
      name: name || "My Workspace",
    })
  }

  private parseCustomWorkspaceUrl(
    urlStr: string,
  ): { endpoint?: string; slug?: string; token?: string } | null {
    try {
      const u = new URL(urlStr.trim())
      if (u.protocol !== "http:" && u.protocol !== "https:") return null
      const host = u.hostname.toLowerCase()
      if (host === "workspace.openagents.org") {
        return null
      }
      const endpoint = u.origin
      const slug = u.pathname.replace(/^\//, "").split("/")[0] || undefined
      const token = u.searchParams.get("token") || undefined
      return { endpoint, slug, token }
    } catch {
      return null
    }
  }

  async registerWorkspaceFromToken(input: {
    url?: string
    token?: string
    slug?: string
  }): Promise<{
    id?: string
    slug?: string
    name?: string
    endpoint?: string
    token?: string
  }> {
    const tokenOrSlug = (input.token || input.slug || input.url || "").trim()
    if (!tokenOrSlug) throw new Error("Missing workspace URL or token")

    const customParsed = input.url ? this.parseCustomWorkspaceUrl(input.url) : null
    if (customParsed) {
      const slug = input.slug || customParsed.slug
      const token = input.token || customParsed.token
      if (!slug)
        throw new Error(
          "Custom workspace URL must include slug (first path segment) or provide slug explicitly",
        )
      if (!token)
        throw new Error(
          "Custom workspace URL must include token query parameter or provide token explicitly",
        )

      const config = this._connector!.config as Record<string, unknown>
      const addNetwork = config.addNetwork as (opts: unknown) => unknown
      addNetwork.call(config, {
        id: slug,
        slug,
        name: slug,
        endpoint: customParsed.endpoint,
        token,
      })
      this.signalReload()
      return {
        id: slug,
        slug,
        name: slug,
        endpoint: customParsed.endpoint,
        token,
      }
    }

    const resolveToken = this._connector!.resolveToken as (
      token: string,
    ) => Promise<{
      slug?: string
      workspace_id?: string
      name?: string
      endpoint?: string
    }>
    const info = await resolveToken.call(this._connector, tokenOrSlug)
    const slug = info.slug || info.workspace_id || input.slug
    if (!slug) throw new Error("Could not resolve workspace from input")
    const endpoint = info.endpoint || this.configuredWorkspaceEndpoint()

    const config = this._connector!.config as Record<string, unknown>
    const addNetwork = config.addNetwork as (opts: unknown) => unknown
    addNetwork.call(config, {
      id: info.workspace_id || slug,
      slug,
      name: info.name || slug,
      endpoint,
      token: input.token || tokenOrSlug,
    })
    this.signalReload()
    return {
      id: info.workspace_id || slug,
      slug,
      name: info.name || slug,
      endpoint,
      token: input.token || tokenOrSlug,
    }
  }

  async connectWorkspace(
    agentName: string,
    tokenOrSlug: string,
  ): Promise<unknown> {
    try {
      const resolveToken = this._connector!.resolveToken as (
        token: string,
      ) => Promise<{
        slug?: string
        workspace_id?: string
        name?: string
        endpoint?: string
      }>
      const info = await resolveToken.call(this._connector, tokenOrSlug)
      const slug = info.slug || info.workspace_id
      const wsName = info.name || slug
      const endpoint = info.endpoint || this.configuredWorkspaceEndpoint()

      const addNetwork = (this._connector!.config as Record<string, unknown>)
        .addNetwork as (opts: unknown) => void
      addNetwork.call(this._connector!.config as Record<string, unknown>, {
        id: info.workspace_id || slug,
        slug,
        name: wsName,
        endpoint,
        token: tokenOrSlug,
      })

      const connectWorkspace = this._connector!.connectWorkspace as (
        name: string,
        slug: string,
      ) => void
      connectWorkspace.call(this._connector, agentName, slug as string)
    } catch (err) {
      const networks = this.getNetworks() as Array<{ id?: string; slug?: string }>
      const existing = networks.some(
        (network) => network.slug === tokenOrSlug || network.id === tokenOrSlug,
      )
      if (!existing) throw err

      const connectWorkspace = this._connector!.connectWorkspace as (
        name: string,
        slug: string,
      ) => void
      connectWorkspace.call(this._connector, agentName, tokenOrSlug)
    }
    this.signalReload()
    return { success: true }
  }

  async disconnectWorkspace(agentName: string): Promise<unknown> {
    const disconnectWorkspace = this._connector!.disconnectWorkspace as (
      name: string,
    ) => void
    disconnectWorkspace.call(this._connector, agentName)
    this.signalReload()
    return { success: true }
  }

  async removeWorkspace(slug: string): Promise<unknown> {
    const removeWorkspace = this._connector!.removeWorkspace as (
      slug: string,
    ) => Promise<unknown>
    const result = await removeWorkspace.call(this._connector, slug)
    this.signalReload()
    return result
  }

  // ─── Onboarding ───────────────────────────────────────────────
  //
  // The onboarding flow used to drive provisioning from the renderer with three
  // separate IPC calls (createWorkspace → addAgent → connectWorkspace) and
  // swallowed errors. That was the source of the "Agent 'x-1' not found" toast:
  // the picker offered agents the loaded core couldn't run, addAgent threw
  // "not supported", the renderer ate the error, and the follow-up bind failed
  // because the agent was never persisted. The two methods below replace that
  // with a runnable-only picker and a single atomic, verified provisioning step.

  /**
   * Agents to offer in onboarding. Returns ONLY types the loaded core can
   * actually run (intersection with ADAPTER_MAP) and resolves each agent's auth
   * requirements from the bundled registry first (authoritative), then the live
   * catalog. Returns [] when the core hasn't finished installing yet so the
   * renderer keeps polling instead of rendering a wrong empty/again state.
   */
  async getOnboardingAgents(): Promise<OnboardingAgent[]> {
    const supported = this.getSupportedAgentTypes()
    if (supported.length === 0) return []

    let catalog: Array<Record<string, unknown>> = []
    try {
      catalog = (await this.getCatalog(false)) as Array<Record<string, unknown>>
    } catch {
      // Marketplace metadata is optional — we can still build from the bundle.
    }
    const catalogByName = new Map(
      catalog.map((c) => [c.name as string, c] as const),
    )
    const bundled = Array.isArray(BUNDLED_REGISTRY)
      ? (BUNDLED_REGISTRY as Array<Record<string, unknown>>)
      : []
    const bundledByName = new Map(
      bundled.map((b) => [b.name as string, b] as const),
    )

    const result: OnboardingAgent[] = supported
      .filter((type) => CORE_AGENTS.includes(type) && !ONBOARDING_HIDDEN.has(type))
      .map((type) => {
      const cat = catalogByName.get(type)
      const reg = bundledByName.get(type)
      const regEnv = (reg?.env_config as Array<Record<string, unknown>>) || []
      const catEnv = (cat?.env_config as Array<Record<string, unknown>>) || []
      const checkReady = (reg?.check_ready ||
        cat?.check_ready ||
        {}) as {
        login_command?: string
        not_ready_message?: string
        prefer_login?: boolean
      }
      // Launcher-side override: agents that should authenticate with a
      // key/base-URL entered in onboarding rather than an external terminal
      // login. Forces "env" mode and hides the login command, without touching
      // the shared registry. See LAUNCHER_AUTH_OVERRIDES.
      const override = LAUNCHER_AUTH_OVERRIDES[type]
      // Hosted-login agents (e.g. Cursor) sign in through their own service —
      // no key fields, drive the CLI's login instead. See HOSTED_LOGIN_AGENTS.
      const hostedLogin = HOSTED_LOGIN_AGENTS[type]
      const envFields = hostedLogin
        ? []
        : override || (regEnv.length > 0 ? regEnv : catEnv)
      const loginCommand = hostedLogin
        ? hostedLogin.loginCommand
        : override
          ? null
          : checkReady.login_command || null
      // `prefer_login` keeps an agent on the CLI-login path as PRIMARY even when
      // it also exposes (optional) env fields. Without it, any env field would
      // force "env" mode.
      const preferLogin = !!checkReady.prefer_login && !!loginCommand
      const authMode: OnboardingAgent["authMode"] = preferLogin
        ? "login"
        : envFields.length > 0
          ? "env"
          : loginCommand
            ? "login"
            : "none"
      return {
        name: type,
        label:
          (cat?.label as string) || (reg?.label as string) || type,
        description:
          (cat?.description as string) ||
          (reg?.description as string) ||
          "",
        featured: !!(cat?.featured ?? reg?.featured),
        order: (cat?.order as number) ?? (reg?.order as number) ?? 99,
        installed: !!cat?.installed,
        authMode,
        loginCommand,
        envFields,
        docsUrl:
          (cat?.homepage as string) ||
          (cat?.docs as string) ||
          (reg?.homepage as string) ||
          null,
        notReadyMessage: checkReady.not_ready_message || null,
      }
    })

    result.sort((a, b) => {
      if ((b.featured ? 1 : 0) !== (a.featured ? 1 : 0))
        return (b.featured ? 1 : 0) - (a.featured ? 1 : 0)
      return a.order - b.order
    })
    return result
  }

  /**
   * Atomically provision the onboarding agent and (optionally) a workspace.
   * Ordering and verification live here in the main process so failures surface
   * as precise errors instead of a misleading "not found" downstream:
   *   1. validate the type is runnable
   *   2. ensure the agent instance exists in daemon.yaml (idempotent) + verify
   *   3. if a workspace name is given, create it, persist the network locally,
   *      and bind the agent by SLUG. This step is best-effort: the agent is
   *      already usable, so a workspace-service failure returns a warning
   *      rather than aborting onboarding.
   */
  async provisionFirstAgent(opts: {
    agentType: string
    agentName: string
    workspaceName?: string | null
  }): Promise<{
    agentName: string
    workspaceSlug: string | null
    workspaceName: string | null
    warning: string | null
  }> {
    this._ensureConnector()
    const type = (opts.agentType || "").trim()
    const name = (opts.agentName || "").trim()
    if (!type) throw new Error("No agent type was selected")
    if (!name) throw new Error("Missing agent name")

    const supported = this.getSupportedAgentTypes()
    if (supported.length > 0 && !supported.includes(type)) {
      throw new Error(
        `Agent type '${type}' isn't supported by the installed runtime. ` +
          `Update the Launcher and try again.`,
      )
    }

    // 1 + 2. Ensure the agent exists, idempotently, then verify it persisted.
    const listAgents = this._connector!.listAgents as () => Array<{
      name: string
    }>
    const agentExists = (): boolean =>
      (listAgents.call(this._connector) || []).some((a) => a.name === name)

    if (!agentExists()) {
      const addAgent = this._connector!.addAgent as (o: unknown) => void
      addAgent.call(this._connector, { name, type, role: "worker" })
      this._agentsCache = { value: [], at: 0 }
    }
    if (!agentExists()) {
      throw new Error(
        `Failed to register agent '${name}' — the runtime did not persist it.`,
      )
    }

    // 3. Optional workspace — best-effort.
    const wsName = (opts.workspaceName || "").trim()
    if (!wsName) {
      this.signalReload()
      return {
        agentName: name,
        workspaceSlug: null,
        workspaceName: null,
        warning: null,
      }
    }

    try {
      const createWorkspace = this._connector!.createWorkspace as (
        o: unknown,
      ) => Promise<{
        slug?: string
        token?: string
        id?: string
        name?: string
        endpoint?: string
      }>
      const ws = await createWorkspace.call(this._connector, { name: wsName })
      const slug = ws?.slug
      if (!slug) throw new Error("workspace service returned no slug")

      // Persist the network locally so the Workspaces tab is populated and the
      // agent can resolve it without another round-trip.
      const config = this._connector!.config as Record<string, unknown>
      const addNetwork = config.addNetwork as (o: unknown) => void
      addNetwork.call(config, {
        // The workspace service may return only a slug (no id). Persisting
        // id: null makes the daemon adapter join a null network → every
        // poll/heartbeat fails "Network not found". Fall back to the slug,
        // which is the server's canonical workspace identifier.
        id: ws.id || slug,
        slug,
        name: ws.name || wsName,
        endpoint: ws.endpoint || this.configuredWorkspaceEndpoint(),
        token: ws.token,
      })

      // Bind by slug (NOT token). The agent is verified above, so the core's
      // setAgentNetwork lookup-by-name can't miss.
      const connect = this._connector!.connectWorkspace as (
        n: string,
        s: string,
      ) => void
      connect.call(this._connector, name, slug)
      this.signalReload()
      return {
        agentName: name,
        workspaceSlug: slug,
        workspaceName: ws.name || wsName,
        warning: null,
      }
    } catch (e) {
      this.signalReload()
      return {
        agentName: name,
        workspaceSlug: null,
        workspaceName: null,
        warning: `Agent is ready, but workspace setup failed: ${
          (e as Error).message
        }. You can create one later from the Workspaces tab.`,
      }
    }
  }

  async checkAgentType(agentType: string): Promise<unknown> {
    const isInstalled = this._connector!.isInstalled as (
      type: string,
    ) => boolean
    const installed = isInstalled.call(this._connector, agentType)
    const installer = this._connector!.installer as Record<string, unknown>
    const which = installer.which as (type: string) => string | null
    const binary = installed ? which.call(installer, agentType) : null
    return { installed, binary: binary || null }
  }

  async installAgentType(agentType: string): Promise<unknown> {
    const install = this._connector!.install as (
      type: string,
    ) => Promise<unknown>
    const result = await install.call(this._connector, agentType)
    this._recordInstall(agentType)
    this.clearCatalogCache()
    return result
  }

  async installAgentTypeStreaming(
    agentType: string,
    onData: (data: string) => void,
  ): Promise<unknown> {
    const installer = this._connector!.installer as Record<string, unknown>
    const installStreaming = installer.installStreaming as (
      type: string,
      onData: (data: string) => void,
    ) => Promise<unknown>
    const result = await installStreaming.call(installer, agentType, onData)
    this._recordInstall(agentType)
    this.clearCatalogCache()
    return result
  }

  async uninstallAgentType(agentType: string): Promise<unknown> {
    const uninstall = this._connector!.uninstall as (
      type: string,
    ) => Promise<unknown>
    const result = await uninstall.call(this._connector, agentType)
    this._recordUninstall(agentType)
    this.clearCatalogCache()
    return result
  }

  async uninstallAgentTypeStreaming(
    agentType: string,
    onData: (data: string) => void,
  ): Promise<unknown> {
    const installer = this._connector!.installer as Record<string, unknown>
    const uninstallStreaming = installer.uninstallStreaming as (
      type: string,
      onData: (data: string) => void,
    ) => Promise<unknown>
    const result = await uninstallStreaming.call(installer, agentType, onData)
    this._recordUninstall(agentType)
    this.clearCatalogCache()
    return result
  }

  /** Read installed package version by inspecting runtime prefix package.json. */
  getInstalledVersion(agentType: string): string | null {
    try {
      const entry = this._getRegistryEntry(agentType)
      const npmPkg = this._resolveNpmPackage(entry)
      if (!npmPkg) return null
      const candidates = [
        path.join(
          CONFIG_DIR,
          "runtimes",
          agentType,
          "node_modules",
          npmPkg,
          "package.json",
        ),
        path.join(CONFIG_DIR, "nodejs", "node_modules", npmPkg, "package.json"),
      ]
      for (const c of candidates) {
        try {
          if (fs.existsSync(c)) {
            const pkg = JSON.parse(fs.readFileSync(c, "utf-8"))
            if (pkg?.version) return pkg.version
          }
        } catch {}
      }
    } catch {}
    return null
  }

  private _getRegistryEntry(agentType: string): Record<string, unknown> | null {
    try {
      const registry = this._connector?.registry as
        | Record<string, unknown>
        | undefined
      if (!registry) return null
      const getEntry = registry.getEntry as ((t: string) => unknown) | undefined
      const entry = getEntry
        ? (getEntry.call(registry, agentType) as Record<string, unknown> | null)
        : null
      return entry || null
    } catch {
      return null
    }
  }

  private _resolveNpmPackage(
    entry: Record<string, unknown> | null,
  ): string | null {
    if (!entry) return null
    const install = entry.install as Record<string, unknown> | undefined
    if (!install) return null
    if (install.npm_package) return install.npm_package as string
    const cmd = (install[Installer.platformKey()] || install.command || install.npm) as
      | string
      | undefined
    if (!cmd) return install.binary as string | null
    const m = cmd.match(
      /npm install\s+(?:-g\s+)?(@?[\w-]+(?:\/[\w-]+)?)(?:@\S*)?$/,
    )
    if (m) return m[1]
    return (install.binary as string | undefined) || null
  }

  getInstalledHistory(): Record<string, InstalledAgentRecord> {
    try {
      if (fs.existsSync(INSTALLED_HISTORY_FILE)) {
        const data = JSON.parse(
          fs.readFileSync(INSTALLED_HISTORY_FILE, "utf-8"),
        )
        if (data && typeof data === "object") return data
      }
    } catch {}
    return {}
  }

  private _writeInstalledHistory(
    data: Record<string, InstalledAgentRecord>,
  ): void {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
      fs.writeFileSync(
        INSTALLED_HISTORY_FILE,
        JSON.stringify(data, null, 2),
        "utf-8",
      )
    } catch {}
  }

  private _recordInstall(agentType: string): void {
    try {
      const data = this.getInstalledHistory()
      const version = this.getInstalledVersion(agentType)
      const prev = data[agentType]
      const history = prev?.history ? [...prev.history] : []
      const versionChanged = !!(
        prev?.version &&
        version &&
        prev.version !== version
      )
      if (versionChanged) {
        history.unshift({
          version: prev.version!,
          installedAt: prev.installedAt,
        })
      }
      // Only carry a previousVersion when the install actually changed the
      // version. A reinstall / repair that lands on the same version must NOT
      // record `previousVersion = currentVersion` — that self-referential
      // pointer lights up `canRollback` and points `rollbackAgentType` at the
      // same version we're already on. End result before this fix: a
      // permanent "Roll back" button that no-op reinstalls the current
      // version forever.
      const nextPreviousVersion = versionChanged
        ? prev!.version
        : prev?.previousVersion && prev.previousVersion !== version
          ? prev.previousVersion
          : null
      data[agentType] = {
        name: agentType,
        version,
        installedAt: new Date().toISOString(),
        previousVersion: nextPreviousVersion,
        history: history.slice(0, 10),
      }
      this._writeInstalledHistory(data)
    } catch {}
  }

  private _recordUninstall(agentType: string): void {
    try {
      const data = this.getInstalledHistory()
      if (data[agentType]) {
        delete data[agentType]
        this._writeInstalledHistory(data)
      }
    } catch {}
  }

  listInstalledAgents(): InstalledAgentRecord[] {
    const data = this.getInstalledHistory()
    const out: InstalledAgentRecord[] = []
    for (const name of Object.keys(data)) {
      const r = data[name]
      const version = r.version || this.getInstalledVersion(name)
      // Auto-heal self-referential previousVersion / history entries written
      // by the pre-fix _recordInstall code. Without this scrub, machines
      // upgraded from the buggy version keep seeing the Roll back button
      // even though the only "previous" pointer points at themselves.
      const cleanHistory = (r.history || []).filter(
        (h) => h.version && h.version !== version,
      )
      const cleanPrev =
        r.previousVersion && r.previousVersion !== version
          ? r.previousVersion
          : null
      out.push({
        ...r,
        version,
        history: cleanHistory,
        previousVersion: cleanPrev,
      })
    }
    return out
  }

  /**
   * Install an npm-backed agent at an arbitrary version specifier (semver
   * version, dist-tag, or anything `npm install pkg@<spec>` accepts).
   * Powers both rollback (previous version) and update-channel installs
   * (stage.md §2.5 — Beta / Nightly).
   */
  async _installAtVersionTag(
    agentType: string,
    target: string,
    onData: (data: string) => void,
  ): Promise<{ success: boolean; version: string | null; error?: string }> {
    const entry = this._getRegistryEntry(agentType)
    const npmPkg = this._resolveNpmPackage(entry)
    if (!npmPkg)
      return {
        success: false,
        version: null,
        error: "Cannot determine npm package",
      }

    const { spawn } = require("child_process") as typeof import("child_process")
    const prefixDir = path.join(CONFIG_DIR, "runtimes", agentType)
    fs.mkdirSync(prefixDir, { recursive: true })
    const args = [
      "install",
      "--save",
      "--prefix",
      prefixDir,
      `${npmPkg}@${target}`,
    ]

    // Invoke bundled `node npm-cli.js` directly (no shell) so non-ASCII home
    // paths survive on Windows; see resolveNpmInvocation().
    const inv = resolveNpmInvocation()
    const portableNodeDir = path.join(os.homedir(), ".openagents", "nodejs")
    if (onData) onData(`$ npm ${args.join(" ")}\n\n`)

    return new Promise((resolve) => {
      const proc = spawn(inv.cmd, [...inv.preArgs, ...args], {
        shell: inv.useShell,
        cwd: prefixDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: withPathEnv(portableNodeDir + path.delimiter + readPathEnv()),
        windowsHide: true,
      })
      proc.stdout?.setEncoding("utf-8")
      proc.stderr?.setEncoding("utf-8")
      proc.stdout?.on("data", (d) => onData && onData(d))
      proc.stderr?.on("data", (d) => onData && onData(d))
      proc.on("error", (err) =>
        resolve({ success: false, version: null, error: err.message }),
      )
      proc.on("close", (code) => {
        if (code === 0) {
          this._recordInstall(agentType)
          this.clearCatalogCache()
          // Read what actually landed — for dist-tags the resolved version
          // can differ from the input string ("beta" → "2.1.144-beta.3").
          const resolved = this.getInstalledVersion(agentType) || target
          if (onData) onData(`\nInstalled ${npmPkg}@${resolved}.\n`)
          resolve({ success: true, version: resolved })
        } else {
          resolve({
            success: false,
            version: null,
            error: `Install failed with code ${code}`,
          })
        }
      })
    })
  }

  /**
   * Wrapper that exposes the version-tag installer to the install IPC.
   * Used by the AgentDetail update channel selector (stable / beta / nightly).
   */
  async installAgentTypeAtVersionStreaming(
    agentType: string,
    target: string,
    onData: (data: string) => void,
  ): Promise<{ success: boolean; version: string | null; error?: string }> {
    return this._installAtVersionTag(agentType, target, onData)
  }

  async rollbackAgentType(
    agentType: string,
    onData: (data: string) => void,
  ): Promise<{ success: boolean; version: string | null; error?: string }> {
    const data = this.getInstalledHistory()
    const record = data[agentType]
    const current = record?.version || this.getInstalledVersion(agentType)
    // Resolve the first history / previousVersion entry that is *different*
    // from the version currently on disk. Without this filter a stale
    // previousVersion pointer (pre-fix history records carrying
    // previousVersion === currentVersion) makes rollback re-install the
    // same version and the UI keep offering Roll back forever.
    const candidates = [
      ...(record?.history || []).map((h) => h.version),
      record?.previousVersion || null,
    ].filter((v): v is string => !!v && v !== current)
    const target = candidates[0]
    if (!target)
      return {
        success: false,
        version: null,
        error: "No previous version to roll back to",
      }

    // Delegate to the shared install-at-version pipeline so rollback and
    // channel switching share the same npm spawn + history recording path.
    return this._installAtVersionTag(agentType, target, onData)
  }

  async checkAgentUpdates(
    options: { force?: boolean } = {},
  ): Promise<
    Array<{ name: string; current: string | null; latest: string | null }>
  > {
    const now = Date.now()
    const ttl = 60 * 60 * 1000
    // Cache hit ONLY when the renderer didn't ask for a forced refresh,
    // the cache holds something useful, and the entry is still inside the
    // TTL. The previous implementation had this inverted: `!options.force`
    // returned the cache unconditionally, even after `clearCatalogCache()`
    // had reset it to `[]` — so the detail page silently lost the
    // "Update to v…" button immediately after a rollback / install /
    // uninstall, until the hourly background refresh re-populated the
    // cache.
    const cacheFresh =
      this._updatesCache.value.length > 0 && now - this._updatesCache.at < ttl
    if (!options.force && cacheFresh) {
      return this._updatesCache.value
    }

    if (this._updatesCache.inFlight) return this._updatesCache.inFlight
    this._updatesCache.inFlight = this._loadAgentUpdates()
      .then((updates) => {
        this._updatesCache = { value: updates, at: Date.now(), inFlight: null }
        return updates
      })
      .catch((err) => {
        this._updatesCache.inFlight = null
        throw err
      })
    return this._updatesCache.inFlight
  }

  private async _loadAgentUpdates(): Promise<
    Array<{ name: string; current: string | null; latest: string | null }>
  > {
    // Use the full catalog (every entry with installed=true), not just the
    // history file — agents installed globally / pre-launcher won't be in
    // the history but are still installed and worth checking for updates.
    const catalog = (await this.getCatalog()) as Array<Record<string, unknown>>
    const installedEntries = catalog.filter((e) => e.installed === true)
    const historyByName = new Map(
      this.listInstalledAgents().map((r) => [r.name, r.version]),
    )

    const results = await Promise.all(
      installedEntries.map(async (entry) => {
        const name = entry.name as string
        const npmPkg = this._resolveNpmPackage(entry)
        const current =
          historyByName.get(name) || this.getInstalledVersion(name)
        if (!npmPkg) return { name, current, latest: null }
        const info = await fetchNpmInfo(npmPkg).catch(() => null)
        return { name, current, latest: resolveLatestVersion(info) }
      }),
    )
    return results
  }

  async getAgentChangelog(
    agentType: string,
  ): Promise<{
    versions: Array<{ version: string; date?: string }>
    homepage?: string
    latest?: string | null
    error?: string
  }> {
    const entry = this._getRegistryEntry(agentType)
    const homepage = (entry?.homepage as string | undefined) || undefined
    const npmPkg = this._resolveNpmPackage(entry)
    if (!npmPkg)
      return { versions: [], homepage, latest: null, error: "No npm package" }
    try {
      const info = await fetchNpmInfo(npmPkg)
      const time = info.time || {}
      // Show pre-releases in the changelog list (useful for visibility), but
      // return `latest` as the stable dist-tag so the detail page's
      // "Update to vX" computation matches what `npm install` actually fetches.
      const versions = sortedPublishedVersions(info, {
        includePreRelease: true,
      })
        .slice(0, 12)
        .map((v) => ({ version: v, date: time[v] }))
      return { versions, homepage, latest: resolveLatestVersion(info) }
    } catch (e: unknown) {
      return {
        versions: [],
        homepage,
        latest: null,
        error: (e as Error).message,
      }
    }
  }

  async startAgent(name: string): Promise<unknown> {
    const ready = await this._ensureDaemon()
    if (!ready)
      throw new Error(
        "Daemon failed to start. Check the Logs page for details.",
      )
    const sendCmd = this._connector!.sendDaemonCommand as (cmd: string) => void
    sendCmd.call(this._connector, `start:${name}`)
    // Bust the 1s status cache so the next poll from the renderer sees the
    // daemon's freshly written 'starting' state instead of stale 'stopped'.
    this._statusCache = { value: {}, at: 0 }
    return { success: true, message: `Start command sent for ${name}` }
  }

  async stopAgent(name: string): Promise<unknown> {
    const pid = this._getLiveDaemonPid()
    if (!pid) return { success: true, message: "Daemon not running" }
    const sendCmd = this._connector!.sendDaemonCommand as (cmd: string) => void
    sendCmd.call(this._connector, `stop:${name}`)
    this._statusCache = { value: {}, at: 0 }
    return { success: true, message: `Stop command sent for ${name}` }
  }

  async startAll(): Promise<unknown> {
    const ready = await this._ensureDaemon()
    if (!ready)
      throw new Error(
        "Daemon failed to start. Check the Logs page for details.",
      )
    const sendCmd = this._connector!.sendDaemonCommand as (cmd: string) => void
    sendCmd.call(this._connector, "reload")
    return { success: true, message: "Start all command sent" }
  }

  async stopAll(): Promise<unknown> {
    const stopDaemon = this._connector!.stopDaemon as () => boolean
    const stopped = stopDaemon.call(this._connector)
    return {
      success: stopped,
      message: stopped ? "Daemon stopped" : "Daemon not running",
    }
  }

  async _ensureDaemon(): Promise<boolean> {
    const pid = this._getLiveDaemonPid()
    if (pid) return true

    const result = await this._startDaemon()
    if (!result.success) appendDaemonLog(result.message)
    return !!(result.success && result.pid)
  }

  getAllStatus(): unknown {
    const now = Date.now()
    if (this._statusCache.value && now - this._statusCache.at < 1000) {
      return this._statusCache.value
    }
    let value: unknown = {}
    if (this._getLiveDaemonPid()) {
      const getDaemonStatus = this._connector!.getDaemonStatus as () => unknown
      try {
        value = getDaemonStatus.call(this._connector)
      } catch {
        value = {}
      }
    }
    this._statusCache = { value, at: now }
    return value
  }

  getLogs(name: string, lines = 200): unknown {
    const getLogs = this._connector!.getLogs as (
      name: string,
      lines: number,
    ) => string[]
    const logLines = getLogs.call(this._connector, name, lines)
    return { lines: logLines }
  }

  tailLogs(name: string, lines = 200, offset = 0): unknown {
    const config = this._connector!.config as Record<string, unknown>
    const tailLogs = config.tailLogs as (opts: unknown) => unknown
    return tailLogs.call(config, { agent: name || undefined, lines, offset })
  }

  clearLogsInRange(
    start: string | number | Date,
    end: string | number | Date,
  ): unknown {
    const startTime = normalizeTimeValue(start)
    const endTime = normalizeTimeValue(end)

    if (!startTime || !endTime) {
      throw new Error("Start time and end time are required")
    }
    if (startTime.getTime() > endTime.getTime()) {
      throw new Error("Start time must be before end time")
    }

    const logFile = path.join(CONFIG_DIR, "daemon.log")
    if (!fs.existsSync(logFile)) return { removed: 0, remaining: 0 }

    const content = fs.readFileSync(logFile, "utf-8")
    const hasTrailingNewline = content.endsWith("\n")
    const allLines = content.split("\n")
    if (hasTrailingNewline) allLines.pop()

    const { keptLines, removed } = filterLogsByTimeRange(
      allLines,
      startTime,
      endTime,
    )

    const nextContent =
      keptLines.join("\n") +
      (hasTrailingNewline && keptLines.length > 0 ? "\n" : "")

    // Rewrite in place rather than write-temp + rename. The daemon spawn
    // inherits an open append-mode handle to daemon.log
    // (`stdio: ['ignore', logFd, logFd]`), and on Windows `renameSync` over a
    // file with any open handle fails with EPERM — that's why the Clear Logs
    // dialog used to dead-end with a rename error. `openSync('a')` uses
    // shared write/read/delete mode, so a parallel `r+` open + truncate
    // succeeds while the daemon keeps appending at the new file end.
    const nextBytes = Buffer.from(nextContent, "utf-8")
    const fd = fs.openSync(logFile, "r+")
    try {
      if (nextBytes.length > 0)
        fs.writeSync(fd, nextBytes, 0, nextBytes.length, 0)
      fs.ftruncateSync(fd, nextBytes.length)
    } finally {
      fs.closeSync(fd)
    }

    return { removed, remaining: keptLines.length }
  }

  healthCheck(type: string): unknown {
    // Hosted-login agents (e.g. Cursor, Hermes): answer from the CLI's own
    // sign-in state (cached probe) rather than the core's check_ready. The
    // Configure dialog gets a guaranteed-fresh read via refreshHostedLogin().
    if (HOSTED_LOGIN_AGENTS[type]) return this._hostedLoginHealth(type)
    const healthCheck = this._connector!.healthCheck as (
      type: string,
    ) => unknown
    return healthCheck.call(this._connector, type)
  }

  /**
   * Daemon liveness from the launcher's perspective, independent of whether
   * any agents are configured. Used by the sidebar status dot — relying on
   * agent state means "no agents" looks identical to "daemon dead", which
   * makes the launcher feel broken on first run / after every install
   * failure.
   */
  getDaemonState(): {
    state: "online" | "starting" | "offline"
    pid: number | null
  } {
    const pid = this._getLiveDaemonPid()
    if (pid) return { state: "online", pid }

    // Pid file present but failing the freshness checks in _getLiveDaemonPid
    // (typically during the first few seconds after spawn) — surface as
    // "starting" so the dot doesn't flicker between offline and online.
    try {
      const raw = fs.readFileSync(DAEMON_PID_FILE, "utf-8").trim()
      const candidatePid = parseInt(raw, 10)
      if (Number.isFinite(candidatePid) && isPidAlive(candidatePid)) {
        const age = Date.now() - fs.statSync(DAEMON_PID_FILE).mtimeMs
        if (age < 15_000) return { state: "starting", pid: candidatePid }
      }
    } catch {}
    return { state: "offline", pid: null }
  }

  private _getLiveDaemonPid(): number | null {
    try {
      const getDaemonPid = this._connector?.getDaemonPid as
        | (() => number | null)
        | undefined
      const pidFromFile = getDaemonPid
        ? getDaemonPid.call(this._connector)
        : null

      const pidFileAge = (() => {
        try {
          return Date.now() - fs.statSync(DAEMON_PID_FILE).mtimeMs
        } catch {
          return Number.POSITIVE_INFINITY
        }
      })()
      const statusInfo = (() => {
        try {
          const stat = fs.statSync(DAEMON_STATUS_FILE)
          const raw = JSON.parse(
            fs.readFileSync(DAEMON_STATUS_FILE, "utf-8"),
          ) as { pid?: number }
          return { pid: raw.pid || null, age: Date.now() - stat.mtimeMs }
        } catch {
          return { pid: null, age: Number.POSITIVE_INFINITY }
        }
      })()

      // The pid file gets truncated/empty under races (the launcher used to
      // delete it, and multiple foreground daemons clobber it), which made us
      // report a perfectly healthy daemon as "stopped". The daemon rewrites the
      // status file — including its own pid — every 5s, so treat that as an
      // equally authoritative source and fall back to it when the pid file is
      // missing or points at a dead process.
      const startupGraceMs = 15_000
      const statusFreshMs = 20_000
      const candidates: number[] = []
      if (pidFromFile) candidates.push(pidFromFile)
      if (statusInfo.pid && statusInfo.pid !== pidFromFile)
        candidates.push(statusInfo.pid)

      for (const pid of candidates) {
        // A live PID alone is not enough on Windows because stale PIDs can be
        // reused. Require either a young pid file (startup grace, before the
        // first status write) or a fresh status file written by THIS pid.
        const hasFreshMatchingStatus =
          statusInfo.pid === pid && statusInfo.age < statusFreshMs
        if (
          isPidAlive(pid) &&
          (pidFileAge < startupGraceMs || hasFreshMatchingStatus)
        ) {
          // Heal an empty/stale pid file so the daemon's own singleton guard
          // (which reads daemon.pid) keeps working and we don't spawn a second.
          if (pidFromFile !== pid) {
            try {
              fs.writeFileSync(DAEMON_PID_FILE, String(pid), "utf-8")
            } catch {}
          }
          return pid
        }
      }

      // Genuinely no live daemon — clean up so a fresh start isn't blocked.
      if (pidFromFile || statusInfo.pid) {
        appendDaemonLog(
          `removing stale daemon pid ${pidFromFile || statusInfo.pid}`,
        )
      }
      for (const file of [
        DAEMON_PID_FILE,
        DAEMON_STATUS_FILE,
        DAEMON_CMD_FILE,
      ]) {
        try {
          fs.unlinkSync(file)
        } catch {}
      }
      this._statusCache = { value: {}, at: 0 }
      return null
    } catch {
      return null
    }
  }

  private _startDaemon(): { success: boolean; pid?: number; message: string } {
    try {
      const stopDaemon = this._connector!.stopDaemon as () => void
      stopDaemon.call(this._connector)
    } catch {}

    const { spawn } = require("child_process")
    const portableNodeDir = path.join(os.homedir(), ".openagents", "nodejs")
    const openagentsDir = path.join(os.homedir(), ".openagents")

    const extraDirs = [portableNodeDir, path.join(portableNodeDir, "bin")]
    const runtimesDir = path.join(openagentsDir, "runtimes")
    try {
      for (const d of fs.readdirSync(runtimesDir, { withFileTypes: true })) {
        if (d.isDirectory())
          extraDirs.push(path.join(runtimesDir, d.name, "node_modules", ".bin"))
      }
    } catch {}
    extraDirs.push(path.join(openagentsDir, "core", "node_modules", ".bin"))
    extraDirs.push(path.join(portableNodeDir, "node_modules", ".bin"))
    if (process.platform === "win32") {
      extraDirs.push(path.join(process.env.APPDATA || "", "npm"))
      try {
        const { execSync: _exec } = require("child_process")
        const npmPrefix = _exec("npm config get prefix", {
          encoding: "utf-8",
          timeout: 5000,
          windowsHide: true,
        }).trim()
        if (npmPrefix && !extraDirs.includes(npmPrefix))
          extraDirs.push(npmPrefix)
      } catch {}
    }
    const enhancedPath = [...extraDirs, process.env.PATH || ""].join(
      path.delimiter,
    )

    // Bundled fallback CLI: the copy of @openagents-org/agent-launcher we ship
    // inside the app (asarUnpack'd, so it's a real on-disk file the spawned
    // node can execute rather than a virtual path inside app.asar). This lets
    // the daemon start even when the runtime-downloaded GLOBAL core never
    // landed (offline / AV-blocked) — the same failure that used to strand
    // Windows users at "Daemon failed to start".
    let bundledCli: string | null = null
    try {
      const pkg = require.resolve("@openagents-org/agent-launcher/package.json")
      let p = path.join(path.dirname(pkg), "bin", "agent-connector.js")
      if (p.includes("app.asar") && !p.includes("app.asar.unpacked"))
        p = p.replace("app.asar", "app.asar.unpacked")
      bundledCli = p
    } catch {}

    let cliPath: string | null = null
    const cliCandidates = [
      path.join(LOCAL_CORE, "bin", "agent-connector.js"),
      path.join(
        portableNodeDir,
        "node_modules",
        "@openagents-org",
        "agent-launcher",
        "bin",
        "agent-connector.js",
      ),
      ...(bundledCli ? [bundledCli] : []),
    ]
    for (const c of cliCandidates) {
      try {
        if (fs.existsSync(c)) {
          cliPath = c
          break
        }
      } catch {}
    }
    if (!cliPath) {
      appendDaemonLog(
        `agent-launcher CLI not found; checked ${cliCandidates.join(", ")}`,
      )
      return {
        success: false,
        message:
          "agent-launcher CLI not found. Install an agent first via the Install tab.",
      }
    }

    // Pick a node binary that actually launches. The bundled portable
    // node.exe is preferred when usable, but on some Windows machines it's
    // blocked by Defender / SmartScreen and CreateProcess fails. When neither
    // a portable nor a system node is usable, fall back to running THIS
    // Electron binary as a plain Node process (ELECTRON_RUN_AS_NODE=1) —
    // Electron is always present, so the daemon can start without depending on
    // a separately-installed node runtime.
    let nodeBin = resolveWorkingNode(portableNodeDir, enhancedPath)
    const daemonEnv: NodeJS.ProcessEnv = { ...process.env }
    if (!nodeBin) {
      nodeBin = process.execPath
      daemonEnv.ELECTRON_RUN_AS_NODE = "1"
      appendDaemonLog(
        `no portable/system node usable; running daemon via Electron-as-node (${nodeBin})`,
      )
    }

    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
      const logFd = fs.openSync(DAEMON_LOG_FILE, "a")
      appendDaemonLog(`starting daemon: node="${nodeBin}" cli="${cliPath}"`)

      const proc = spawn(nodeBin, [cliPath, "up", "--foreground"], {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: withPathEnv(enhancedPath, daemonEnv),
        windowsHide: true,
      })
      proc.once("error", (err: Error) => {
        appendDaemonLog(`daemon spawn error: ${err.message}`)
      })
      proc.once(
        "exit",
        (code: number | null, signal: NodeJS.Signals | null) => {
          appendDaemonLog(
            `daemon process exited early: code=${code ?? "null"} signal=${signal ?? "null"}`,
          )
        },
      )
      proc.unref()
      fs.writeFileSync(DAEMON_PID_FILE, String(proc.pid), "utf-8")
      fs.closeSync(logFd)

      return {
        success: true,
        pid: proc.pid,
        message: `Daemon started (PID ${proc.pid})`,
      }
    } catch (e: unknown) {
      return {
        success: false,
        message: `Failed to start daemon: ${(e as Error).message}`,
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // Stage 3.1 — Workspace chat (send / get / poll messages)
  // Mirrors the legacy launcher's pattern: chat lives on AgentManager
  // and is invoked from the main process via IPC.
  // ─────────────────────────────────────────────────────────

  private _getWorkspaceClient(): {
    sendMessage: (
      workspaceId: string,
      channelName: string,
      token: string,
      content: string,
      opts?: Record<string, unknown>,
    ) => Promise<{ id?: string }>
    pollMessages: (
      workspaceId: string,
      channelName: string,
      token: string,
      opts?: { after?: string; limit?: number },
    ) => Promise<ChatMessage[]>
    getRecentMessages: (
      workspaceId: string,
      channelName: string,
      token: string,
      limit?: number,
    ) => Promise<ChatMessage[]>
    getAgents: (
      workspaceId: string,
      token: string,
    ) => Promise<Array<{ agentName: string; role: string; status: string }>>
    uploadFile: (
      workspaceId: string,
      token: string,
      filename: string,
      contentBase64: string,
      opts?: Record<string, unknown>,
    ) => Promise<{ id?: string; url?: string; filename?: string }>
    listFiles: (
      workspaceId: string,
      token: string,
      opts?: { limit?: number; offset?: number },
    ) => Promise<unknown>
    readFile: (
      workspaceId: string,
      token: string,
      fileId: string,
    ) => Promise<Buffer>
    deleteFile: (
      workspaceId: string,
      token: string,
      fileId: string,
    ) => Promise<unknown>
  } | null {
    if (!this._connector) return null
    const ws = this._connector.workspace as Record<string, unknown> | undefined
    if (!ws) return null
    return ws as unknown as ReturnType<AgentManager["_getWorkspaceClient"]>
  }

  private _resolveChatWorkspace(workspaceId: string): WorkspaceConfig | null {
    const list = this.getNetworks() as Array<Record<string, unknown>>
    const match = list.find(
      (w) => w.id === workspaceId || w.slug === workspaceId,
    )
    if (!match) return null
    return {
      id: (match.id as string) || (match.slug as string),
      slug: (match.slug as string) || (match.id as string),
      name: match.name as string | undefined,
      endpoint: match.endpoint as string | undefined,
      token: (match.token as string) || "",
    }
  }

  async sendChatMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const ws = this._resolveChatWorkspace(input.workspaceId)
    if (!ws)
      return { success: false, messageId: "", error: "Workspace not found" }
    if (!ws.token)
      return { success: false, messageId: "", error: "Workspace has no token" }

    const client = this._getWorkspaceClient()
    if (!client)
      return {
        success: false,
        messageId: "",
        error: "Workspace client unavailable",
      }

    const channelName = input.channelName || DEFAULT_CHAT_CHANNEL
    const mentions = input.mentions || extractMentions(input.content)
    const targetAgents =
      mentions.length > 0
        ? mentions
        : input.agentId
          ? [input.agentId]
          : undefined

    try {
      const result = await client.sendMessage(
        ws.id,
        channelName,
        ws.token,
        input.content,
        {
          senderType: "human",
          senderName: "user",
          messageType: "chat",
          metadata: targetAgents
            ? { target_agents: targetAgents, mentions }
            : { mentions },
          attachments: attachmentsToServer(input.attachments),
        },
      )
      this._touchChatSession(
        ws,
        channelName,
        input.content || (input.attachments?.[0]?.filename ?? ""),
      )
      return { success: true, messageId: (result as { id?: string }).id || "" }
    } catch (e: unknown) {
      return { success: false, messageId: "", error: (e as Error).message }
    }
  }

  async getChatMessages(
    workspaceId: string,
    channelName?: string,
    limit = 100,
  ): Promise<ChatMessage[]> {
    const ws = this._resolveChatWorkspace(workspaceId)
    if (!ws) return []
    const client = this._getWorkspaceClient()
    if (!client) return []
    const ch = channelName || DEFAULT_CHAT_CHANNEL
    try {
      const messages = await client.getRecentMessages(
        ws.id,
        ch,
        ws.token,
        limit,
      )
      return messages.map(normalizeIncomingMessage)
    } catch {
      return []
    }
  }

  async listChatParticipants(
    workspaceId: string,
  ): Promise<Array<{ agentName: string; role: string; status: string }>> {
    const ws = this._resolveChatWorkspace(workspaceId)
    if (!ws) return []
    const client = this._getWorkspaceClient()
    if (!client) return []
    try {
      return await client.getAgents(ws.id, ws.token)
    } catch {
      return []
    }
  }

  startChatPolling(
    workspaceId: string,
    channelName?: string,
  ): { key: string } | null {
    const ws = this._resolveChatWorkspace(workspaceId)
    if (!ws) return null
    const ch = channelName || DEFAULT_CHAT_CHANNEL
    const key = `${ws.id}:${ch}`

    const existing = this._chatPolls.get(key)
    if (existing) {
      existing.refs += 1
      return { key }
    }

    const state: ChatPollingState = {
      workspaceId: ws.id,
      channelName: ch,
      token: ws.token,
      cursor: null,
      seenIds: new Set(),
      timer: null,
      refs: 1,
      inFlight: false,
      workspace: ws,
    }
    void this._seedChatCursor(state)
    state.timer = setInterval(() => {
      void this._pollChatOnce(state)
    }, CHAT_POLL_INTERVAL_MS)
    this._chatPolls.set(key, state)
    return { key }
  }

  stopChatPolling(workspaceId: string, channelName?: string): void {
    const ws = this._resolveChatWorkspace(workspaceId)
    if (!ws) return
    const ch = channelName || DEFAULT_CHAT_CHANNEL
    const key = `${ws.id}:${ch}`
    const state = this._chatPolls.get(key)
    if (!state) return
    state.refs -= 1
    if (state.refs <= 0) {
      if (state.timer) clearInterval(state.timer)
      this._chatPolls.delete(key)
    }
  }

  stopAllChatPolling(): void {
    for (const state of this._chatPolls.values()) {
      if (state.timer) clearInterval(state.timer)
    }
    this._chatPolls.clear()
  }

  private async _seedChatCursor(state: ChatPollingState): Promise<void> {
    const client = this._getWorkspaceClient()
    if (!client) return
    try {
      const recent = await client.getRecentMessages(
        state.workspaceId,
        state.channelName,
        state.token,
        50,
      )
      for (const m of recent) {
        if (m.messageId) state.seenIds.add(m.messageId)
      }
      if (recent.length > 0)
        state.cursor = recent[recent.length - 1].messageId || null
    } catch {}
  }

  private async _pollChatOnce(state: ChatPollingState): Promise<void> {
    if (state.inFlight) return
    state.inFlight = true
    try {
      const client = this._getWorkspaceClient()
      if (!client) return
      const messages = await client.pollMessages(
        state.workspaceId,
        state.channelName,
        state.token,
        {
          after: state.cursor || undefined,
          limit: 50,
        },
      )
      let lastId = state.cursor
      for (const m of messages) {
        if (!m.messageId || state.seenIds.has(m.messageId)) continue
        state.seenIds.add(m.messageId)
        lastId = m.messageId
        const enriched = normalizeIncomingMessage(m)
        this.emit("chat-event", {
          type: "message",
          channel: state.channelName,
          workspaceId: state.workspaceId,
          message: enriched,
        } as ChatStreamEvent)
        if (m.senderType !== "human") {
          this._touchChatSession(
            state.workspace,
            state.channelName,
            m.content || "",
          )
        }
      }
      if (lastId) state.cursor = lastId
    } catch (e: unknown) {
      this.emit("chat-event", {
        type: "error",
        channel: state.channelName,
        workspaceId: state.workspaceId,
        error: (e as Error).message,
      } as ChatStreamEvent)
    } finally {
      state.inFlight = false
    }
  }

  listChatSessions(workspaceId?: string): ChatSessionMeta[] {
    ensureDir(LAUNCHER_SESSIONS_DIR)
    const out: ChatSessionMeta[] = []
    let wsDirs: string[]
    try {
      wsDirs = fs.readdirSync(LAUNCHER_SESSIONS_DIR)
    } catch {
      return []
    }
    for (const wsDir of wsDirs) {
      if (workspaceId && wsDir !== workspaceId) continue
      const dir = path.join(LAUNCHER_SESSIONS_DIR, wsDir)
      let files: string[]
      try {
        files = fs.readdirSync(dir)
      } catch {
        continue
      }
      for (const f of files) {
        if (!f.endsWith(".json")) continue
        try {
          const data = JSON.parse(
            fs.readFileSync(path.join(dir, f), "utf-8"),
          ) as ChatSessionMeta
          out.push(data)
        } catch {}
      }
    }
    out.sort((a, b) => {
      const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0
      const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0
      return tb - ta
    })
    return out
  }

  loadChatSession(
    workspaceId: string,
    channelName: string,
  ): ChatSessionMeta | null {
    try {
      return JSON.parse(
        fs.readFileSync(sessionFilePath(workspaceId, channelName), "utf-8"),
      ) as ChatSessionMeta
    } catch {
      return null
    }
  }

  deleteChatSession(workspaceId: string, channelName: string): boolean {
    try {
      fs.unlinkSync(sessionFilePath(workspaceId, channelName))
      return true
    } catch {
      return false
    }
  }

  clearChatSessions(workspaceId?: string): number {
    let removed = 0
    for (const s of this.listChatSessions(workspaceId)) {
      if (this.deleteChatSession(s.workspaceId, s.channelName)) removed++
    }
    return removed
  }

  createChatSession(workspaceId: string): ChatSessionMeta {
    const ws = this._resolveChatWorkspace(workspaceId)
    if (!ws) throw new Error("Workspace not found")

    const dir = path.join(LAUNCHER_SESSIONS_DIR, ws.id)
    ensureDir(dir)

    let channelName = ""
    let file = ""
    do {
      channelName = `chat-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
      file = path.join(dir, `${channelName}.json`)
    } while (fs.existsSync(file))

    const now = new Date().toISOString()
    const meta: ChatSessionMeta = {
      id: `${ws.id}:${channelName}`,
      workspaceId: ws.id,
      workspaceSlug: ws.slug,
      workspaceName: ws.name,
      channelName,
      title: ws.name || ws.slug || channelName,
      lastMessageAt: null,
      lastMessagePreview: null,
      messageCount: 0,
      participants: [],
      createdAt: now,
    }

    fs.writeFileSync(file, JSON.stringify(meta, null, 2), "utf-8")
    return meta
  }

  private _touchChatSession(
    ws: WorkspaceConfig,
    channelName: string,
    preview: string,
  ): void {
    try {
      const dir = path.join(LAUNCHER_SESSIONS_DIR, ws.id)
      ensureDir(dir)
      const file = path.join(dir, `${channelName}.json`)
      const existing: ChatSessionMeta | null = (() => {
        try {
          return JSON.parse(fs.readFileSync(file, "utf-8")) as ChatSessionMeta
        } catch {
          return null
        }
      })()
      const now = new Date().toISOString()
      const cleaned = preview.replace(/\s+/g, " ").trim().slice(0, 140)
      const meta: ChatSessionMeta = {
        id: `${ws.id}:${channelName}`,
        workspaceId: ws.id,
        workspaceSlug: ws.slug,
        workspaceName: ws.name,
        channelName,
        title: existing?.title || ws.name || ws.slug || channelName,
        lastMessageAt: now,
        lastMessagePreview: cleaned || existing?.lastMessagePreview || null,
        messageCount: (existing?.messageCount || 0) + 1,
        participants: existing?.participants || [],
        createdAt: existing?.createdAt || now,
      }
      fs.writeFileSync(file, JSON.stringify(meta, null, 2), "utf-8")
    } catch {}
  }

  async uploadChatFile(
    workspaceId: string,
    filename: string,
    contentBase64: string,
    opts: { contentType?: string; channelName?: string } = {},
  ): Promise<{
    success: boolean
    fileId?: string
    url?: string
    filename?: string
    error?: string
  }> {
    const ws = this._resolveChatWorkspace(workspaceId)
    if (!ws) return { success: false, error: "Workspace not found" }
    const client = this._getWorkspaceClient()
    if (!client)
      return { success: false, error: "Workspace client unavailable" }
    try {
      const res = await client.uploadFile(
        ws.id,
        ws.token,
        filename,
        contentBase64,
        {
          contentType: opts.contentType || "application/octet-stream",
          source: "human:user",
          channelName: opts.channelName,
        },
      )
      // Server upload endpoint may surface the id as `id`, `file_id`, or
      // even a path-like `key` — match mcp-server.js which falls back across
      // both common names. Without a fileId here, the agent receives an
      // empty file_id in its prompt and can't access the file.
      const r = res as Record<string, unknown>
      const fileId =
        (r.id as string) ||
        (r.file_id as string) ||
        (r.fileId as string) ||
        (r.key as string) ||
        undefined
      return {
        success: true,
        fileId,
        url: (r.url as string) || undefined,
        filename: (r.filename as string) || filename,
      }
    } catch (e: unknown) {
      return { success: false, error: (e as Error).message }
    }
  }

  async listChatFiles(
    workspaceId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<unknown> {
    const ws = this._resolveChatWorkspace(workspaceId)
    if (!ws) return { files: [] }
    const client = this._getWorkspaceClient()
    if (!client) return { files: [] }
    try {
      return await client.listFiles(ws.id, ws.token, opts)
    } catch {
      return { files: [] }
    }
  }

  async readChatFile(
    workspaceId: string,
    fileId: string,
  ): Promise<{ success: boolean; contentBase64?: string; error?: string }> {
    const ws = this._resolveChatWorkspace(workspaceId)
    if (!ws) return { success: false, error: "Workspace not found" }
    const client = this._getWorkspaceClient()
    if (!client)
      return { success: false, error: "Workspace client unavailable" }
    try {
      const buf = await client.readFile(ws.id, ws.token, fileId)
      return {
        success: true,
        contentBase64: Buffer.from(buf).toString("base64"),
      }
    } catch (e: unknown) {
      return { success: false, error: (e as Error).message }
    }
  }

  async deleteChatFile(
    workspaceId: string,
    fileId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const ws = this._resolveChatWorkspace(workspaceId)
    if (!ws) return { success: false, error: "Workspace not found" }
    const client = this._getWorkspaceClient()
    if (!client)
      return { success: false, error: "Workspace client unavailable" }
    try {
      await client.deleteFile(ws.id, ws.token, fileId)
      return { success: true }
    } catch (e: unknown) {
      return { success: false, error: (e as Error).message }
    }
  }
}

class Installer {
  static platformKey(): "macos" | "linux" | "windows" {
    if (process.platform === "darwin") return "macos"
    if (process.platform === "win32") return "windows"
    return "linux"
  }
}

function fetchNpmInfo(pkg: string): Promise<NpmRegistryInfo> {
  return new Promise((resolve, reject) => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(pkg).replace("%40", "@")}`
    const req = https.get(
      url,
      { headers: { Accept: "application/json" } },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          fetchNpmInfo(res.headers.location as string).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        let data = ""
        res.setEncoding("utf-8")
        res.on("data", (c) => {
          data += c
        })
        res.on("end", () => {
          try {
            resolve(JSON.parse(data) as NpmRegistryInfo)
          } catch (e) {
            reject(e as Error)
          }
        })
      },
    )
    req.on("error", reject)
    req.setTimeout(10000, () => req.destroy(new Error("npm registry timeout")))
  })
}

function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0)
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return y - x
  }
  return 0
}

// Semver pre-release identifier — anything after a hyphen (`-beta.1`, `-rc.2`,
// `-canary.123`). Plain releases match /^\d+\.\d+\.\d+$/ with no hyphen.
function isPreRelease(version: string): boolean {
  return version.includes("-")
}

// Versions published to npm, sorted highest-first. Stable-only by default —
// previously this returned every published version including betas, which
// made the marketplace surface a beta as "latest" even though `npm install
// <pkg>` only fetches dist-tags.latest. After installing the actual newest
// stable, the card would still claim an update was available because it was
// comparing against the beta. Pass includePreRelease for the changelog
// listing where surfacing betas is useful.
function sortedPublishedVersions(
  info: NpmRegistryInfo | null,
  opts: { includePreRelease?: boolean } = {},
): string[] {
  return Object.keys(info?.versions || {})
    .filter((v) => /^\d/.test(v))
    .filter((v) => (opts.includePreRelease ? true : !isPreRelease(v)))
    .sort(compareVersionsDesc)
}

function resolveLatestVersion(info: NpmRegistryInfo | null): string | null {
  // dist-tags.latest is the source of truth for what `npm install <pkg>`
  // installs. Use it whenever it's published; only fall back to scanning the
  // versions map for packages that don't publish a `latest` tag.
  const tagged = info?.["dist-tags"]?.latest
  if (tagged) return tagged
  return sortedPublishedVersions(info)[0] || null
}

function normalizeTimeValue(value: string | number | Date): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value === "number") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

function filterLogsByTimeRange(
  lines: string[],
  start: Date,
  end: Date,
): { keptLines: string[]; removed: number } {
  const headerTimes = resolveLogHeaderTimestamps(lines, end)
  let activeRemove = false
  let removed = 0
  const keptLines: string[] = []

  for (let index = 0; index < lines.length; index++) {
    const headerTime = headerTimes[index]
    if (headerTime) {
      const time = headerTime.getTime()
      activeRemove = time >= start.getTime() && time <= end.getTime()
    }
    if (activeRemove) {
      removed++
    } else {
      keptLines.push(lines[index])
    }
  }

  return { keptLines, removed }
}

function resolveLogHeaderTimestamps(
  lines: string[],
  referenceTime: Date,
): (Date | null)[] {
  const resolved: (Date | null)[] = new Array(lines.length).fill(null)
  let currentDay = startOfLocalDay(referenceTime)
  let lastClockSeconds: number | null = null

  for (let index = lines.length - 1; index >= 0; index--) {
    const token = parseLogTimestampToken(lines[index])
    if (!token) continue

    if (token.kind === "iso") {
      resolved[index] = token.date
      currentDay = startOfLocalDay(token.date)
      lastClockSeconds =
        token.date.getHours() * 3600 +
        token.date.getMinutes() * 60 +
        token.date.getSeconds()
      continue
    }

    if (lastClockSeconds !== null && token.seconds > lastClockSeconds) {
      currentDay = addLocalDays(currentDay, -1)
    }

    resolved[index] = withLocalClock(currentDay, token.seconds)
    lastClockSeconds = token.seconds
  }

  return resolved
}

function parseLogTimestampToken(
  line: string,
): { kind: "iso"; date: Date } | { kind: "clock"; seconds: number } | null {
  if (!line) return null

  const isoMatch = line.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))/,
  )
  if (isoMatch) {
    const date = new Date(isoMatch[1])
    if (!Number.isNaN(date.getTime())) return { kind: "iso", date }
  }

  const clockMatch = line.match(/^\[(\d{2}):(\d{2}):(\d{2})\]/)
  if (clockMatch) {
    return {
      kind: "clock",
      seconds:
        Number(clockMatch[1]) * 3600 +
        Number(clockMatch[2]) * 60 +
        Number(clockMatch[3]),
    }
  }

  return null
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function withLocalClock(day: Date, seconds: number): Date {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hours,
    minutes,
    secs,
  )
}
