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
