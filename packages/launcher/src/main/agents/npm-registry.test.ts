import { describe, expect, it } from "vitest"

import { resolveInstallableVersion, type NpmRegistryInfo } from "./npm-registry"

const NODE_22_OK = ">=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0"
const NODE_24_ONLY = ">=24.16.0 <25 || >=26.1.0"

// openclaw on npm, 2026-09-11: `latest` had just moved to a Node 24 floor. The
// beta accepts Node 22 here on purpose — `npm install` would never pick it, so
// holding back must not either.
const openclaw: NpmRegistryInfo = {
  "dist-tags": { latest: "2026.9.4" },
  versions: {
    "2026.9.1": { engines: { node: NODE_22_OK } },
    "2026.9.2": { engines: { node: NODE_22_OK } },
    "2026.9.3": { engines: { node: NODE_24_ONLY } },
    "2026.9.4": { engines: { node: NODE_24_ONLY } },
    "2026.9.5-beta.1": { engines: { node: NODE_22_OK } },
  },
}

describe("resolveInstallableVersion", () => {
  it("holds back to the newest stable release the agents' Node can run", () => {
    expect(resolveInstallableVersion(openclaw, "22.22.3")).toBe("2026.9.2")
  })

  it("is plain `latest` once the Node is new enough", () => {
    expect(resolveInstallableVersion(openclaw, "24.20.0")).toBe("2026.9.4")
  })

  it("is plain `latest` when the Node is unknown", () => {
    expect(resolveInstallableVersion(openclaw, null)).toBe("2026.9.4")
  })

  it("is plain `latest` when no release runs on this Node at all", () => {
    // Nothing to hold back to, so npm gets to try and print its own reason.
    expect(resolveInstallableVersion(openclaw, "20.0.0")).toBe("2026.9.4")
  })

  it("never climbs above `latest`", () => {
    const info: NpmRegistryInfo = {
      "dist-tags": { latest: "2.0.0" },
      versions: {
        "1.0.0": {},
        "2.0.0": { engines: { node: ">=24" } },
        // Published but not tagged latest — a hotfix line, say.
        "3.0.0": {},
      },
    }
    expect(resolveInstallableVersion(info, "22.22.3")).toBe("1.0.0")
  })

  it("treats a missing or unreadable range as runnable", () => {
    const info = (engines: unknown): NpmRegistryInfo => ({
      "dist-tags": { latest: "2.0.0" },
      versions: { "1.0.0": {}, "2.0.0": { engines } },
    })
    expect(resolveInstallableVersion(info(undefined), "22.22.3")).toBe("2.0.0")
    expect(resolveInstallableVersion(info(["node >=0.6"]), "22.22.3")).toBe("2.0.0")
    expect(resolveInstallableVersion(info({ node: "node >= 18" }), "22.22.3")).toBe("2.0.0")
  })
})
