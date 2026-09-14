import { describe, expect, it } from "vitest"

import { deriveModelFromEnv } from "./agent-model"

/**
 * Which model an agent runs is the question the Agents list answers with one
 * word — and it answered "—" for an agent that was configured correctly,
 * because the row carries only the instance env while most agents are
 * configured at the type level. The user then had only the agent's own word
 * for it, and the agent guessed (a deepseek-configured agent announced itself
 * as Claude). These cover the resolution the main process now applies to the
 * two envs merged.
 */
describe("deriveModelFromEnv", () => {
  it("finds the model an agent configured at the type level", () => {
    expect(
      deriveModelFromEnv({
        OPENWORKER_PROVIDER: "deepseek",
        OPENWORKER_MODEL: "deepseek-4-flash",
      }),
    ).toBe("deepseek-4-flash")
  })

  it("lets the instance override the type, as the daemon does when spawning", () => {
    const typeEnv = { ANTHROPIC_MODEL: "claude-sonnet-5" }
    const instanceEnv = { ANTHROPIC_MODEL: "claude-opus-5" }
    expect(deriveModelFromEnv({ ...typeEnv, ...instanceEnv })).toBe(
      "claude-opus-5",
    )
  })

  it("matches the shape of the name, for types no list knows about", () => {
    expect(deriveModelFromEnv({ SOMETHINGNEW_MODEL: "brand-new-1" })).toBe(
      "brand-new-1",
    )
  })

  it("answers null when no model is set, rather than a stray value", () => {
    expect(deriveModelFromEnv({ OPENWORKER_API_KEY: "sk-x" })).toBeNull()
    expect(deriveModelFromEnv({})).toBeNull()
    expect(deriveModelFromEnv(null)).toBeNull()
  })
})
