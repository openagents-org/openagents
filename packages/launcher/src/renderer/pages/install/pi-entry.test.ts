import { describe, it, expect } from "vitest"

import BUNDLED_REGISTRY from "../../../../../agent-connector/registry.json"
import EN_AGENT_META from "../../i18n/locales/en/agentMeta.json"
import ZH_AGENT_META from "../../i18n/locales/zh/agentMeta.json"
import { entryStatus, platformsOf, runtimeOf, STATUS_VARIANT } from "./entry-meta"
import {
  parseNpmInstallCommand,
  resolveNpmPackage,
  globalUninstallCommand,
} from "../../../shared/npm-install-spec"
import type { CatalogEntry } from "../../types"

/**
 * The Pi catalog entry, read from the registry the launcher actually bundles.
 * These assertions are what stand between a hand-synced registry.json (the
 * build:registry script cannot run in this repo) and a broken Install page.
 */
const PI = (BUNDLED_REGISTRY as unknown as Array<Record<string, unknown>>).find(
  (e) => e.name === "pi",
) as unknown as CatalogEntry & {
  install: Record<string, string | string[]>
  check_ready: Record<string, unknown>
  env_config: Array<Record<string, unknown>>
}

describe("Pi registry entry", () => {
  it("is present in the bundled registry", () => {
    expect(PI).toBeTruthy()
    expect(PI.label).toBe("Pi")
  })

  it("declares an npm install spec the launcher can parse on every platform", () => {
    for (const key of ["macos", "linux", "windows"] as const) {
      const cmd = PI.install[key] as string
      expect(parseNpmInstallCommand(cmd)).toEqual({
        pkg: "@earendil-works/pi-coding-agent",
        spec: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      })
    }
  })

  it("resolves to the real npm package (never to the `pi` binary name)", () => {
    for (const platformKey of ["macos", "linux", "windows"]) {
      expect(resolveNpmPackage(PI.install, platformKey)).toBe(
        "@earendil-works/pi-coding-agent",
      )
    }
    expect(globalUninstallCommand(PI.install.linux as string)).toBe(
      "npm uninstall -g @earendil-works/pi-coding-agent",
    )
  })

  it("installs the identical pinned version on all three platforms", () => {
    // Pi is now a supported download, so the three commands are what users
    // actually run. A per-platform drift here is invisible until someone on
    // that platform gets a different Pi than everyone else.
    const specs = (["macos", "linux", "windows"] as const).map(
      (key) => parseNpmInstallCommand(PI.install[key] as string)?.spec,
    )
    expect(new Set(specs).size).toBe(1)

    // The pinned version must satisfy the registry's own floor, or readiness
    // checks pass against a Pi too old to speak the RPC mode the adapter uses.
    const asNumbers = (v: string): number[] => v.split(".").map(Number)
    const [pinned, floor] = [
      asNumbers(specs[0] as string),
      asNumbers(PI.install.min_version as string),
    ]
    expect(
      pinned[0] > floor[0] ||
        (pinned[0] === floor[0] &&
          (pinned[1] > floor[1] ||
            (pinned[1] === floor[1] && pinned[2] >= floor[2]))),
    ).toBe(true)
  })

  it("carries a Windows-specific verify command", () => {
    // `>/dev/null 2>&1` is not valid in cmd.exe; without verify_win the check
    // fails on Windows for a Pi that is installed correctly.
    expect(PI.install.verify_win).toBeTruthy()
    expect(PI.install.verify_win as string).not.toContain("/dev/null")
  })

  it("requires the Node runtime and supports all three platforms", () => {
    expect(runtimeOf(PI as CatalogEntry)).toBe("nodejs")
    expect(platformsOf(PI as CatalogEntry).sort()).toEqual([
      "Linux",
      "Windows",
      "macOS",
    ])
  })

  it("keeps every credential field marked as a password", () => {
    const secretish = PI.env_config.filter((f) =>
      /_API_KEY$/.test(String(f.name)),
    )
    expect(secretish.length).toBeGreaterThan(0)
    for (const field of secretish) expect(field.password).toBe(true)
    // The adapter-read configuration fields are plain text, not secrets.
    const provider = PI.env_config.find((f) => f.name === "PI_PROVIDER")
    expect(provider?.password).toBeUndefined()
  })

  it("never ships a literal credential in the catalog", () => {
    const json = JSON.stringify(PI)
    expect(json).not.toMatch(/sk-[A-Za-z0-9-]{10,}/)
    expect(json).not.toMatch(/--api-key/)
  })

  it("points readiness at Pi's own auth file without parsing it", () => {
    expect(PI.check_ready.creds_file).toBe("~/.pi/agent/auth.json")
    expect(PI.check_ready.creds_no_parse).toBe(true)
  })
})

describe("Pi in the Install marketplace", () => {
  /** How getCatalog stamps a non-core agent (CORE_AGENTS in agent-manager). */
  const asComingSoon = (): CatalogEntry =>
    ({ ...(PI as CatalogEntry), comingSoon: true, installed: false })
  const asCore = (installed: boolean): CatalogEntry =>
    ({ ...(PI as CatalogEntry), comingSoon: false, installed })

  it("renders as a disabled 'coming soon' row while it is not a core agent", () => {
    const status = entryStatus(asComingSoon(), false)
    expect(status).toBe("comingSoon")
    expect(STATUS_VARIANT[status]).toBe("muted")
  })

  it("becomes installable the moment it joins CORE_AGENTS", () => {
    expect(entryStatus(asCore(false), false)).toBe("available")
    expect(entryStatus(asCore(true), false)).toBe("installed")
    expect(entryStatus(asCore(true), true)).toBe("update")
  })

  it("has a translated description and env labels in both locales", () => {
    for (const meta of [EN_AGENT_META, ZH_AGENT_META] as Array<{
      descriptions: Record<string, string>
      env: Record<string, { label: string; hint: string }>
    }>) {
      expect(meta.descriptions.pi).toBeTruthy()
      for (const key of [
        "PI_PROVIDER",
        "PI_MODEL",
        "PI_API_FORMAT",
        "PI_BASE_URL",
        "PI_API_KEY",
        "PI_THINKING",
        "PI_TRUST_PROJECT",
      ]) {
        expect(meta.env[key]?.label, key).toBeTruthy()
        expect(meta.env[key]?.hint, key).toBeTruthy()
      }
    }
  })

  it("offers one Launcher-managed key plus provider/API dropdowns", () => {
    const fields = new Map(PI.env_config.map((field) => [field.name, field]))
    expect(fields.get("PI_API_KEY")?.password).toBe(true)
    expect(fields.get("PI_PROVIDER")?.options).toContain("deepseek")
    expect(fields.get("PI_API_FORMAT")?.options).toContain("anthropic-messages")
    expect(fields.get("PI_BASE_URL")).toBeTruthy()
  })

  it("warns about executable project files in the trust toggle's help text", () => {
    expect(EN_AGENT_META.env.PI_TRUST_PROJECT.hint).toMatch(/executable/i)
    expect(ZH_AGENT_META.env.PI_TRUST_PROJECT.hint).toMatch(/可执行/)
  })
})
