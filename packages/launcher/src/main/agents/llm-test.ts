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

export type LLMTestResult = {
  success: boolean
  model?: string
  response?: string
  error?: string
}

export function httpRequestJson(
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
      const model = pick("PI_MODEL") || fallback?.model
      if (!model) {
        return {
          success: false,
          error: "PI_MODEL is required for this provider.",
        }
      }

      if (api === "anthropic-messages") {
        const url = /\/v1$/i.test(base)
          ? `${base}/messages`
          : `${base}/v1/messages`
        const official = isOfficialAnthropicBase(base)
        const { status, text } = await httpRequestJson(
          url,
          "POST",
          {
            "x-api-key": piKey,
            ...(official ? {} : { Authorization: `Bearer ${piKey}` }),
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

      if (api !== "openai-completions" && api !== "openai-responses") {
        return {
          success: false,
          error: `Unsupported PI_API_FORMAT '${api}' for Launcher testing.`,
        }
      }
      const apiBase = /\/v\d+$/i.test(base) ? base : `${base}/v1`
      const responsesApi = api === "openai-responses"
      const { status, text } = await httpRequestJson(
        `${apiBase}/${responsesApi ? "responses" : "chat/completions"}`,
        "POST",
        {
          Authorization: `Bearer ${piKey}`,
          "Content-Type": "application/json",
        },
        JSON.stringify(
          responsesApi
            ? { model, input: "Say hi in 5 words.", max_output_tokens: 16 }
            : {
                model,
                max_tokens: 16,
                messages: [{ role: "user", content: "Say hi in 5 words." }],
              },
        ),
      )
      if (status >= 400)
        return {
          success: false,
          error: `HTTP ${status}: ${text.slice(0, 200)}`,
        }
      let reply = ""
      try {
        const parsed = JSON.parse(text)
        reply = responsesApi
          ? parsed?.output_text || parsed?.output?.[0]?.content?.[0]?.text || ""
          : parsed?.choices?.[0]?.message?.content || ""
      } catch {}
      return { success: true, model, response: String(reply).slice(0, 80) }
    }

    // ── DeepSeek Harness: the harness has no CLI sign-in, so the key entered
    // here is the only credential the agent will ever have. Probe the endpoint
    // it will actually use (DEEPSEEK_BASE_URL when set, the public API
    // otherwise) rather than assuming the official host. Kept ahead of the
    // generic branches so a DEEPSEEK_* form is never mistaken for a bare
    // OpenAI-compatible one — but AFTER Pi's, because a PI_PROVIDER=deepseek
    // form also carries DEEPSEEK_API_KEY and belongs to Pi's probe.
    const dsKey = pick("DEEPSEEK_API_KEY")
    const dsBaseInput = pick("DEEPSEEK_BASE_URL")
    if (dsKey || dsBaseInput) {
      if (!dsKey) {
        return {
          success: false,
          error:
            "Enter DEEPSEEK_API_KEY. The harness runs with a private, empty home, so there is no saved login to fall back on.",
        }
      }
      const base = trimSlash(dsBaseInput || "https://api.deepseek.com")
      const url = /\/v1$/i.test(base)
        ? `${base}/chat/completions`
        : `${base}/v1/chat/completions`
      // The harness's own default. A model the user has not configured is not
      // worth failing the connection test over — this proves credentials and
      // reachability, which is what the button claims.
      const model = pick("DEEPSEEK_MODEL") || "deepseek-v4-flash"
      const { status, text } = await httpRequestJson(
        url,
        "POST",
        {
          Authorization: `Bearer ${dsKey}`,
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
      let reply = ""
      try {
        reply = JSON.parse(text)?.choices?.[0]?.message?.content || ""
      } catch {}
      return { success: true, model, response: reply.slice(0, 80) }
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
      return {
        success: false,
        error:
          "Aider injects your key into the provider chosen by AIDER_PROVIDER (or the model name) and verifies it on its first run — there's no single endpoint to test here. Save the config and send a message in the workspace to confirm.",
      }
    }

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
        return {
          success: false,
          error: `HTTP ${status}: ${text.slice(0, 200)}`,
        }
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
        return {
          success: false,
          error: `HTTP ${status}: ${text.slice(0, 200)}`,
        }
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
