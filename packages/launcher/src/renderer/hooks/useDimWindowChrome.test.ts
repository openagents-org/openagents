import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The platform check runs at module load, so each case installs its own
 * `window.api` and re-imports — which also gives every test a fresh count.
 */
async function load(platform: string): Promise<{
  useDimWindowChrome: () => void
  setChromeDimmed: ReturnType<typeof vi.fn>
}> {
  const setChromeDimmed = vi.fn(async () => undefined)
  window.api = { platform, setChromeDimmed } as unknown as typeof window.api
  vi.resetModules()
  const mod = await import("./useDimWindowChrome")
  return { useDimWindowChrome: mod.useDimWindowChrome, setChromeDimmed }
}

beforeEach(() => {
  vi.resetModules()
})

describe("useDimWindowChrome", () => {
  it("dims once for a stack of dialogs, and lifts only when the last closes", async () => {
    const { useDimWindowChrome, setChromeDimmed } = await load("win32")

    const form = renderHook(() => useDimWindowChrome())
    expect(setChromeDimmed).toHaveBeenCalledTimes(1)
    expect(setChromeDimmed).toHaveBeenCalledWith(true)

    // A confirmation opened on top of the form: already dimmed, nothing to say.
    const confirm = renderHook(() => useDimWindowChrome())
    expect(setChromeDimmed).toHaveBeenCalledTimes(1)

    // It closes first — the form is still up, so the chrome stays dimmed.
    confirm.unmount()
    expect(setChromeDimmed).toHaveBeenCalledTimes(1)

    form.unmount()
    expect(setChromeDimmed).toHaveBeenCalledTimes(2)
    expect(setChromeDimmed).toHaveBeenLastCalledWith(false)
  })

  it("says nothing on macOS, which has no overlay to repaint", async () => {
    const { useDimWindowChrome, setChromeDimmed } = await load("darwin")

    const { unmount } = renderHook(() => useDimWindowChrome())
    unmount()

    expect(setChromeDimmed).not.toHaveBeenCalled()
  })
})
