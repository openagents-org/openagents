import { describe, expect, it } from "vitest"

import { dshMessagesBase, dshModelsBase, dshUsesOpenAiGateway } from "./deepseek-harness-base"

describe("dshMessagesBase", () => {
  it("sends blank and DeepSeek's own roots to its Anthropic endpoint", () => {
    for (const base of ["", "https://api.deepseek.com", "https://api.deepseek.com/v1/"])
      expect(dshMessagesBase(base)).toBe("https://api.deepseek.com/anthropic")
  })

  it("leaves a gateway as typed", () => {
    expect(dshMessagesBase("https://relay.example.com/anthropic")).toBe("https://relay.example.com/anthropic")
  })
})

describe("dshModelsBase", () => {
  it("lists DeepSeek's models from its OpenAI-style root, whichever form was typed", () => {
    for (const base of ["", "https://api.deepseek.com", "https://api.deepseek.com/anthropic"])
      expect(dshModelsBase(base)).toBe("https://api.deepseek.com/v1")
  })

  it("leaves a gateway as typed", () => {
    expect(dshModelsBase("https://relay.example.com/v1")).toBe("https://relay.example.com/v1")
  })
})

describe("dshUsesOpenAiGateway", () => {
  it("is true for a versioned gateway such as OpenAgents credits", () => {
    for (const base of ["https://api-gateway.openagents.org/v1", "https://relay.example.com/v1/"])
      expect(dshUsesOpenAiGateway(base)).toBe(true)
  })

  it("is false for DeepSeek's own host and Anthropic-style gateways", () => {
    for (const base of ["", "https://api.deepseek.com/v1", "https://api.deepseek.com/anthropic", "https://relay.example.com/anthropic", "nonsense"])
      expect(dshUsesOpenAiGateway(base)).toBe(false)
  })
})
