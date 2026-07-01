import { describe, it, expect, beforeEach, vi } from "vitest"

// electron's app.getLocale isn't available under vitest; stub it so mirror.ts's
// `import { app } from "electron"` resolves. Locale detection is exercised via
// the explicit region override, so the stub just needs to not throw.
vi.mock("electron", () => ({ app: { getLocale: () => "en-US" } }))

import {
  setRegionPreference,
  useChinaMirror,
  nodeDistUrls,
  npmUrls,
  npmRegistryBase,
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
  })
})
