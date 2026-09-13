import { describe, expect, it } from "vitest"

import type { CredentialProfile } from "../../shared/credential-import"
import { profilesFromEnv, profilesFromSavedEnv } from "./env-profiles"
import { parseEnvText } from "./env-text"
import { parseEnvBlock } from "./shell-env"

const source = { kind: "paste" as const, ref: "" }
const brief = (p: CredentialProfile): string[] => [p.vendor, p.protocol, p.baseUrl, p.model, p.apiKey]

describe("parseEnvText", () => {
  it("reads shell, .env, PowerShell and cmd assignments", () => {
    expect(
      parseEnvText(
        [
          "# relay setup",
          'export ANTHROPIC_BASE_URL="https://relay.example.com"',
          "ANTHROPIC_AUTH_TOKEN=sk-relay-000001 # from the dashboard",
          '$env:OPENAI_API_KEY = "sk-ps-000001"',
          "set DEEPSEEK_API_KEY=sk-cmd-000001",
        ].join("\n"),
      ),
    ).toEqual({
      ANTHROPIC_BASE_URL: "https://relay.example.com",
      ANTHROPIC_AUTH_TOKEN: "sk-relay-000001",
      OPENAI_API_KEY: "sk-ps-000001",
      DEEPSEEK_API_KEY: "sk-cmd-000001",
    })
  })

  it("reads Claude Code's settings shape, whole or as copied lines", () => {
    const settings = { env: { ANTHROPIC_AUTH_TOKEN: "sk-json-000001", DISABLE_TELEMETRY: 1 } }
    expect(parseEnvText(JSON.stringify(settings))).toEqual({ ANTHROPIC_AUTH_TOKEN: "sk-json-000001" })
    expect(parseEnvText('  "ANTHROPIC_AUTH_TOKEN": "sk-frag-000001",')).toEqual({
      ANTHROPIC_AUTH_TOKEN: "sk-frag-000001",
    })
  })
})

describe("parseEnvBlock — the login shell's env", () => {
  it("reads only what sits between the delimiters", () => {
    const out = "Welcome back\n__OPENAGENTS_IMPORT_ENV__\nA=1\nB=x=y\n__OPENAGENTS_IMPORT_ENV__\nbye"
    expect(parseEnvBlock(out)).toEqual({ A: "1", B: "x=y" })
    expect(parseEnvBlock("a shell that printed nothing useful")).toEqual({})
  })
})

describe("profilesFromEnv", () => {
  it("prefers Claude Code's auth token, and follows the base URL", () => {
    const [p] = profilesFromEnv(
      {
        ANTHROPIC_API_KEY: "sk-ant-direct-0001",
        ANTHROPIC_AUTH_TOKEN: "sk-relay-token-0001",
        ANTHROPIC_BASE_URL: "https://relay.example.com/",
      },
      source,
    )
    expect(brief(p)).toEqual(["relay", "anthropic", "https://relay.example.com", "", "sk-relay-token-0001"])
  })

  it("finds one profile per vendor present", () => {
    const found = profilesFromEnv(
      { OPENROUTER_API_KEY: "sk-or-000000001", GEMINI_API_KEY: "AIza-000000001", UNRELATED_TOKEN: "x" },
      source,
    )
    expect(found.map((p) => p.vendor)).toEqual(["openrouter", "google"])
  })
})

describe("profilesFromSavedEnv — the launcher's own forms", () => {
  it("reads the LLM_* trio's protocol from its URL", () => {
    const [p] = profilesFromSavedEnv(
      { LLM_API_KEY: "sk-llm-000000001", LLM_BASE_URL: "https://api.openai.com/v1", LLM_MODEL: "openai/gpt-5" },
      source,
    )
    expect(brief(p)).toEqual(["openai", "openai", "https://api.openai.com/v1", "gpt-5", "sk-llm-000000001"])
  })

  it("reads a Pi relay's protocol from its API format", () => {
    const [p] = profilesFromSavedEnv(
      {
        PI_PROVIDER: "custom",
        PI_API_KEY: "sk-pi-relay-00001",
        PI_BASE_URL: "https://relay.example.com/v1",
        PI_API_FORMAT: "openai-completions",
      },
      source,
    )
    expect(brief(p).slice(0, 3)).toEqual(["relay", "openai", "https://relay.example.com/v1"])
  })

  it("knows where OpenWorker's providers live", () => {
    const [kimi] = profilesFromSavedEnv({ OPENWORKER_PROVIDER: "kimi", OPENWORKER_API_KEY: "sk-kimi-00000001" }, source)
    expect(kimi.vendor).toBe("moonshot")
    const [xai] = profilesFromSavedEnv({ OPENWORKER_PROVIDER: "xai", OPENWORKER_API_KEY: "xai-key-00000001" }, source)
    expect(brief(xai).slice(0, 3)).toEqual(["relay", "openai", "https://api.x.ai/v1"])
  })

  it("maps Cline's provider ids", () => {
    const [p] = profilesFromSavedEnv({ CLINE_PROVIDER: "openai-native", CLINE_API_KEY: "sk-cline-0000001" }, source)
    expect(p.vendor).toBe("openai")
  })
})
