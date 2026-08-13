import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { RELEASES } from "@renderer/lib/changelog"
import { LEGACY_SEEN_KEY, useWhatsNew } from "./use-whats-new"

const CURRENT = RELEASES[0].version
const SEEN_SETTING = "lastSeenRelease"

interface Stub {
  /** What main's settings.json holds for the seen-marker. */
  seen?: unknown
  hasRunBefore?: boolean
}

function stubApi({ seen, hasRunBefore = true }: Stub = {}): {
  setSetting: ReturnType<typeof vi.fn>
} {
  const setSetting = vi.fn(async () => true)
  window.api = {
    appVersion: async () => CURRENT,
    getSetting: async () => seen,
    setSetting,
    hasRunBefore: async () => hasRunBefore,
  } as unknown as typeof window.api
  return { setSetting }
}

beforeEach(() => {
  localStorage.clear()
})

describe("useWhatsNew", () => {
  it("announces to a profile that arrives without a marker", async () => {
    // The 0.9.9 regression: no marker, but the app has been run before, so this
    // is an upgrade from a build too old to have written one — not a first run.
    stubApi({ hasRunBefore: true })

    const { result } = renderHook(() => useWhatsNew())

    await waitFor(() => expect(result.current.open).toBe(true))
    expect(result.current.releases).toEqual([RELEASES[0]])
  })

  it("says nothing on a genuine fresh install, and records the version", async () => {
    const { setSetting } = stubApi({ hasRunBefore: false })

    const { result } = renderHook(() => useWhatsNew())

    await waitFor(() =>
      expect(setSetting).toHaveBeenCalledWith(SEEN_SETTING, CURRENT),
    )
    expect(result.current.open).toBe(false)
  })

  it("says nothing to someone already caught up", async () => {
    const { setSetting } = stubApi({ seen: CURRENT })

    const { result } = renderHook(() => useWhatsNew())

    await waitFor(() =>
      expect(setSetting).toHaveBeenCalledWith(SEEN_SETTING, CURRENT),
    )
    expect(result.current.open).toBe(false)
  })

  it("announces the running version only, however far behind the marker is", async () => {
    stubApi({ seen: "0.0.1" })

    const { result } = renderHook(() => useWhatsNew())

    await waitFor(() => expect(result.current.open).toBe(true))
    // Not one dialog per skipped version, and not all of them stacked into
    // one: what this build brings is the announcement.
    expect(result.current.releases).toEqual([RELEASES[0]])
  })

  it("honours the marker 0.9.9 left in localStorage", async () => {
    localStorage.setItem(LEGACY_SEEN_KEY, CURRENT)
    const { setSetting } = stubApi({ seen: undefined })

    const { result } = renderHook(() => useWhatsNew())

    await waitFor(() =>
      expect(setSetting).toHaveBeenCalledWith(SEEN_SETTING, CURRENT),
    )
    expect(result.current.open).toBe(false)
  })

  it("prefers the stored marker over the one 0.9.9 left behind", async () => {
    localStorage.setItem(LEGACY_SEEN_KEY, "0.0.1")
    const { setSetting } = stubApi({ seen: CURRENT })

    const { result } = renderHook(() => useWhatsNew())

    await waitFor(() =>
      expect(setSetting).toHaveBeenCalledWith(SEEN_SETTING, CURRENT),
    )
    expect(result.current.open).toBe(false)
  })

  it("records the running version only once the dialog is closed", async () => {
    const { setSetting } = stubApi({ seen: "0.0.1" })

    const { result } = renderHook(() => useWhatsNew())
    await waitFor(() => expect(result.current.open).toBe(true))
    expect(setSetting).not.toHaveBeenCalled()

    act(() => result.current.close())

    expect(result.current.open).toBe(false)
    expect(setSetting).toHaveBeenCalledWith(SEEN_SETTING, CURRENT)
  })
})
