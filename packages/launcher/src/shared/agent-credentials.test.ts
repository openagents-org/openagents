import { describe, it, expect } from "vitest"

import {
  agentCredentials,
  credentialErrors,
  endpointMismatch,
  isAdvancedField,
  isUnprobeable,
  sortCredentialFields,
} from "./agent-credentials"

describe("isUnprobeable", () => {
  it("knows which agents have nothing to test against", () => {
    // Their vendors publish no key-check endpoint, so a "Test connection"
    // button for them is a button that cannot pass.
    for (const type of ["codebuddy", "cursor", "amp", "commandcode", "copilot"])
      expect(isUnprobeable(type)).toBe(true)
  })

  it("leaves every key+endpoint agent probeable", () => {
    for (const type of ["codex", "opencode", "openclaw", "kimi", "claude"])
      expect(isUnprobeable(type)).toBe(false)
  })

  it("treats an unknown agent as an ordinary OpenAI-compatible one", () => {
    // A new agent should work before anyone remembers to list it here.
    expect(agentCredentials("something-new")).toEqual({
      endpoint: "openai",
      probeable: "always",
    })
  })
})

/**
 * The mistake that started this: a model-gateway key and URL pasted into
 * CodeBuddy, whose endpoint field takes another CodeBuddy deployment. Nothing
 * in the product said it could not work, so it was found by trying.
 */
describe("endpointMismatch", () => {
  it("refuses a model gateway in a platform endpoint field", () => {
    expect(
      endpointMismatch("codebuddy", "https://api-gateway.openagents.org/v1"),
    ).toBe("gatewayIntoPlatform")
    // Recognised by shape as well as by host: /v1 is what every
    // OpenAI-compatible endpoint carries and no vendor console does.
    expect(endpointMismatch("codebuddy", "https://relay.example.com/v1")).toBe(
      "gatewayIntoPlatform",
    )
    expect(endpointMismatch("amp", "https://api.openai.com/v1")).toBe(
      "gatewayIntoPlatform",
    )
  })

  it("leaves a real vendor deployment alone", () => {
    // Any company's internal CodeBuddy is a host we cannot validate, so
    // guessing would block the field's actual purpose.
    expect(endpointMismatch("codebuddy", "https://www.codebuddy.cn")).toBeNull()
    expect(
      endpointMismatch("codebuddy", "https://codebuddy.acme.internal"),
    ).toBeNull()
  })

  it("says nothing about agents that DO take a model endpoint", () => {
    expect(
      endpointMismatch("opencode", "https://api-gateway.openagents.org/v1"),
    ).toBeNull()
    expect(endpointMismatch("codex", "https://relay.example.com/v1")).toBeNull()
  })

  it("stays quiet on a blank or half-typed value", () => {
    expect(endpointMismatch("codebuddy", "")).toBeNull()
    expect(endpointMismatch("codebuddy", "https://")).toBeNull()
  })
})

describe("sortCredentialFields", () => {
  it("puts the endpoint above the tuning knobs it was buried under", () => {
    // CodeBuddy's registry order, which left BASE_URL last — below two
    // advanced options and off the bottom of a scrolling dialog.
    const fields = [
      { name: "CODEBUDDY_REGION" },
      { name: "CODEBUDDY_API_KEY" },
      { name: "CODEBUDDY_AUTH_TOKEN" },
      { name: "CODEBUDDY_MODEL" },
      { name: "CODEBUDDY_EFFORT" },
      { name: "CODEBUDDY_MAX_TURNS" },
      { name: "CODEBUDDY_BASE_URL" },
    ]
    expect(sortCredentialFields(fields).map((f) => f.name)).toEqual([
      "CODEBUDDY_REGION",
      "CODEBUDDY_API_KEY",
      "CODEBUDDY_AUTH_TOKEN",
      "CODEBUDDY_BASE_URL",
      "CODEBUDDY_MODEL",
      "CODEBUDDY_EFFORT",
      "CODEBUDDY_MAX_TURNS",
    ])
  })

  it("keeps a form that was already in order exactly as it was", () => {
    const fields = [
      { name: "LLM_API_KEY" },
      { name: "LLM_BASE_URL" },
      { name: "LLM_MODEL" },
    ]
    expect(sortCredentialFields(fields).map((f) => f.name)).toEqual([
      "LLM_API_KEY",
      "LLM_BASE_URL",
      "LLM_MODEL",
    ])
  })

  it("is stable among fields of equal rank", () => {
    const fields = [{ name: "B_EFFORT" }, { name: "A_MODE" }]
    expect(sortCredentialFields(fields).map((f) => f.name)).toEqual([
      "B_EFFORT",
      "A_MODE",
    ])
  })
})

/**
 * The hard block. A warning under a field the user already filled in arrives
 * too late — they had to believe the field would work in order to type in it.
 */
describe("credentialErrors", () => {
  it("names the field that cannot work, so the save can be refused", () => {
    expect(
      credentialErrors("codebuddy", {
        CODEBUDDY_API_KEY: "sk-demo-abc",
        CODEBUDDY_BASE_URL: "https://api-gateway.openagents.org/v1",
      }),
    ).toEqual({ CODEBUDDY_BASE_URL: "gatewayIntoPlatform" })
  })

  it("passes a form with no endpoint set at all", () => {
    expect(
      credentialErrors("codebuddy", {
        CODEBUDDY_API_KEY: "sk-real",
        CODEBUDDY_MODEL: "default-model",
      }),
    ).toEqual({})
  })

  it("never blocks an agent that takes a model endpoint", () => {
    expect(
      credentialErrors("opencode", {
        LLM_API_KEY: "sk-gw",
        LLM_BASE_URL: "https://api-gateway.openagents.org/v1",
      }),
    ).toEqual({})
  })
})

describe("isAdvancedField", () => {
  it("hides a hosted platform's endpoint until it is asked for", () => {
    // Sitting beside the credential fields is what made a model-gateway URL
    // look like something that might work here.
    expect(isAdvancedField("codebuddy", "CODEBUDDY_BASE_URL")).toBe(true)
    expect(isAdvancedField("cursor", "CURSOR_API_ENDPOINT")).toBe(true)
    expect(isAdvancedField("amp", "AMP_URL")).toBe(true)
  })

  it("leaves credentials and models on screen", () => {
    expect(isAdvancedField("codebuddy", "CODEBUDDY_API_KEY")).toBe(false)
    expect(isAdvancedField("codebuddy", "CODEBUDDY_MODEL")).toBe(false)
  })

  it("never hides the endpoint of an agent that needs one", () => {
    // For these it is the whole point of the form.
    expect(isAdvancedField("opencode", "LLM_BASE_URL")).toBe(false)
    expect(isAdvancedField("codex", "OPENAI_BASE_URL")).toBe(false)
  })
})
