import { describe, expect, it } from "vitest"

import { deriveModel } from "./agent-model"
import type { Agent } from "@renderer/types"

const agent = (extra: Partial<Agent>): Agent =>
  ({ name: "a", type: "openworker", state: "running", health: null, ...extra }) as Agent

describe("deriveModel", () => {
  it("uses the main process's answer, which has seen the type env too", () => {
    expect(deriveModel(agent({ model: "deepseek:deepseek-4-flash" }))).toBe(
      "deepseek:deepseek-4-flash",
    )
  })

  it("still reads the row's own env, for a list cached by an older build", () => {
    expect(deriveModel(agent({ env: { OPENWORKER_MODEL: "deepseek-3.2" } }))).toBe(
      "deepseek-3.2",
    )
  })

  it("takes the main process's 'no model' as the answer, not the merged env's", () => {
    expect(deriveModel(agent({ model: null, env: { CODEX_MODEL: "old-type-model" } }))).toBeNull()
  })

  it("reports nothing when neither knows", () => {
    expect(deriveModel(agent({}))).toBeNull()
  })
})
