import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The module reads `window.api` at call time, so each case installs its own and
 * re-imports to reset the "last sent" state.
 */
async function load(platform: string): Promise<{
  initModalChrome: () => () => void
  setChromeDimmed: ReturnType<typeof vi.fn>
}> {
  const setChromeDimmed = vi.fn(async () => undefined)
  window.api = { platform, setChromeDimmed } as unknown as typeof window.api
  vi.resetModules()
  const mod = await import("./modal-chrome")
  return { initModalChrome: mod.initModalChrome, setChromeDimmed }
}

/** A dialog as Radix renders it, in whichever state. */
function addDialog(state: "open" | "closed"): HTMLElement {
  const el = document.createElement("div")
  el.setAttribute("data-slot", "dialog-content")
  el.setAttribute("data-state", state)
  document.body.appendChild(el)
  return el
}

/** MutationObserver callbacks are microtasks. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** Stopped after each case: an observer left running outlives the DOM it reads. */
let stop: () => void = () => {}

beforeEach(() => {
  document.body.innerHTML = ""
})

afterEach(() => {
  stop()
})

describe("initModalChrome", () => {
  it("dims while a dialog is open and lifts the moment it closes", async () => {
    const { initModalChrome, setChromeDimmed } = await load("win32")
    // Unconditional on startup: a reload leaves main holding whatever the
    // previous page last said, and undoing that is the whole point.
    stop = initModalChrome()
    expect(setChromeDimmed).toHaveBeenLastCalledWith(false)

    const dialog = addDialog("open")
    await settle()
    expect(setChromeDimmed).toHaveBeenLastCalledWith(true)

    // Radix flips the attribute first and unmounts later, after the exit
    // animation. The buttons must come back at the flip, not at the unmount —
    // an animation that never reports back would otherwise strand them.
    dialog.setAttribute("data-state", "closed")
    await settle()
    expect(setChromeDimmed).toHaveBeenLastCalledWith(false)
  })

  it("stays dimmed while a stacked dialog closes over one that is still open", async () => {
    const { initModalChrome, setChromeDimmed } = await load("win32")
    stop = initModalChrome()

    const form = addDialog("open")
    await settle()
    const confirm = addDialog("open")
    await settle()
    // Already dimmed — nothing new to say (the startup sync is call 1).
    expect(setChromeDimmed).toHaveBeenCalledTimes(2)

    confirm.remove()
    await settle()
    expect(setChromeDimmed).toHaveBeenCalledTimes(2)

    form.setAttribute("data-state", "closed")
    await settle()
    expect(setChromeDimmed).toHaveBeenLastCalledWith(false)
  })

  it("says nothing on macOS, which has no overlay to repaint", async () => {
    const { initModalChrome, setChromeDimmed } = await load("darwin")
    stop = initModalChrome()

    addDialog("open")
    await settle()

    expect(setChromeDimmed).not.toHaveBeenCalled()
  })
})
