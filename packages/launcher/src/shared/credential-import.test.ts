import { describe, expect, it } from "vitest"

import {
  credentialIdentity,
  makeProfile,
  maskKey,
  vendorFromBase,
  type CredentialProfile,
  type Protocol,
  type Vendor,
} from "./credential-import"
import { canImportCredentials, importPatch } from "./credential-import-targets"

const source = { kind: "shell" as const, ref: "" }

function profile(
  protocol: Protocol,
  vendor: Vendor,
  baseUrl = "",
  model = "",
): CredentialProfile {
  const p = makeProfile({ protocol, vendor, apiKey: "sk-test-key-000001", baseUrl, model, source })
  if (!p) throw new Error("fixture is not a profile")
  return p
}

describe("what a found credential is", () => {
  it("names the issuer from the endpoint's host", () => {
    expect(vendorFromBase("https://api.moonshot.cn/v1")).toBe("moonshot")
    expect(vendorFromBase("https://api.anthropic.com")).toBe("anthropic")
    // Azure's OpenAI hosts are someone else's deployment, not OpenAI's API.
    expect(vendorFromBase("https://acme.openai.azure.com")).toBe("relay")
    expect(vendorFromBase("not a url")).toBeNull()
  })

  it("lets the base URL outrank the variable name", () => {
    // An OPENAI_API_KEY next to a relay's base URL is the relay's key.
    expect(profile("openai", "openai", "https://relay.example.com/v1").vendor).toBe("relay")
    // A vendor's host in another protocol is no native provider's endpoint.
    expect(profile("anthropic", "anthropic", "https://api.deepseek.com/anthropic").vendor).toBe("relay")
  })

  it("is not a credential without a key, or a relay without an endpoint", () => {
    expect(makeProfile({ protocol: "openai", vendor: "openai", apiKey: " ", source })).toBeNull()
    expect(makeProfile({ protocol: "openai", vendor: "relay", apiKey: "k", source })).toBeNull()
  })

  it("unqualifies a vendor's model id but keeps a relay's", () => {
    expect(profile("openai", "openai", "", "openai/gpt-5").model).toBe("gpt-5")
    expect(profile("openai", "openrouter", "", "anthropic/claude-sonnet-5").model).toBe(
      "anthropic/claude-sonnet-5",
    )
  })

  it("treats the same key at the same endpoint as one credential", () => {
    const a = profile("anthropic", "relay", "https://relay.example.com/v1")
    const b = profile("anthropic", "relay", "https://relay.example.com/")
    expect(credentialIdentity(a)).toBe(credentialIdentity(b))
  })

  it("never shows more of a key than its prefix and tail", () => {
    expect(maskKey("sk-ant-api03-abcdefghijklmnop")).toBe("sk-ant-…mnop")
    expect(maskKey("AIzaSyABCDEFGHIJ1234")).toBe("AIz…1234")
    expect(maskKey("short-key")).toBe("••••")
  })
})

describe("which agents can take which credential", () => {
  it("gives Claude any Anthropic-protocol key, and nothing else", () => {
    expect(importPatch("claude", profile("anthropic", "relay", "https://relay.example.com"))).toEqual({
      ANTHROPIC_API_KEY: "sk-test-key-000001",
      ANTHROPIC_BASE_URL: "https://relay.example.com",
      ANTHROPIC_MODEL: "",
    })
    expect(importPatch("claude", profile("openai", "openai"))).toBeNull()
  })

  it("gives the LLM_* forms any OpenAI-compatible key with its endpoint", () => {
    expect(importPatch("opencode", profile("openai", "deepseek"))).toEqual({
      LLM_API_KEY: "sk-test-key-000001",
      LLM_BASE_URL: "https://api.deepseek.com",
      LLM_MODEL: "",
    })
    expect(importPatch("openclaw", profile("anthropic", "anthropic"))).toBeNull()
  })

  it("keeps vendor-built agents to their vendor's keys", () => {
    expect(importPatch("kimi", profile("openai", "moonshot", "https://api.moonshot.cn/v1"))).toMatchObject({
      KIMI_BASE_URL: "https://api.moonshot.cn/v1",
    })
    expect(importPatch("kimi", profile("openai", "deepseek"))).toBeNull()
    expect(importPatch("codex", profile("openai", "deepseek"))).toBeNull()
    // Blank means DeepSeek's own endpoint in that form.
    expect(importPatch("deepseek", profile("openai", "deepseek"))).toMatchObject({
      DEEPSEEK_BASE_URL: "",
    })
  })

  it("routes relays through Pi's provider for their protocol", () => {
    expect(importPatch("pi", profile("anthropic", "anthropic"))).toMatchObject({
      PI_PROVIDER: "anthropic",
      PI_BASE_URL: "",
      PI_API_FORMAT: "auto",
    })
    expect(importPatch("pi", profile("anthropic", "relay", "https://relay.example.com"))).toMatchObject({
      PI_PROVIDER: "anthropic",
      PI_BASE_URL: "https://relay.example.com",
      PI_API_FORMAT: "anthropic-messages",
    })
    expect(importPatch("pi", profile("openai", "moonshot"))).toMatchObject({
      PI_PROVIDER: "openai",
      PI_BASE_URL: "https://api.moonshot.ai/v1",
      PI_API_FORMAT: "openai-completions",
    })
    expect(importPatch("pi", profile("gemini", "relay", "https://gemini.example.com"))).toBeNull()
  })

  it("names OpenWorker's provider and keeps a relay's endpoint", () => {
    expect(importPatch("openworker", profile("openai", "moonshot"))).toMatchObject({
      OPENWORKER_PROVIDER: "kimi",
      OPENWORKER_BASE_URL: "",
    })
    expect(importPatch("openworker", profile("anthropic", "relay", "https://relay.example.com"))).toMatchObject({
      OPENWORKER_PROVIDER: "anthropic",
      OPENWORKER_BASE_URL: "https://relay.example.com",
    })
  })

  it("offers Cline nothing that needs an endpoint its form lacks", () => {
    expect(importPatch("cline", profile("openai", "relay", "https://relay.example.com/v1"))).toBeNull()
    expect(importPatch("cline", profile("openai", "openai"))).toMatchObject({
      CLINE_PROVIDER: "openai-native",
    })
  })

  it("offers nothing to agents only their vendor issues keys for", () => {
    for (const type of ["cursor", "amp", "commandcode", "codebuddy", "copilot"])
      expect(canImportCredentials(type)).toBe(false)
  })
})
