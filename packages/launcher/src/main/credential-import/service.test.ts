import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"

import registry from "../../../../agent-connector/registry.json"
import { makeProfile, type Protocol, type Vendor } from "../../shared/credential-import"
import { IMPORT_TARGET_AGENTS, importPatch } from "../../shared/credential-import-targets"
import { launcherAuthFields } from "../agents/auth-specs"
import { CredentialImportService, type CredentialImportDeps } from "./service"

const home = fs.mkdtempSync(path.join(os.tmpdir(), "oa-import-service-"))
afterAll(() => fs.rmSync(home, { recursive: true, force: true }))

const SHARED_ANTHROPIC = "sk-ant-shared-000001"

function service(overrides: Partial<CredentialImportDeps> = {}): CredentialImportService {
  return new CredentialImportService({
    home,
    shellEnv: async () => ({ ANTHROPIC_API_KEY: SHARED_ANTHROPIC, OPENAI_API_KEY: "sk-shell-openai-0001" }),
    // Pi's form mirrors its key into the vendor variable — the same key, twice.
    savedEnvs: () => [
      {
        env: { PI_PROVIDER: "anthropic", PI_API_KEY: SHARED_ANTHROPIC, ANTHROPIC_API_KEY: SHARED_ANTHROPIC },
        source: { kind: "agent", ref: "pi", label: "Pi" },
      },
    ],
    ...overrides,
  })
}

describe("CredentialImportService", () => {
  it("offers one candidate per credential, with every place it was found", async () => {
    const found = await service().scan("claude")
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      vendor: "anthropic",
      baseUrl: "https://api.anthropic.com",
      keyHint: "sk-ant-…0001",
      sources: [{ kind: "agent", ref: "pi", label: "Pi" }, { kind: "shell", ref: "" }],
    })
  })

  it("never puts a key in what it hands the renderer", async () => {
    const found = await service().scan("opencode")
    expect(JSON.stringify(found)).not.toContain("sk-shell-openai-0001")
  })

  it("offers only what the agent's form can use", async () => {
    const found = await service().scan("opencode")
    expect(found.map((c) => c.vendor)).toEqual(["openai"])
    expect(await service().scan("cursor")).toEqual([])
  })

  it("resolves a pick to form values, and only from the latest scan", async () => {
    const svc = service()
    const [first] = await svc.scan("claude")
    expect(svc.resolve("claude", first.id)).toMatchObject({ ANTHROPIC_API_KEY: SHARED_ANTHROPIC })
    expect(svc.resolve("claude", "no-such-id")).toBeNull()
    await svc.scan("claude")
    expect(svc.resolve("claude", first.id)).toBeNull()
  })

  it("adds pasted configuration without dropping the scan's offers", async () => {
    const svc = service()
    const [scanned] = await svc.scan("opencode")
    const [pasted] = svc.parse(
      "opencode",
      "export OPENAI_BASE_URL=https://relay.example.com/v1\nexport OPENAI_API_KEY=sk-pasted-relay-0001",
    )
    expect(pasted).toMatchObject({ vendor: "relay", sources: [{ kind: "paste", ref: "" }] })
    expect(svc.resolve("opencode", pasted.id)).toMatchObject({ LLM_BASE_URL: "https://relay.example.com/v1" })
    expect(svc.resolve("opencode", scanned.id)).not.toBeNull()
  })

  it("still offers saved credentials when the shell cannot be read", async () => {
    const found = await service({ shellEnv: () => Promise.reject(new Error("no shell")) }).scan("claude")
    expect(found[0].sources).toEqual([{ kind: "agent", ref: "pi", label: "Pi" }])
  })
})

/**
 * An import writes env vars by name. A name the agent's form does not have is a
 * value nothing shows, nothing tests, and the save may keep — so every name any
 * credential can produce has to be one of that agent's real fields.
 */
describe("import targets match the forms they fill", () => {
  const entries = (Array.isArray(registry) ? registry : (registry as { agents: unknown[] }).agents) as Array<{
    name: string
    env_config?: Array<{ name: string }>
  }>
  const samples: Array<[Protocol, Vendor, string]> = [
    ["anthropic", "anthropic", ""],
    ["openai", "openai", ""],
    ["gemini", "google", ""],
    ["openai", "deepseek", ""],
    ["openai", "moonshot", "https://api.moonshot.cn/v1"],
    ["openai", "openrouter", ""],
    ["openai", "relay", "https://relay.example.com/v1"],
    ["anthropic", "relay", "https://relay.example.com"],
    ["gemini", "relay", "https://gemini.example.com"],
  ]

  for (const type of IMPORT_TARGET_AGENTS) {
    it(`${type}`, () => {
      const fields = (launcherAuthFields(type) as Array<{ name: string }> | null) ??
        entries.find((e) => e.name === type)?.env_config ?? []
      const names = new Set(fields.map((f) => f.name))
      let offered = 0
      for (const [protocol, vendor, baseUrl] of samples) {
        const p = makeProfile({ protocol, vendor, apiKey: "sk-sample-000001", baseUrl, source: { kind: "shell", ref: "" } })
        const patch = p && importPatch(type, p)
        if (!patch) continue
        offered++
        for (const name of Object.keys(patch)) expect(names).toContain(name)
      }
      expect(offered).toBeGreaterThan(0)
    })
  }
})
