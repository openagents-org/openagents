import { act, render, screen } from "@testing-library/react"
import { Activity } from "react"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { Popover, PopoverContent, PopoverTrigger } from "./popover"

// Radix measures the popover against its anchor.
beforeAll(() => {
  window.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof window.ResizeObserver
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0)
    return 0
  })
})

function Page({ mode }: { mode: "visible" | "hidden" }) {
  return (
    <Activity mode={mode}>
      <Popover open>
        <PopoverTrigger>Filters</PopoverTrigger>
        <PopoverContent>Event type</PopoverContent>
      </Popover>
    </Activity>
  )
}

describe("PopoverContent", () => {
  // The popover renders into a portal, which hiding the page does not hide.
  // Left in place it drifted to the window's corner, over the next page.
  it("goes away when its page is hidden, and comes back with it", async () => {
    const { rerender } = render(<Page mode="visible" />)
    expect(screen.getByText("Event type")).toBeInTheDocument()

    await act(async () => rerender(<Page mode="hidden" />))
    expect(screen.queryByText("Event type")).not.toBeInTheDocument()

    await act(async () => rerender(<Page mode="visible" />))
    expect(screen.getByText("Event type")).toBeInTheDocument()
  })
})
