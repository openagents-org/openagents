import { describe, expect, it } from "vitest"

import type { AgentState } from "@renderer/types"
import { summarizeAgents } from "./agents"

const agents = (...states: AgentState[]) => states.map((state) => ({ state }))

describe("summarizeAgents", () => {
  it("counts running agents first, idle and online included", () => {
    expect(summarizeAgents(agents("running", "idle", "error", "stopped"))).toEqual({ state: "running", count: 2 })
  })

  it("reports starting agents when none is running yet", () => {
    expect(summarizeAgents(agents("starting", "reconnecting", "error"))).toEqual({ state: "starting", count: 2 })
  })

  it("reports a failed agent as an error, not as a stopped daemon", () => {
    expect(summarizeAgents(agents("error", "stopped"))).toEqual({ state: "error", count: 1 })
  })

  it("tells agents that are all stopped apart from having none", () => {
    expect(summarizeAgents(agents("stopped"))).toEqual({ state: "stopped", count: 0 })
    expect(summarizeAgents([])).toEqual({ state: "none", count: 0 })
  })
})
