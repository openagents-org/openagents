import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { crashLoopGuard, startStallWatchdog } from "./responsiveness"

describe("startStallWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("stays quiet while the timer fires on time", () => {
    const log = vi.fn()
    const stop = startStallWatchdog(log)

    vi.advanceTimersByTime(10_000)

    expect(log).not.toHaveBeenCalled()
    stop()
  })

  it("logs how long the thread was held when a tick comes late", () => {
    const log = vi.fn()
    const stop = startStallWatchdog(log)

    // The clock moves on while no timer can run — a synchronous block.
    vi.setSystemTime(Date.now() + 4_000)
    vi.advanceTimersByTime(1_000)

    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain("~4000ms")
    stop()
  })

  it("does not call a machine that slept a stall", () => {
    const log = vi.fn()
    const stop = startStallWatchdog(log)

    vi.setSystemTime(Date.now() + 60 * 60 * 1000)
    vi.advanceTimersByTime(1_000)

    expect(log).not.toHaveBeenCalled()
    stop()
  })
})

describe("crashLoopGuard", () => {
  it("allows a few reloads, then stops a renderer that keeps dying", () => {
    let now = 0
    const shouldReload = crashLoopGuard(3, 60_000, () => now)

    expect([shouldReload(), shouldReload(), shouldReload()]).toEqual([
      true,
      true,
      true,
    ])
    expect(shouldReload()).toBe(false)
  })

  it("forgets crashes older than the window", () => {
    let now = 0
    const shouldReload = crashLoopGuard(1, 60_000, () => now)

    expect(shouldReload()).toBe(true)
    now = 61_000
    expect(shouldReload()).toBe(true)
  })
})
