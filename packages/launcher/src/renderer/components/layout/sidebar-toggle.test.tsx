import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { SidebarProvider } from "@renderer/components/ui/sidebar"
import { SidebarToggle } from "./sidebar-toggle"

// Two things jsdom does not implement: matchMedia, which SidebarProvider's
// mobile check calls, and ResizeObserver, which the tooltip measures itself
// with the moment hovering the button opens it.
beforeAll(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia
  window.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof window.ResizeObserver
})

describe("SidebarToggle", () => {
  it("is a real button in both states, and says which way it goes", async () => {
    render(
      <SidebarProvider defaultOpen>
        <SidebarToggle />
      </SidebarProvider>,
    )

    const button = screen.getByTestId("sidebar-toggle")
    const expanded = button.getAttribute("aria-label")
    expect(expanded).toBeTruthy()

    await userEvent.click(button)

    // Still there once the rail is a 48px strip — collapsing it from a control
    // that collapses with it would be a one-way trip.
    expect(screen.getByTestId("sidebar-toggle")).toBe(button)
    expect(button.getAttribute("aria-label")).not.toBe(expanded)
  })
})
