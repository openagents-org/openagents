/**
 * "Test connection" for key-based agents, run from the main process.
 *
 * Kept out of the installed core on purpose: the core on a user's machine is
 * often older and only knows the OpenAI-compatible path, so Claude/Gemini keys
 * came back as "No API key provided". This routes by whichever key/base URL the
 * env carries and covers every provider the launcher can honestly probe.
 */
import { net } from "electron"
import { isOfficialAnthropicBase } from "./env-normalize"
import {
  GOOSE_COMPAT_BASES,
  GOOSE_KEYLESS_PROVIDERS,
  OPENWORKER_COMPAT_BASES,
} from "./provider-bases"

export type LLMTestResult = {
  success: boolean
  model?: string
  response?: string
  error?: string
}

/**
 * One attempt. `httpRequestJson` wraps this with the retry — kept separate so
 * the retry is a decision about the error, not something buried in the socket
 * plumbing.
 *
 * The default timeout follows the method, because the two kinds of request here
 * are nothing alike: a GET lists models and a relay answers it off a table,
 * while a POST is a real (16-token) completion that a cold relay or a large
 * model can sit on for far longer. 15s flat is what made "test connection"
 * fail on a base URL that plainly worked, then pass on the retry.
 */
export function httpRequestOnce(
  urlStr: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
  timeoutMs = /^post$/i.test(method) ? 45000 : 20000,
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
 * A transport failure — nobody answered. An HTTP status is NOT one of these:
 * a 401 is the endpoint's verdict and repeating it only wastes the user's time.
 */
const TRANSIENT =
  /timed out|timeout|socket hang up|network|ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|ERR_(CONNECTION|NETWORK|TIMED_OUT|EMPTY_RESPONSE|SOCKET)/i

/**
 * The probe request, retried once when nothing answered.
 *
 * Every caller here is a probe the user triggered and is watching — "test
 * connection", the model picker — so a single dropped connection reads as a
 * broken key or a broken relay. It isn't: the same request a second later goes
 * through, which is exactly what users were doing by hand.
 */
export async function httpRequestJson(
  urlStr: string,
  method: string,
  headers: Record<string, string>,
  body: string | null,
  timeoutMs?: number,
): Promise<{ status: number; text: string }> {
  try {
    return await httpRequestOnce(urlStr, method, headers, body, timeoutMs)
  } catch (e: unknown) {
    const message = (e as Error)?.message || ""
    if (!TRANSIENT.test(message)) throw e
    await new Promise((r) => setTimeout(r, 700))
    return httpRequestOnce(urlStr, method, headers, body, timeoutMs)
  }
}

/**
 * The first model an endpoint says it serves, or "" when it publishes no list.
 *
 * A probe needs SOME model id, and the blank-field fallback used to be a
 * hardcoded vendor name (`gpt-4o-mini`). That name exists only on OpenAI
 * itself: point the same form at a relay, at a self-hosted gateway, or at the
 * OpenAgents credits gateway — whose catalogue is entirely third-party (glm,
 * deepseek, kimi, qwen…) — and the test came back
 * `Model 'gpt-4o-mini' is not available`, which reads as "my key is broken"
 * rather than "choose one of the models this endpoint actually serves".
 *
 * So when the model field is blank we ASK the endpoint. `/models` is
 * unauthenticated on some gateways and key-guarded on others, so whatever
 * credential we have rides along. Anthropic's list has the same
 * `{data:[{id}]}` shape, which is why this serves both protocols.
 */
async function servedModels(
  apiBase: string,
  headers: Record<string, string>,
): Promise<string[]> {
  try {
    const { status, text } = await httpRequestJson(
      `${apiBase}/models`,
      "GET",
      headers,
      null,
    )
    if (status >= 400) return []
    const data = JSON.parse(text)?.data
    if (!Array.isArray(data)) return []
    const ids: string[] = []
    for (const m of data) {
      const id = m && typeof m.id === "string" ? m.id.trim() : ""
      // A catalogue is not all chat models: embeddings, audio, image and
      // moderation entries sit in the same list and answer a completion with a
      // 400 that would read as a broken key.
      if (id && !NON_CHAT_MODEL.test(id)) ids.push(id)
      if (ids.length >= MODEL_CANDIDATES) break
    }
    return ids
  } catch {
    // A list we cannot read is not a failure of the test — the caller still has
    // its vendor default to fall back on.
    return []
  }
}

/**
 * How many advertised models to try before giving up on the catalogue.
 *
 * More than one, because a gateway's list and what its backend will actually
 * serve are not the same set. Measured against the OpenAgents credits gateway
 * (2026-09-12): of the models it advertises, roughly half answer a completion
 * with `model not found` from the backend behind it. Picking the first id and
 * reporting its failure would blame the user's key for the catalogue's rot.
 *
 * Only ever used for a model WE chose. A model the user typed is sent as
 * typed, and its rejection is reported as-is — silently substituting another
 * would make the test's verdict a lie about the config being saved.
 */
const MODEL_CANDIDATES = 4

/** Catalogue entries that cannot answer a chat completion. */
const NON_CHAT_MODEL =
  /embed|whisper|tts|audio|dall-e|image|moderation|rerank|guard|transcribe|realtime|search|vision-preview/i

/**
 * Vendors whose own catalogue we never need to ask about.
 *
 * Their default model below is a known-good chat model, while their `/models`
 * list is long, ordered arbitrarily and full of entries a completion request
 * would choke on. Asking a RELAY is the opposite: its channel names are
 * knowable no other way, and its list is exactly what the user must pick from.
 */
const VENDOR_HOSTS =
  /(^|\.)(openai\.com|moonshot\.ai|deepseek\.com|anthropic\.com|x\.ai|mistral\.ai)$/i

function isVendorHost(base: string): boolean {
  try {
    return VENDOR_HOSTS.test(new URL(base).hostname)
  } catch {
    return false
  }
}

/** An endpoint saying "I don't serve that model", in any of its dialects. */
const MODEL_REJECTED =
  /model.{0,60}?(is not available|does not exist|not found|unknown model|invalid model|no such model|not supported)/is

/**
 * Turn an endpoint's rejection into something the user can act on.
 *
 * The failure that sent people to support was a bare `HTTP 400: {"detail":
 * "Model 'gpt-4o-mini' is not available. This gateway only allows: …"}`. Every
 * fact needed to fix it is in there; none of it is where the user is looking.
 */
function explainProbeFailure(
  status: number,
  text: string,
  model: string,
): string {
  if (MODEL_REJECTED.test(text)) {
    // Gateways that enumerate their catalogue in the error are doing the user a
    // favour — pass it straight through rather than burying it in raw JSON.
    const allowed = /only allows:\s*([^"}\n]+)/i.exec(text)?.[1]?.trim()
    return allowed
      ? `This endpoint doesn't serve '${model}'. It serves: ${allowed.slice(0, 200)}`
      : `This endpoint doesn't serve '${model}'. Pick one from the model list above — it is loaded from this endpoint. (HTTP ${status})`
  }
  return `HTTP ${status}: ${text.slice(0, 200)}`
}

/**
 * Agents whose credential is for a hosted platform rather than a model
 * endpoint. None of them can be probed from here — the vendor publishes no
 * key-check API — and every one of them USED to land on the generic
 * OpenAI-compatible path, which replied "No API key to test for this agent"
 * while the key sat in the form.
 *
 * The messages name the way each one is actually verified, and CodeBuddy's
 * spells out the trap behind that bug report: its BASE_URL is an alternate
 * CodeBuddy deployment, so an OpenAI-compatible gateway key has nowhere to go.
 */
const HOSTED_PLATFORMS: Array<{ vars: string[]; message: string }> = [
  {
    vars: ["CODEBUDDY_API_KEY", "CODEBUDDY_AUTH_TOKEN"],
    message:
      "CodeBuddy signs in against Tencent's own service, so its key can't be checked from here — save it and launch the agent to verify. Note that CODEBUDDY_BASE_URL selects another CodeBuddy deployment (enterprise or self-hosted), not an OpenAI-compatible endpoint: a model-gateway or relay key won't work with this agent.",
  },
  {
    vars: ["COMMAND_CODE_API_KEY"],
    message:
      "Command Code verifies its key against its own account service — there's no endpoint to test here. Save it and launch the agent, or run `command-code login`.",
  },
  {
    vars: ["COPILOT_GITHUB_TOKEN"],
    message:
      "Copilot authenticates with your GitHub account, and its token is checked by GitHub on first use — there's no model endpoint to probe here. Save it and launch the agent to verify.",
  },
  {
    vars: ["AMP_API_KEY"],
    message:
      "Amp authenticates against Sourcegraph's own service — its key is verified by running the CLI. Save it and launch the agent, or run `amp login`.",
  },
]

type OpenAIProbe = {
  /** Base URL as configured. `/v1` is appended only when absent. */
  base: string
  key: string
  /** Configured model; blank means "ask the endpoint what it has". */
  model: string
  /** Vendor default, used only when the endpoint lists nothing either. */
  fallbackModel?: string
  /** Talk the Responses API instead of chat completions. */
  responsesApi?: boolean
  /** A local server that takes no key (Ollama). */
  keyless?: boolean
}

/**
 * One 16-token completion against an OpenAI-compatible endpoint.
 *
 * Every OpenAI-protocol agent routes through here — the generic path, the
 * provider-driven ones (Pi, OpenWorker, Goose) and the vendor harnesses
 * (DeepSeek, Kimi) — so that "blank model means ask the endpoint" and the
 * rejection wording are decided once instead of drifting per branch. That
 * drift is what let OPENWORKER_API_KEY fall through every branch and report
 * "no API key" while the key sat in the form.
 */
async function probeOpenAI(o: OpenAIProbe): Promise<LLMTestResult> {
  const base = o.base.replace(/\/+$/, "")
  // A relay is usually pasted WITH its version segment; adding a second one
  // gives …/v1/v1/chat/completions, a 404 that reads like a dead endpoint.
  const apiBase = /\/v\d+$/i.test(base) ? base : `${base}/v1`
  const headers: Record<string, string> = o.keyless
    ? { "content-type": "application/json" }
    : { Authorization: `Bearer ${o.key}`, "content-type": "application/json" }

  const typed = (o.model || "").trim()
  // Only a relay/gateway gets asked — see VENDOR_HOSTS.
  const candidates = typed
    ? [typed]
    : ((!isVendorHost(apiBase) ? await servedModels(apiBase, headers) : []).concat(
        o.fallbackModel ? [o.fallbackModel] : [],
      ) as string[])
  if (!candidates.length) {
    return {
      success: false,
      error:
        "No model to test with: this endpoint publishes no model list, so enter a model name above first.",
    }
  }

  const tried: string[] = []
  let last: { status: number; text: string; model: string } | null = null
  for (const model of candidates) {
    tried.push(model)
    const { status, text } = await httpRequestJson(
      `${apiBase}/${o.responsesApi ? "responses" : "chat/completions"}`,
      "POST",
      headers,
      JSON.stringify(
        o.responsesApi
          ? { model, input: "Say hi in 5 words.", max_output_tokens: 16 }
          : {
              model,
              max_tokens: 16,
              messages: [{ role: "user", content: "Say hi in 5 words." }],
            },
      ),
    )
    if (status < 400) {
      let reply = "",
        used = model
      try {
        const p = JSON.parse(text)
        reply = o.responsesApi
          ? p?.output_text || p?.output?.[0]?.content?.[0]?.text || ""
          : p?.choices?.[0]?.message?.content || ""
        used = p?.model || model
      } catch {}
      return { success: true, model: used, response: String(reply).slice(0, 80) }
    }
    last = { status, text, model }
    // Anything that is NOT the catalogue being wrong — a bad key, a dead host,
    // a rate limit — is the answer, and trying another model would only hide
    // it behind three more failures.
    if (!MODEL_REJECTED.test(text)) break
  }

  const { status, text, model } = last!
  if (tried.length > 1 && MODEL_REJECTED.test(text)) {
    // The credential and the endpoint are fine — the models it advertises are
    // not there. Say that, because "invalid model" on a model the user never
    // chose is otherwise unreadable.
    return {
      success: false,
      error: `This endpoint lists models it doesn't serve — ${tried.join(", ")} were all rejected. The key and the endpoint look reachable; pick a model that works and enter it above.`,
    }
  }
  return { success: false, error: explainProbeFailure(status, text, model) }
}

/**
 * One 16-token completion against an Anthropic-protocol endpoint.
 *
 * Mirrors exactly how the spawned CLI will authenticate, so the test predicts
 * the real run: the official endpoint uses `x-api-key`, while a relay/proxy
 * base goes through `Authorization: Bearer` (the CLI gets that via
 * ANTHROPIC_AUTH_TOKEN — see normalizeEnvForSave). Sending x-api-key to a
 * Bearer-only relay is precisely what makes it 401 with "invalid token".
 */
async function probeAnthropic(o: {
  base: string
  key: string
  model: string
  fallbackModel?: string
}): Promise<LLMTestResult> {
  const base = o.base.replace(/\/+$/, "").replace(/\/v1$/i, "")
  const official = isOfficialAnthropicBase(base)
  // A relay gets BOTH headers: they carry the same secret, and which one a
  // given proxy honours is not knowable from here — sending only the wrong one
  // is a 401 that looks like a bad key. Anthropic's own API is unambiguous, so
  // it gets x-api-key alone.
  const auth: Record<string, string> = official
    ? { "x-api-key": o.key }
    : { "x-api-key": o.key, Authorization: `Bearer ${o.key}` }
  const headers = {
    ...auth,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  }

  let model = (o.model || "").trim()
  // Only a relay gets asked: Anthropic's own catalogue is stable and its
  // default below is always valid, while a relay's channel names never match it.
  if (!model && !official)
    model = (await servedModels(`${base}/v1`, headers))[0] || ""
  if (!model) model = o.fallbackModel || "claude-3-5-haiku-latest"

  const { status, text } = await httpRequestJson(
    `${base}/v1/messages`,
    "POST",
    headers,
    JSON.stringify({
      model,
      max_tokens: 16,
      messages: [{ role: "user", content: "Say hi in 5 words." }],
    }),
  )
  if (status >= 400)
    return { success: false, error: explainProbeFailure(status, text, model) }

  let reply = "",
    used = model
  try {
    const p = JSON.parse(text)
    reply = p?.content?.[0]?.text || ""
    used = p?.model || model
  } catch {}
  return { success: true, model: used, response: reply.slice(0, 80) }
}

/**
 * One short generation against a Gemini-protocol endpoint.
 *
 * Google's REST path is /v1beta/models/<model>:generateContent. Relays and
 * custom gateways are usually entered WITH the version already in the base URL
 * (e.g. https://host/v1beta), so the segment is added only when the base URL
 * doesn't already carry one — otherwise we'd POST to …/v1beta/v1beta/… and the
 * relay never answers (the request hangs to the socket timeout instead of
 * returning a clean error).
 */
async function probeGemini(o: {
  base: string
  key: string
  model: string
  fallbackModel?: string
}): Promise<LLMTestResult> {
  const base = o.base.replace(/\/+$/, "")
  const versioned = /\/v\d+(beta)?$/.test(base)
  // Deliberately NOT sending Authorization: Bearer — Google would treat it as
  // an OAuth token and reject a plain API key with 401.
  const headers = { "content-type": "application/json", "x-goog-api-key": o.key }

  let model = (o.model || "").trim()
  if (!model) {
    // Gemini's list is {models:[{name:"models/<id>"}]}, not OpenAI's shape.
    try {
      const { status, text } = await httpRequestJson(
        `${base}${versioned ? "" : "/v1beta"}/models?key=${encodeURIComponent(o.key)}`,
        "GET",
        headers,
        null,
      )
      if (status < 400) {
        for (const m of JSON.parse(text)?.models || []) {
          const name = typeof m?.name === "string" ? m.name : ""
          const id = name.replace(/^models\//, "").trim()
          // Embedding and other non-chat models can't answer generateContent.
          if (id && !/embed|aqa/i.test(id)) {
            model = id
            break
          }
        }
      }
    } catch {}
  }
  if (!model) model = o.fallbackModel || "gemini-2.0-flash"

  const path = versioned
    ? `/models/${model}:generateContent`
    : `/v1beta/models/${model}:generateContent`
  const { status, text } = await httpRequestJson(
    `${base}${path}?key=${encodeURIComponent(o.key)}`,
    "POST",
    headers,
    JSON.stringify({ contents: [{ parts: [{ text: "Say hi in 5 words." }] }] }),
  )
  if (status >= 400)
    return { success: false, error: explainProbeFailure(status, text, model) }

  let reply = ""
  try {
    reply = JSON.parse(text)?.candidates?.[0]?.content?.parts?.[0]?.text || ""
  } catch {}
  return { success: true, model, response: reply.slice(0, 80) }
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
export async function testLLMConnection(
  env: Record<string, string>,
): Promise<LLMTestResult> {
  const pick = (...names: string[]): string => {
    for (const n of names) {
      if (!n) continue
      const v = (env[n] || "").trim()
      if (v) return v
    }
    return ""
  }
  const trimSlash = (u: string): string => u.replace(/\/+$/, "")

  try {
    // ── Pi: provider-agnostic key/base/model fields from the Launcher. ──
    // Keep this ahead of the generic branches: PI_API_KEY is mirrored to the
    // provider's native env variable only when the Pi child is spawned, while
    // this probe runs directly from the current (possibly unsaved) form.
    const piProvider = pick("PI_PROVIDER").toLowerCase()
    const piBaseInput = pick("PI_BASE_URL")
    const piKey = pick(
      "PI_API_KEY",
      piProvider === "anthropic" ? "ANTHROPIC_API_KEY" : "",
      piProvider === "deepseek" ? "DEEPSEEK_API_KEY" : "",
      piProvider === "google" ? "GEMINI_API_KEY" : "",
      piProvider === "openrouter" ? "OPENROUTER_API_KEY" : "",
      piProvider === "openai" || piProvider === "openai-codex"
        ? "OPENAI_API_KEY"
        : "",
    )
    if (piProvider || piBaseInput || pick("PI_API_KEY")) {
      if (!piKey) {
        return {
          success: false,
          error:
            piProvider === "openai-codex"
              ? "OpenAI Codex subscription login is checked by Pi itself. Save, launch Pi and use /login if needed."
              : "Enter PI_API_KEY, or save and launch Pi to reuse an existing /login session.",
        }
      }

      const defaults: Record<
        string,
        { base: string; api: string; model: string }
      > = {
        anthropic: {
          base: "https://api.anthropic.com",
          api: "anthropic-messages",
          model: "claude-sonnet-4-6",
        },
        openai: {
          base: "https://api.openai.com/v1",
          api: "openai-responses",
          // Only the probe's model, for a form that left PI_MODEL empty. It was
          // `gpt-5-codex`, which OpenAI has retired — so the test 404'd on a
          // perfectly good key. Same small, long-lived model the generic
          // OpenAI-compatible branch below probes with.
          model: "gpt-4o-mini",
        },
        deepseek: {
          base: "https://api.deepseek.com/v1",
          api: "openai-completions",
          model: "deepseek-v4-flash",
        },
        openrouter: {
          base: "https://openrouter.ai/api/v1",
          api: "openai-completions",
          model: "openai/gpt-4o-mini",
        },
      }
      const fallback = defaults[piProvider]
      if (!piBaseInput && !fallback) {
        return {
          success: false,
          error: `PI_PROVIDER=${piProvider || "custom"} requires PI_BASE_URL.`,
        }
      }

      const base = trimSlash(piBaseInput || fallback?.base || "")
      const configuredApi = pick("PI_API_FORMAT").toLowerCase()
      const api =
        configuredApi && configuredApi !== "auto"
          ? configuredApi
          : fallback?.api ||
            (piProvider === "anthropic"
              ? "anthropic-messages"
              : "openai-completions")
      // A blank PI_MODEL is no longer fatal. On a relay the endpoint's own list
      // is a better answer than any id we could name, and the shared probes ask
      // for it; the provider default stays as the last word.
      const model = pick("PI_MODEL")

      if (api === "anthropic-messages") {
        return await probeAnthropic({
          base,
          key: piKey,
          model,
          fallbackModel: fallback?.model,
        })
      }

      if (api !== "openai-completions" && api !== "openai-responses") {
        return {
          success: false,
          error: `Unsupported PI_API_FORMAT '${api}' for Launcher testing.`,
        }
      }
      return await probeOpenAI({
        base,
        key: piKey,
        model,
        fallbackModel: fallback?.model,
        responsesApi: api === "openai-responses",
      })
    }

    // ── OpenWorker: bring-your-own-model across ~20 providers, so the provider
    // field — not the variable name — decides both the protocol and the
    // endpoint. Kept next to Pi's branch because they are the same shape.
    //
    // Before this existed, OPENWORKER_API_KEY matched no branch and no key
    // list, so every OpenWorker form fell through to the generic path and was
    // told "No API key to test for this agent" with the key sitting in it. ──
    const owProvider = pick("OPENWORKER_PROVIDER").toLowerCase()
    const owKey = pick("OPENWORKER_API_KEY")
    const owBaseInput = pick("OPENWORKER_BASE_URL")
    if (owKey || owProvider || owBaseInput) {
      const owModel = pick("OPENWORKER_MODEL")
      if (owProvider === "openai-codex") {
        return {
          success: false,
          error:
            "OpenWorker holds the ChatGPT subscription's OAuth tokens in its own state directory — there's no key endpoint to test here. Save the config and send a message in the workspace to confirm.",
        }
      }
      if (owProvider === "ollama") {
        return await probeOpenAI({
          base: owBaseInput || "http://localhost:11434/v1",
          key: "",
          model: owModel,
          keyless: true,
        })
      }
      if (!owKey) {
        return {
          success: false,
          error:
            "Enter OPENWORKER_API_KEY — the key for the provider selected above.",
        }
      }
      if (owProvider === "anthropic") {
        return await probeAnthropic({
          base: owBaseInput || "https://api.anthropic.com",
          key: owKey,
          model: owModel,
        })
      }
      if (owProvider === "gemini") {
        return await probeGemini({
          base:
            owBaseInput || "https://generativelanguage.googleapis.com",
          key: owKey,
          model: owModel,
        })
      }
      const owBase =
        owBaseInput ||
        OPENWORKER_COMPAT_BASES[owProvider] ||
        "https://api.openai.com/v1"
      return await probeOpenAI({ base: owBase, key: owKey, model: owModel })
    }

    // ── Goose: same shape again — GOOSE_PROVIDER picks the protocol, and
    // GOOSE_PROVIDER__HOST is where a relay or self-hosted endpoint goes. The
    // cloud-IAM providers (bedrock, vertex, databricks, sagemaker…) carry no
    // key in this form and have nothing here to probe, so they are told so. ──
    const gooseProvider = pick("GOOSE_PROVIDER").toLowerCase()
    const gooseKey = pick("GOOSE_PROVIDER__API_KEY")
    const gooseHost = pick("GOOSE_PROVIDER__HOST")
    if (gooseProvider || gooseKey || gooseHost) {
      const gooseModel = pick("GOOSE_MODEL")
      if (GOOSE_KEYLESS_PROVIDERS.has(gooseProvider)) {
        return await probeOpenAI({
          base: gooseHost || GOOSE_COMPAT_BASES[gooseProvider] || "",
          key: "",
          model: gooseModel,
          keyless: true,
        })
      }
      if (!gooseKey) {
        return {
          success: false,
          error:
            "Enter GOOSE_PROVIDER__API_KEY, or leave it blank to reuse the Goose keyring — a saved sign-in can only be verified by launching the agent.",
        }
      }
      if (gooseProvider === "anthropic") {
        return await probeAnthropic({
          base: gooseHost || "https://api.anthropic.com",
          key: gooseKey,
          model: gooseModel,
        })
      }
      if (gooseProvider === "google" || gooseProvider === "gemini") {
        return await probeGemini({
          base: gooseHost || "https://generativelanguage.googleapis.com",
          key: gooseKey,
          model: gooseModel,
        })
      }
      const gooseBase = gooseHost || GOOSE_COMPAT_BASES[gooseProvider] || ""
      if (!gooseBase) {
        return {
          success: false,
          error: `GOOSE_PROVIDER='${gooseProvider || "(blank)"}' has no endpoint to test from here — set GOOSE_PROVIDER__HOST for an OpenAI-compatible endpoint, or launch the agent to verify this provider.`,
        }
      }
      return await probeOpenAI({
        base: gooseBase,
        key: gooseKey,
        model: gooseModel,
      })
    }

    // ── DeepSeek Harness: the harness has no CLI sign-in, so the key entered
    // here is the only credential the agent will ever have. Probe the endpoint
    // it will actually use (DEEPSEEK_BASE_URL when set, the public API
    // otherwise) rather than assuming the official host. Kept ahead of the
    // generic branches so a DEEPSEEK_* form is never mistaken for a bare
    // OpenAI-compatible one — but AFTER Pi's, because a PI_PROVIDER=deepseek
    // form also carries DEEPSEEK_API_KEY and belongs to Pi's probe.
    // DEEPSEEK_API_BASE is mini-swe-agent's spelling of the same endpoint; a
    // relay entered there used to be ignored and the probe went to DeepSeek's
    // public API with a key meant for the relay.
    const dsKey = pick("DEEPSEEK_API_KEY")
    const dsBaseInput = pick("DEEPSEEK_BASE_URL", "DEEPSEEK_API_BASE")
    if (dsKey || dsBaseInput) {
      if (!dsKey) {
        return {
          success: false,
          error:
            "Enter DEEPSEEK_API_KEY. The harness runs with a private, empty home, so there is no saved login to fall back on.",
        }
      }
      return await probeOpenAI({
        base: dsBaseInput || "https://api.deepseek.com",
        key: dsKey,
        model: pick("DEEPSEEK_MODEL"),
        // The harness's own default. A model the user has not configured is not
        // worth failing the connection test over — this proves credentials and
        // reachability, which is what the button claims.
        fallbackModel: "deepseek-v4-flash",
      })
    }

    // ── Aider: routes through LiteLLM, so the provider (and therefore the
    // endpoint to probe) is decided by AIDER_PROVIDER / the model at run time.
    // There is no single key endpoint to test here, and we must NOT report a
    // fake "connected". Do only STATIC validation (provider value + the
    // openai-compatible base-URL requirement); the real auth/model check happens
    // on the first workspace task. Keyed on AIDER_PROVIDER/AIDER_MODEL, which
    // only Aider configs carry. ──
    const aiderProvider = pick("AIDER_PROVIDER").toLowerCase()
    if (aiderProvider || pick("AIDER_MODEL")) {
      const validProviders = [
        "auto",
        "openai",
        "anthropic",
        "openrouter",
        "gemini",
        "deepseek",
        "openai-compatible",
      ]
      if (aiderProvider && !validProviders.includes(aiderProvider)) {
        return {
          success: false,
          error: `Unknown AIDER_PROVIDER '${aiderProvider}'. Valid values: ${validProviders.join(", ")}.`,
        }
      }
      if (aiderProvider === "openai-compatible" && !pick("LLM_BASE_URL")) {
        return {
          success: false,
          error:
            "AIDER_PROVIDER=openai-compatible requires LLM_BASE_URL (the OpenAI-compatible endpoint URL).",
        }
      }
      // Once the provider is NAMED, the endpoint it routes to is known and the
      // key in this form is the one that will be used — so probe it for real
      // rather than declining. This is what makes a relay or gateway usable
      // here: `openai-compatible` + LLM_BASE_URL is precisely that case.
      const aiderKey = pick("LLM_API_KEY")
      const aiderBase = pick("LLM_BASE_URL")
      const aiderModel = pick("AIDER_MODEL")
      if (aiderKey && aiderProvider && aiderProvider !== "auto") {
        if (aiderProvider === "anthropic")
          return await probeAnthropic({
            base: aiderBase || "https://api.anthropic.com",
            key: aiderKey,
            model: aiderModel,
          })
        if (aiderProvider === "gemini")
          return await probeGemini({
            base: aiderBase || "https://generativelanguage.googleapis.com",
            key: aiderKey,
            model: aiderModel,
          })
        const aiderDefaults: Record<string, string> = {
          openai: "https://api.openai.com/v1",
          openrouter: "https://openrouter.ai/api/v1",
          deepseek: "https://api.deepseek.com",
        }
        const base = aiderBase || aiderDefaults[aiderProvider] || ""
        if (base)
          return await probeOpenAI({
            base,
            key: aiderKey,
            // Aider model ids are often LiteLLM-qualified ("openai/gpt-4o");
            // the endpoint wants the bare id, and the segment before the slash
            // is the provider we already resolved above.
            model: aiderModel.includes("/")
              ? aiderModel.slice(aiderModel.indexOf("/") + 1)
              : aiderModel,
          })
      }
      return {
        success: false,
        error:
          "Aider injects your key into the provider chosen by AIDER_PROVIDER (or the model name) and verifies it on its first run — there's no single endpoint to test here. Set AIDER_PROVIDER (and LLM_BASE_URL for a relay) to have it checked, or save and send a message in the workspace to confirm.",
      }
    }

    // ── Google Gemini ──
    const geminiKey = pick("GEMINI_API_KEY", "GOOGLE_API_KEY")
    if (geminiKey) {
      return await probeGemini({
        base:
          pick("GOOGLE_GEMINI_BASE_URL") ||
          "https://generativelanguage.googleapis.com",
        key: geminiKey,
        model: pick("GEMINI_MODEL", "GOOGLE_GEMINI_MODEL"),
      })
    }

    const anthropicKey = pick("ANTHROPIC_API_KEY")
    const openaiKey = pick(
      "OPENAI_API_KEY",
      "LLM_API_KEY",
      "KIMI_API_KEY",
      "MOONSHOT_API_KEY",
      "OPENROUTER_API_KEY",
    )

    // ── Claude subscription token: nothing we can honestly probe ──
    // `claude auth status` reports loggedIn:true for ANY value in
    // CLAUDE_CODE_OAUTH_TOKEN (verified: a garbage token still reads
    // authMethod:"oauth_token"), so using it as a check would hand out a green
    // light for a mistyped paste. Say so instead of faking a verdict.
    if (pick("CLAUDE_CODE_OAUTH_TOKEN") && !anthropicKey) {
      return {
        success: false,
        error:
          "A subscription token is verified by Claude itself on first use — there's no endpoint to test it against here. Save it and send a message in the workspace to confirm.",
      }
    }

    // ── Cursor: hosted login, no public key endpoint to probe ──
    if (pick("CURSOR_API_KEY") && !anthropicKey && !openaiKey) {
      return {
        success: false,
        error:
          "Cursor signs in through its own service — there's no key endpoint to test here. Save the key and launch the agent to verify.",
      }
    }

    // ── Hosted platforms: the key belongs to the vendor's own service, and the
    // endpoint field (where there is one) selects another deployment of THAT
    // service — not an OpenAI-compatible URL. There is nothing here we can
    // honestly probe, so each says so in its own terms.
    //
    // Saying it EXPLICITLY is the point. These keys matched no branch and no
    // key list, so they fell through to the generic path and came back as "No
    // API key to test for this agent" — with the key plainly in the form. The
    // CodeBuddy wording also heads off the mistake that produced that report:
    // pasting a model-gateway key into an agent that cannot use one. ──
    for (const hosted of HOSTED_PLATFORMS) {
      if (pick(...hosted.vars) && !anthropicKey && !openaiKey) {
        return { success: false, error: hosted.message }
      }
    }

    // ── Cline: routes by the selected provider ──
    // Cline targets many providers; we test the API-key providers we can reach
    // (Anthropic, OpenAI, OpenRouter) and give an honest message for the rest
    // (e.g. Cline's own account, or a custom endpoint configured via `cline auth`).
    const clineKey = pick("CLINE_API_KEY")
    if (clineKey && !anthropicKey && !openaiKey && !geminiKey) {
      const provider = pick("CLINE_PROVIDER").toLowerCase()
      const clineModel = pick("CLINE_MODEL")
      if (provider.includes("anthropic")) {
        const base = "https://api.anthropic.com"
        const model = clineModel || "claude-3-5-haiku-latest"
        const { status, text } = await httpRequestJson(
          `${base}/v1/messages`,
          "POST",
          {
            "x-api-key": clineKey,
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
          return {
            success: false,
            error: `HTTP ${status}: ${text.slice(0, 200)}`,
          }
        let reply = ""
        try {
          reply = JSON.parse(text)?.content?.[0]?.text || ""
        } catch {}
        return { success: true, model, response: reply.slice(0, 80) }
      }
      if (provider.includes("openai") || provider.includes("openrouter")) {
        const base = provider.includes("openrouter")
          ? "https://openrouter.ai/api/v1"
          : "https://api.openai.com/v1"
        const model =
          clineModel ||
          (provider.includes("openrouter")
            ? "openai/gpt-4o-mini"
            : "gpt-4o-mini")
        const { status, text } = await httpRequestJson(
          `${base}/chat/completions`,
          "POST",
          {
            Authorization: `Bearer ${clineKey}`,
            "Content-Type": "application/json",
          },
          JSON.stringify({
            model,
            max_tokens: 16,
            messages: [{ role: "user", content: "Say hi in 5 words." }],
          }),
        )
        if (status >= 400)
          return {
            success: false,
            error: `HTTP ${status}: ${text.slice(0, 200)}`,
          }
        let reply = "",
          used = model
        try {
          const p = JSON.parse(text)
          reply = p?.choices?.[0]?.message?.content || ""
          used = p?.model || model
        } catch {}
        return { success: true, model: used, response: reply.slice(0, 80) }
      }
      return {
        success: false,
        error:
          "Cline targets your selected provider — this provider can't be tested directly here. Save the settings and launch the agent to verify (or run `cline auth`).",
      }
    }

    // Amp authenticates against Sourcegraph's own service (AMP_API_KEY or `amp
    // login`) and has no OpenAI-style endpoint to probe, so its key is verified
    // by running the CLI itself — see AgentManager.testLLM / _testAmpConnection,
    // which intercepts AMP_API_KEY before this generic HTTP path is reached.

    // ── Anthropic (Claude) ──
    if (anthropicKey && !openaiKey) {
      return await probeAnthropic({
        base: pick("ANTHROPIC_BASE_URL") || "https://api.anthropic.com",
        key: anthropicKey,
        model: pick("ANTHROPIC_MODEL"),
      })
    }

    // ── OpenAI-compatible (OpenAI/Codex, Kimi/Moonshot, OpenClaw, OpenCode,
    // Hermes, and any relay or gateway pasted into one of their base URLs) ──
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
    return await probeOpenAI({
      base:
        pick("OPENAI_BASE_URL", "LLM_BASE_URL", "KIMI_BASE_URL") ||
        (hasKimi ? "https://api.moonshot.ai/v1" : "https://api.openai.com/v1"),
      key: apiKey,
      // MSWEA_MODEL_NAME is deliberately NOT here: mini-swe-agent names models
      // the LiteLLM way ("openai/gpt-4o"), and the prefix is not separable from
      // an OpenRouter id of the same shape — stripping it would break
      // OpenRouter, keeping it would break mini. Its form falls through to the
      // endpoint's own list, which still proves the key and the endpoint.
      model: pick(
        "OPENAI_MODEL",
        "CODEX_MODEL",
        "LLM_MODEL",
        "KIMI_MODEL",
        "OPENCLAW_MODEL",
        "OPENCODE_MODEL",
      ),
      // Only reached when the endpoint publishes no list of its own — which is
      // true of the vendor APIs these defaults belong to, and false of every
      // relay and gateway (they answer /models, and that answer wins).
      fallbackModel: hasKimi ? "kimi-k2.6" : "gpt-4o-mini",
    })
  } catch (e) {
    return { success: false, error: (e as Error)?.message || "Request failed" }
  }
}
