import { describe, it, expect } from "vitest"

import { RELEASES, localized, releaseFor } from "./changelog"

describe("bundled release notes", () => {
  it("ships at least one release, newest first", () => {
    expect(RELEASES.length).toBeGreaterThan(0)
    for (let i = 1; i < RELEASES.length; i++) {
      expect(RELEASES[i - 1].version).not.toBe(RELEASES[i].version)
    }
  })

  it("carries both languages for every entry", () => {
    for (const release of RELEASES) {
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      for (const entry of release.entries) {
        expect(entry.title.en.trim()).not.toBe("")
        expect(entry.title.zh.trim()).not.toBe("")
        // Optional, but never half-translated — the parser drops a lone side.
        if (entry.description) {
          expect(entry.description.en.trim()).not.toBe("")
          expect(entry.description.zh.trim()).not.toBe("")
        }
      }
    }
  })

  it("finds a release by version, with or without the v prefix", () => {
    const { version } = RELEASES[0]
    expect(releaseFor(version)?.version).toBe(version)
    expect(releaseFor(`v${version}`)?.version).toBe(version)
    expect(releaseFor("0.0.1")).toBeNull()
    expect(releaseFor(null)).toBeNull()
  })
})

describe("localized", () => {
  const text = { en: "English", zh: "中文" }

  it("follows the active language, falling back to English", () => {
    expect(localized(text, "zh")).toBe("中文")
    expect(localized(text, "zh-CN")).toBe("中文")
    expect(localized(text, "en")).toBe("English")
    expect(localized(text, "fr")).toBe("English")
  })
})
