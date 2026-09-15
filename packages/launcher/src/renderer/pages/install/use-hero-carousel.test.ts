import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { useHeroCarousel } from "./use-hero-carousel"

describe("useHeroCarousel — stepping by hand", () => {
  it("steps forward and back, wrapping at either end", () => {
    const { result } = renderHook(() => useHeroCarousel(3, true))
    expect(result.current.index).toBe(0)

    act(() => result.current.prev())
    expect(result.current.index).toBe(2)

    act(() => result.current.next())
    expect(result.current.index).toBe(0)

    act(() => result.current.next())
    expect(result.current.index).toBe(1)
  })

  it("stays put when there is only one slide", () => {
    const { result } = renderHook(() => useHeroCarousel(1, false))
    act(() => result.current.next())
    act(() => result.current.prev())
    expect(result.current.index).toBe(0)
  })
})
