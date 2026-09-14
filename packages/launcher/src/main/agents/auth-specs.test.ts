import { describe, expect, it } from "vitest"

import {
  CORE_AGENTS,
  CREDENTIAL_ENV,
  DUAL_LOGIN_AGENTS,
  keylessAuth,
  launcherAuthFields,
} from "./auth-specs"
import { loginVerdict } from "./login-probe"

/**
 * Field ORDER is part of the contract, not cosmetics.
 *
 * The model picker's empty state says "fill in the API key above, then the
 * models this endpoint serves will load" — because the list is fetched FROM the
 * key and base URL. Pi shipped with its model field above its key, so that
 * sentence pointed at nothing: the input it named was further down the form.
 */
describe("launcher auth field order", () => {
  const nameOf = (f: Record<string, unknown>): string => String(f.name || "")

  for (const type of CORE_AGENTS) {
    const fields = launcherAuthFields(type) as Array<
      Record<string, unknown>
    > | null
    if (!fields) continue

    it(`${type}: credentials come before the model field`, () => {
      const names = fields.map(nameOf)
      const model = names.findIndex((n) => n.endsWith("_MODEL"))
      if (model < 0) return
      const key = names.findIndex(
        (n) => n.endsWith("_API_KEY") || n.endsWith("_TOKEN"),
      )
      const base = names.findIndex((n) => n.endsWith("_BASE_URL"))
      // Only assert on inputs this agent actually has.
      if (key >= 0) expect(key).toBeLessThan(model)
      if (base >= 0) expect(base).toBeLessThan(model)
    })
  }

  it("pi asks for provider, key, endpoint, protocol, then model", () => {
    // Pinned in full: this is the one that was wrong, and the order is also the
    // order the fields depend on each other in.
    const names = (launcherAuthFields("pi") as Array<Record<string, unknown>>)
      .map(nameOf)
      .filter((n) => n !== "PI_THINKING" && n !== "PI_TRUST_PROJECT")
    expect(names).toEqual([
      "PI_PROVIDER",
      "PI_API_KEY",
      "PI_BASE_URL",
      "PI_API_FORMAT",
      "PI_MODEL",
    ])
  })
})

/**
 * Command Code's `status`, verbatim (v1.36.0). `whoami` used to be the probe and
 * reports an unreachable account service as "Error: Connection error." on a
 * CLEAN exit — which, with only a signed-out pattern to go on, reads as SIGNED
 * IN. `status` says which of the three things happened.
 */
describe("commandcode sign-in probe", () => {
  const spec = DUAL_LOGIN_AGENTS.commandcode
  const SIGNED_IN =
    "✔ Authentication verified\n✔ Authenticated as ada\n  Provider: Command Code\n"
  const SIGNED_OUT =
    "✖ Not authenticated\n\nRun cmd auth login to authenticate.\n"
  const UNREACHABLE = "✖ Status check failed: fetch failed\n"

  it("reads the CLI's own authentication status", () => {
    expect(loginVerdict(spec, SIGNED_IN, 0)).toBe(true)
    expect(loginVerdict(spec, SIGNED_OUT, 1)).toBe(false)
  })

  it("never lets the signed-out copy match the signed-in pattern", () => {
    // "Not authenticated" / "to authenticate" both contain the word; only the
    // verified / "as <user>" wording may stand for success.
    expect(spec.loggedInPattern?.test(SIGNED_OUT)).toBe(false)
  })

  it("stays unknown when the account service is unreachable", () => {
    // Not a verdict — health.ts treats unknown optimistically, so an offline
    // machine never reports a signed-in user as signed out.
    expect(loginVerdict(spec, UNREACHABLE, 1)).toBe(null)
  })
})

describe("keyless auth paths", () => {
  it("counts OpenWorker's no-key providers as configured", () => {
    expect(
      keylessAuth("openworker", { OPENWORKER_PROVIDER: "ollama" }),
    ).toEqual({ keyless: true, authMode: null })
    // Reusing a ChatGPT sign-in out of a state dir really is a CLI login.
    expect(
      keylessAuth("openworker", { OPENWORKER_PROVIDER: "openai-codex" }),
    ).toEqual({ keyless: true, authMode: "cli_login" })
  })

  it("still demands a key for every other provider, and by default", () => {
    expect(
      keylessAuth("openworker", { OPENWORKER_PROVIDER: "anthropic" }).keyless,
    ).toBe(false)
    // Unset falls through to OpenWorker's own default, which is a key provider.
    expect(keylessAuth("openworker", {}).keyless).toBe(false)
    expect(
      keylessAuth("claude", { OPENWORKER_PROVIDER: "ollama" }).keyless,
    ).toBe(false)
  })

  it("counts an OpenCode Zen model as needing no key", () => {
    expect(
      keylessAuth("opencode", { LLM_MODEL: "opencode/big-pickle" }),
    ).toEqual({ keyless: true, authMode: null })
    expect(
      keylessAuth("opencode", { LLM_MODEL: "anthropic/claude-sonnet-5" })
        .keyless,
    ).toBe(false)
    expect(keylessAuth("opencode", { LLM_MODEL: "gpt-5" }).keyless).toBe(false)
  })

  it("lets the instance env win over the type env", () => {
    // Configure saves per-instance; onboarding saved per-type.
    expect(
      keylessAuth(
        "openworker",
        { OPENWORKER_PROVIDER: "openai" },
        { OPENWORKER_PROVIDER: "ollama" },
      ).keyless,
    ).toBe(false)
  })
})

describe("credential env", () => {
  it("counts CodeBuddy's platform token, which is not an API key", () => {
    // check_ready lists it as a first-class auth path; judging the agent on
    // *_API_KEY alone left a token-configured agent reading "Login required".
    expect(CREDENTIAL_ENV.test("CODEBUDDY_AUTH_TOKEN")).toBe(true)
    // Still narrow: a GitHub token authenticates nothing about the model.
    expect(CREDENTIAL_ENV.test("GITHUB_TOKEN")).toBe(false)
  })
})

describe("fields a sign-in cannot make optional", () => {
  const required = (type: string): Record<string, unknown> =>
    Object.fromEntries(
      (launcherAuthFields(type) as Array<Record<string, unknown>>).map((f) => [
        f.name,
        f.required,
      ]),
    )

  it("keeps OpenCode's model required — `opencode run` has no default", () => {
    expect(required("opencode")).toEqual({
      LLM_API_KEY: false,
      LLM_BASE_URL: false,
      LLM_MODEL: true,
    })
  })

  it("leaves the other dual-login agents' fields optional", () => {
    for (const type of ["claude", "codex", "gemini"])
      expect(Object.values(required(type)).some(Boolean)).toBe(false)
  })
})
