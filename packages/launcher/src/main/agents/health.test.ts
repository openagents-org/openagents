import { describe, expect, it } from "vitest"

import { HealthResolver, type HealthResolverDeps } from "./health"

/**
 * The launcher's readiness verdict for an agent that needs no credential.
 *
 * OpenWorker is bring-your-own-model, and two of its providers ask for no key:
 * `ollama` is a local server and `openai-codex` reuses an existing ChatGPT
 * sign-in. Judged on the key alone — which is all the core's check_ready can do
 * — both sat at "No model API key" for as long as they ran.
 */
function resolver(
  typeEnv: Record<string, string> = {},
  overrides: Partial<HealthResolverDeps> = {},
): HealthResolver {
  return new HealthResolver({
    isInstalled: () => true,
    getInstalledVersion: () => "1.0.0",
    getTypeEnv: () => typeEnv,
    loginIsAuthed: () => null,
    getRegistryEntry: () => null,
    ...overrides,
  })
}

const NOT_READY = {
  installed: true,
  ready: false,
  reason: "login_required",
  auth_mode: null,
  message: "No model API key — pick a provider and set OPENWORKER_API_KEY",
}

describe("readiness for a keyless provider", () => {
  it("is Ready with no key at all when the provider needs none", () => {
    const h = resolver({ OPENWORKER_PROVIDER: "ollama" }).reconcileAgentHealth(
      "openworker",
      {},
      NOT_READY,
    ) as Record<string, unknown>
    expect(h.ready).toBe(true)
    expect(h.reason).toBe("ready")
    // Neither a key nor a sign-in — reporting "API key" would be a lie.
    expect(h.auth_mode).toBe(null)
  })

  it("labels a reused ChatGPT sign-in as the CLI login it is", () => {
    const h = resolver({}).reconcileAgentHealth(
      "openworker",
      { OPENWORKER_PROVIDER: "openai-codex" },
      NOT_READY,
    ) as Record<string, unknown>
    expect(h.ready).toBe(true)
    expect(h.auth_mode).toBe("cli_login")
  })

  it("leaves a key provider needing its key", () => {
    const h = resolver({
      OPENWORKER_PROVIDER: "anthropic",
    }).reconcileAgentHealth("openworker", {}, NOT_READY) as Record<
      string,
      unknown
    >
    expect(h.ready).toBe(false)
    expect(h.reason).toBe("login_required")
  })

  it("still prefers a configured key over the keyless label", () => {
    const h = resolver({
      OPENWORKER_PROVIDER: "ollama",
      OPENWORKER_API_KEY: "sk-x",
    }).reconcileAgentHealth("openworker", {}, NOT_READY) as Record<
      string,
      unknown
    >
    expect(h.ready).toBe(true)
    expect(h.auth_mode).toBe("api_key")
  })
})

describe("readiness for CodeBuddy's platform token", () => {
  it("counts CODEBUDDY_AUTH_TOKEN as configured credentials", () => {
    // The registry lists it beside the API key as a first-class auth path, but
    // it is not an *_API_KEY, so the agent used to read "Login required" with a
    // perfectly good token saved.
    const h = resolver({}).reconcileAgentHealth(
      "codebuddy",
      { CODEBUDDY_AUTH_TOKEN: "eyJhbGciOi" },
      { installed: true, ready: false, reason: "login_required" },
    ) as Record<string, unknown>
    expect(h.ready).toBe(true)
    expect(h.auth_mode).toBe("api_key")
  })
})

describe("readiness for CodeArts' access key pair", () => {
  it("is Ready when the key pair was saved on the agent itself", () => {
    // Configure on an existing agent saves INSTANCE env, which the core's
    // check_ready never reads — so it reports the pair missing.
    const h = resolver({}).reconcileAgentHealth(
      "codearts",
      { CODEARTS_CLI_AK: "AKX", CODEARTS_CLI_SK: "sk-x" },
      { installed: true, ready: false, reason: "login_required" },
    ) as Record<string, unknown>
    expect(h.ready).toBe(true)
    expect(h.auth_mode).toBe("api_key")
  })
})

describe("readiness for a dual-login agent on a keyless setting", () => {
  const signedOut = { loginIsAuthed: () => false }

  it("is Ready on a free OpenCode Zen model with no sign-in and no key", () => {
    const h = resolver({ LLM_MODEL: "opencode/big-pickle" }, signedOut)
      .dualLoginHealth("opencode", { installed: true, ready: false }) as Record<
      string,
      unknown
    >
    expect(h.ready).toBe(true)
    expect(h.auth_mode).toBeNull()
  })

  it("still asks an OpenCode on a paid provider to sign in or add a key", () => {
    const h = resolver({ LLM_MODEL: "anthropic/claude-sonnet-5" }, signedOut)
      .dualLoginHealth("opencode", { installed: true, ready: false }) as Record<
      string,
      unknown
    >
    expect(h.ready).toBe(false)
    expect(h.reason).toBe("login_required")
  })
})

describe("readiness for an agent set up on the sign-in tab", () => {
  const signedIn = { OPENAGENTS_AUTH_MODE: "cli_login" }
  const typeReady = { installed: true, ready: true, auth_mode: "api_key", execution_mode: "direct" }

  it("reads CLI login, not the key saved for its type", () => {
    // The core drops that key for this agent, so the label must not claim it.
    const h = resolver({ OPENAI_API_KEY: "sk-old" }, { loginIsAuthed: () => true })
      .reconcileAgentHealth("codex", signedIn, typeReady) as Record<string, unknown>
    expect(h.ready).toBe(true)
    expect(h.auth_mode).toBe("cli_login")
    // Not the "direct" the type's key verdict carried.
    expect(h.execution_mode).toBe("subprocess")
  })

  it("asks to sign in when the CLI is signed out, however ready the type is", () => {
    const h = resolver({ OPENAI_API_KEY: "sk-old" }, { loginIsAuthed: () => false })
      .reconcileAgentHealth("codex", signedIn, typeReady) as Record<string, unknown>
    expect(h.ready).toBe(false)
    expect(h.reason).toBe("login_required")
    // Not the type's key it will never be given.
    expect(h.auth_mode).toBeNull()
    expect(h.auth_status).toBe("no_credentials")
    expect(h.execution_mode).toBe("unavailable")
  })

  it("runs a sign-in found by the launcher in a subprocess, never direct", () => {
    // Core health not populated yet, and a core verdict with no auth_mode.
    const loggedIn = resolver({}, { loginIsAuthed: () => true })
    const pending = loggedIn.reconcileAgentHealth("codex", signedIn, null) as Record<string, unknown>
    expect(pending.auth_mode).toBe("cli_login")
    expect(pending.execution_mode).toBe("subprocess")
    const filled = loggedIn.reconcileAgentHealth("codex", {},
      { installed: true, ready: true, execution_mode: "direct" }) as Record<string, unknown>
    expect(filled.auth_mode).toBe("cli_login")
    expect(filled.execution_mode).toBe("subprocess")
  })

  it("reads CLI login for a sign-in agent with no status probe (Gemini)", () => {
    const h = resolver({ GEMINI_API_KEY: "g-old" })
      .reconcileAgentHealth("gemini", signedIn, typeReady) as Record<string, unknown>
    expect(h.auth_mode).toBe("cli_login")
    expect(h.execution_mode).toBe("subprocess")
  })

  it("leaves an agent without the marker on the type's key", () => {
    const h = resolver({ OPENAI_API_KEY: "sk-old" }, { loginIsAuthed: () => true })
      .reconcileAgentHealth("codex", {}, typeReady) as Record<string, unknown>
    expect(h.auth_mode).toBe("api_key")
  })
})
