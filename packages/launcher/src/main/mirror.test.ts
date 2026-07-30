import { describe, it, expect, beforeEach, vi } from "vitest"

// electron's app.getLocale isn't available under vitest; stub it so mirror.ts's
// `import { app } from "electron"` resolves. Locale detection is exercised via
// the explicit region override, so the stub just needs to not throw.
vi.mock("electron", () => ({ app: { getLocale: () => "en-US" } }))

import {
  setRegionPreference,
  getRegionPreference,
  useChinaMirror,
  nodeDistUrls,
  npmUrls,
  npmRegistryBase,
  launcherFeedUrl,
  DEFAULT_LAUNCHER_FEED,
} from "./mirror"

describe("download mirrors", () => {
  beforeEach(() => {
    // Reset to a deterministic state; each test pins the region explicitly.
    setRegionPreference("auto")
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

  it("china region puts the mirror first and official as fallback", () => {
    setRegionPreference("cn")
    expect(useChinaMirror()).toBe(true)
    expect(nodeDistUrls("v22.22.3/win-x64/node.exe")).toEqual([
      "https://cdn.npmmirror.com/binaries/node/v22.22.3/win-x64/node.exe",
      "https://nodejs.org/dist/v22.22.3/win-x64/node.exe",
    ])
    expect(npmUrls("@openagents-org/agent-launcher/latest")).toEqual([
      "https://registry.npmmirror.com/@openagents-org/agent-launcher/latest",
      "https://registry.npmjs.org/@openagents-org/agent-launcher/latest",
    ])
    expect(npmRegistryBase()).toBe("https://registry.npmmirror.com")
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
