import { describe, it, expect, beforeEach, vi } from "vitest"

// electron's app.getLocale isn't available under vitest; stub it so mirror.ts's
// `import { app } from "electron"` resolves. Locale detection is exercised via
// the explicit region override, so the stub just needs to not throw.
vi.mock("electron", () => ({ app: { getLocale: () => "en-US" } }))

import {
  setRegionPreference,
  getRegionPreference,
  useChinaMirror,
  resetRegionDetection,
  nodeDistUrls,
  npmUrls,
  npmRegistryBase,
  nodeMirrorBases,
  launcherFeedUrl,
  DEFAULT_LAUNCHER_FEED,
} from "./mirror"

/** Pin what timezone detection sees, so the suite is machine-independent. */
function stubTimezone(timeZone: string): void {
  vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
    resolvedOptions: () => ({ timeZone }),
  } as unknown as Intl.DateTimeFormat)
  resetRegionDetection()
}

describe("download mirrors", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Reset to a deterministic state; each test pins the region explicitly.
    setRegionPreference("auto")
    resetRegionDetection()
  })

  it("global region uses official origins only", () => {
    setRegionPreference("global")
    expect(useChinaMirror()).toBe(false)
    expect(nodeDistUrls("v22.22.3/win-x64/node.exe")).toEqual([
      "https://nodejs.org/dist/v22.22.3/win-x64/node.exe",
    ])
    expect(npmUrls("npm/-/npm-10.9.8.tgz")).toEqual([
      "https://registry.npmjs.org/npm/-/npm-10.9.8.tgz",
    ])
    expect(npmRegistryBase()).toBe("https://registry.npmjs.org")
  })

  it("china region races every mirror with official as the last resort", () => {
    setRegionPreference("cn")
    expect(useChinaMirror()).toBe(true)
    const nodeUrls = nodeDistUrls("v22.22.3/win-x64/node.exe")
    expect(nodeUrls[0]).toBe(
      "https://cdn.npmmirror.com/binaries/node/v22.22.3/win-x64/node.exe",
    )
    expect(nodeUrls.length).toBeGreaterThan(2)
    expect(nodeUrls.at(-1)).toBe(
      "https://nodejs.org/dist/v22.22.3/win-x64/node.exe",
    )

    const registryUrls = npmUrls("@openagents-org/agent-launcher/latest")
    expect(registryUrls[0]).toBe(
      "https://registry.npmmirror.com/@openagents-org/agent-launcher/latest",
    )
    expect(registryUrls.at(-1)).toBe(
      "https://registry.npmjs.org/@openagents-org/agent-launcher/latest",
    )
    expect(npmRegistryBase()).toBe("https://registry.npmmirror.com")
  })

  it("auto keeps a mirror candidate even when detection says not-China", () => {
    // A mainland user on an English system with a non-CN clock is missed by
    // detection; the race must still be able to reach a mirror.
    stubTimezone("UTC")
    expect(useChinaMirror()).toBe(false)
    const urls = nodeDistUrls("v22.22.3/win-x64/node.exe")
    expect(urls[0]).toBe("https://nodejs.org/dist/v22.22.3/win-x64/node.exe")
    expect(urls).toHaveLength(2)
    expect(urls[1]).toContain("npmmirror.com")
  })

  it("auto detects mainland China from the timezone", () => {
    stubTimezone("Asia/Shanghai")
    expect(useChinaMirror()).toBe(true)
    expect(nodeDistUrls("x")[0]).toContain("npmmirror.com")
  })

  it("exposes bare node origins for the core installer", () => {
    setRegionPreference("cn")
    const bases = nodeMirrorBases()
    expect(bases[0]).toBe("https://cdn.npmmirror.com/binaries/node")
    expect(bases.at(-1)).toBe("https://nodejs.org/dist")
    expect(bases.every((b) => !b.endsWith("/"))).toBe(true)
  })

  it("ignores invalid region overrides (stays on the last valid value)", () => {
    setRegionPreference("cn")
    setRegionPreference("nonsense")
    expect(useChinaMirror()).toBe(true)
    expect(getRegionPreference()).toBe("cn")
  })
})

describe("launcher update feed", () => {
  it("returns null when there is no override, so the packaged origin is kept", () => {
    expect(launcherFeedUrl(undefined)).toBeNull()
    expect(launcherFeedUrl("")).toBeNull()
    expect(launcherFeedUrl("   ")).toBeNull()
    expect(launcherFeedUrl(null)).toBeNull()
    expect(launcherFeedUrl(42)).toBeNull()
  })

  it("accepts an absolute http(s) mirror and trims it", () => {
    expect(launcherFeedUrl("https://dl-cn.example.com/launcher/stable")).toBe(
      "https://dl-cn.example.com/launcher/stable",
    )
    expect(launcherFeedUrl("  http://192.168.1.10:8080/launcher  ")).toBe(
      "http://192.168.1.10:8080/launcher",
    )
  })

  it("rejects values electron-updater would choke on", () => {
    expect(launcherFeedUrl("dl-cn.example.com/launcher")).toBeNull()
    expect(launcherFeedUrl("ftp://dl.example.com/launcher")).toBeNull()
    expect(launcherFeedUrl("file:///tmp/launcher")).toBeNull()
  })

  it("treats the official origin as 'no override'", () => {
    expect(launcherFeedUrl(DEFAULT_LAUNCHER_FEED)).toBeNull()
    expect(launcherFeedUrl(`${DEFAULT_LAUNCHER_FEED}/`)).toBeNull()
  })
})
