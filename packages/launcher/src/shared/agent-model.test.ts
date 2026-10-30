import { describe, expect, it } from "vitest"

import { deriveAgentModel, deriveModelFromEnv, listedAgentModel } from "./agent-model"

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

  it("prefers an instance model when the type default uses another model key", () => {
    expect(deriveAgentModel(
      { OPENAI_MODEL: "gpt-old" },
      { LLM_MODEL: "relay-model" },
    )).toBe("relay-model")
  })

  it("matches the shape of the name, for types no list knows about", () => {
    expect(deriveModelFromEnv({ SOMETHINGNEW_MODEL: "brand-new-1" })).toBe(
      "brand-new-1",
    )
  })

  it("ignores the type's model for an agent the core runs without it", () => {
    const typeEnv = { CODEX_MODEL: "old-type-model" }
    // Its model was cleared from the workspace: the CLI's default.
    expect(deriveAgentModel(typeEnv, { LLM_API_KEY: "sk-x", OPENAGENTS_MODEL_MODE: "default" })).toBeNull()
    // Signed in through its CLI: the type's model was picked for a key's endpoint.
    expect(deriveAgentModel(typeEnv, { OPENAGENTS_AUTH_MODE: "cli_login" })).toBeNull()
    // A model of its own still shows.
    expect(deriveAgentModel(typeEnv, { OPENAGENTS_MODEL_MODE: "default", CODEX_MODEL: "gpt-5.5" })).toBe("gpt-5.5")
  })

  it("reads a row of the core's agent list by its own env, not the merged one", () => {
    const typeEnv = { CODEX_MODEL: "old-type-model" }
    // listAgents() hands over the type env merged under the agent's as `env`.
    const row = (own: Record<string, string>) => ({ env: { ...typeEnv, ...own }, instanceEnv: own })
    expect(listedAgentModel(typeEnv, row({ OPENAGENTS_MODEL_MODE: "default" }))).toBeNull()
    expect(listedAgentModel(typeEnv, row({ OPENAGENTS_AUTH_MODE: "cli_login" }))).toBeNull()
    expect(listedAgentModel(typeEnv, row({ OPENAI_API_KEY: "sk-x" }))).toBe("old-type-model")
    // A core too old to send instanceEnv: the merged env, as before.
    expect(listedAgentModel(typeEnv, { env: { ...typeEnv, LLM_MODEL: "relay-model" } })).toBe("old-type-model")
  })

  it("answers null when no model is set, rather than a stray value", () => {
    expect(deriveModelFromEnv({ OPENWORKER_API_KEY: "sk-x" })).toBeNull()
    expect(deriveModelFromEnv({})).toBeNull()
    expect(deriveModelFromEnv(null)).toBeNull()
  })
})
