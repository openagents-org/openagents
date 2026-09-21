import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchReleaseNotes, releaseNotesUrls } from "./release-notes"

const FEED = "https://dl.openagents.org/launcher/stable"

const NOTES = {
  version: "1.2.0",
  date: "2026-09-21",
  entries: [
    {
      type: "feature",
      title: { en: "Something new", zh: "新功能" },
      description: { en: "Detail", zh: "详情" },
    },
  ],
}

function response(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("releaseNotesUrls", () => {
  it("asks the feed first, then the GitHub release", () => {
    expect(releaseNotesUrls("1.2.0", `${FEED}/`)).toEqual([
      `${FEED}/release-notes-1.2.0.json`,
      "https://github.com/openagents-org/openagents/releases/download/launcher-v1.2.0/release-notes-1.2.0.json",
    ])
  })
})

describe("fetchReleaseNotes", () => {
  it("returns the parsed notes from the feed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(NOTES))
    vi.stubGlobal("fetch", fetchMock)

    const release = await fetchReleaseNotes("1.2.0", FEED)

    expect(release?.entries[0].title.zh).toBe("新功能")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("falls back to the GitHub release when the feed has nothing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(null, false))
      .mockResolvedValueOnce(response(NOTES))
    vi.stubGlobal("fetch", fetchMock)

    expect(await fetchReleaseNotes("1.2.0", FEED)).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("ignores notes that describe a different version", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(NOTES)))
    expect(await fetchReleaseNotes("9.9.9", FEED)).toBeNull()
  })

  it("is quiet when the notes cannot be reached at all", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
    expect(await fetchReleaseNotes("1.2.0", FEED)).toBeNull()
  })

  it("drops a malformed file rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ nope: true })))
    expect(await fetchReleaseNotes("1.2.0", FEED)).toBeNull()
  })
})
