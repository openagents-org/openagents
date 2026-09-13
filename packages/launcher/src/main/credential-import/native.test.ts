import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { CredentialProfile } from "../../shared/credential-import"
import { readNativeProfiles } from "./native"
import { parseTomlStrings } from "./native/codex"

/**
 * Each tool's config, written the way that tool writes it. The files hold fake
 * keys; what is under test is which of them become offers, and as what.
 */
let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "oa-import-"))
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
})

function write(rel: string, content: unknown): void {
  const file = path.join(home, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content))
}

function read(env: Record<string, string> = {}): string[][] {
  return readNativeProfiles({ home, env }).map((p: CredentialProfile) => [
    p.source.ref,
    p.vendor,
    p.protocol,
    p.baseUrl,
    p.model,
    p.apiKey,
  ])
}

describe("reading other tools' own config", () => {
  it("finds nothing on a machine with none of them", () => {
    expect(read()).toEqual([])
  })

  it("reads the env block of Claude Code's settings", () => {
    write(".claude/settings.json", {
      env: {
        ANTHROPIC_AUTH_TOKEN: "sk-relay-claude-0001",
        ANTHROPIC_BASE_URL: "https://relay.example.com",
        ANTHROPIC_MODEL: "claude-opus-5",
      },
    })
    expect(read()).toEqual([
      ["claude", "relay", "anthropic", "https://relay.example.com", "claude-opus-5", "sk-relay-claude-0001"],
    ])
  })

  it("reads codex's API key and the provider its config points at", () => {
    write(".codex/auth.json", { OPENAI_API_KEY: "sk-proj-codex-000001", tokens: null })
    write(
      ".codex/config.toml",
      [
        'model = "gpt-5.5"',
        'model_provider = "siliconflow"',
        "",
        "[model_providers.siliconflow]",
        'name = "SiliconFlow"',
        'base_url = "https://api.siliconflow.cn/v1"',
        'env_key = "SILICONFLOW_API_KEY"',
      ].join("\n"),
    )
    expect(read({ SILICONFLOW_API_KEY: "sf-key-0000000001" })).toEqual([
      ["codex", "relay", "openai", "https://api.siliconflow.cn/v1", "gpt-5.5", "sf-key-0000000001"],
      ["codex", "openai", "openai", "", "", "sk-proj-codex-000001"],
    ])
  })

  it("reads OpenCode's API-key sign-ins and custom providers, skipping OAuth and Zen", () => {
    write(".local/share/opencode/auth.json", {
      anthropic: { type: "api", key: "sk-ant-oc-00000001" },
      openai: { type: "oauth", refresh: "r", access: "a", expires: 1 },
      opencode: { type: "api", key: "zen-key-000000001" },
    })
    write(
      ".config/opencode/opencode.jsonc",
      `{
        // written by hand
        "model": "anthropic/claude-sonnet-5",
        "provider": {
          "gateway": {
            "npm": "@ai-sdk/openai-compatible",
            "options": { "baseURL": "https://gw.example.com/v1", "apiKey": "{env:GW_KEY}" },
          },
        },
      }`,
    )
    expect(read({ GW_KEY: "gw-key-000000001" })).toEqual([
      ["opencode", "anthropic", "anthropic", "", "claude-sonnet-5", "sk-ant-oc-00000001"],
      ["opencode", "relay", "openai", "https://gw.example.com/v1", "", "gw-key-000000001"],
    ])
  })

  it("reads OpenClaw's providers and auth profiles", () => {
    write(".openclaw/openclaw.json", {
      models: {
        providers: {
          custom: { baseUrl: "https://oc.example.com/v1", apiKey: "oc-key-0000000001", api: "openai-completions" },
        },
      },
      agents: { defaults: { model: { primary: "custom/qwen3-max" } } },
    })
    write(".openclaw/agents/main/agent/auth-profiles.json", {
      profiles: {
        "anthropic:manual": { type: "token", provider: "anthropic", token: "sk-ant-claw-000001" },
        "openai:setup": { type: "api_key", provider: "openai", key: "sk-claw-openai-0001" },
      },
    })
    expect(read()).toEqual([
      ["openclaw", "relay", "openai", "https://oc.example.com/v1", "qwen3-max", "oc-key-0000000001"],
      ["openclaw", "openai", "openai", "", "", "sk-claw-openai-0001"],
      ["openclaw", "anthropic", "anthropic", "", "", "sk-ant-claw-000001"],
    ])
  })

  it("reads Pi's key sign-ins and declared providers", () => {
    write(".pi/agent/auth.json", {
      deepseek: { type: "api_key", key: "sk-pi-deepseek-0001" },
      anthropic: { type: "oauth", access: "x" },
    })
    write(".pi/agent/models.json", {
      providers: {
        relay: { baseUrl: "https://pi.example.com", api: "anthropic-messages", apiKey: "PI_RELAY_KEY", models: [{ id: "claude-x" }] },
      },
    })
    expect(read({ PI_RELAY_KEY: "pi-relay-0000000001" })).toEqual([
      ["pi", "deepseek", "openai", "", "", "sk-pi-deepseek-0001"],
      ["pi", "relay", "anthropic", "https://pi.example.com", "claude-x", "pi-relay-0000000001"],
    ])
  })

  it("reads keys kept in .env files, and Cline's provider settings", () => {
    write(".gemini/.env", 'GEMINI_API_KEY="AIzaSy-gemini-000001"\n')
    write(".hermes/.env", "# hermes setup\nOPENROUTER_API_KEY=sk-or-hermes-00001\n")
    write(".cline/data/settings/providers.json", {
      providers: {
        openrouter: { settings: { apiKey: "sk-or-cline-000001", model: "anthropic/claude-sonnet-5" } },
        cline: { settings: {} },
      },
      lastUsedProvider: "openrouter",
    })
    expect(read()).toEqual([
      ["gemini", "google", "gemini", "", "", "AIzaSy-gemini-000001"],
      ["cline", "openrouter", "openai", "", "anthropic/claude-sonnet-5", "sk-or-cline-000001"],
      ["hermes", "openrouter", "openai", "", "", "sk-or-hermes-00001"],
    ])
  })

  it("costs a reshaped or corrupt file only its own tool's offers", () => {
    write(".claude/settings.json", "{ not json")
    write(".codex/auth.json", { OPENAI_API_KEY: 42 })
    write(".gemini/.env", "GEMINI_API_KEY=AIzaSy-gemini-000002\n")
    expect(read().map((row) => row[0])).toEqual(["gemini"])
  })
})

describe("parseTomlStrings", () => {
  it("keeps string assignments per table and skips arrays of tables", () => {
    expect(
      parseTomlStrings(
        [
          'model = "gpt-5"',
          "[model_providers.\"my-relay\"]",
          "base_url = 'https://relay.example.com/v1' # comment",
          "[[profiles]]",
          'model = "ignored"',
        ].join("\n"),
      ),
    ).toEqual({
      "": { model: "gpt-5" },
      "model_providers.my-relay": { base_url: "https://relay.example.com/v1" },
    })
  })
})
