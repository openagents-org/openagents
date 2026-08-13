import React from "react"

import { SidebarInset, SidebarProvider } from "@renderer/components/ui/sidebar"
import { useFullScreen } from "@renderer/hooks/useFullScreen"
import { AppSidebar } from "./app-sidebar"

/**
 * Wider than the 210px the launcher shipped before the shadcn rewrite: at that
 * width the full product name did not fit next to the logo and the bell, and
 * the longest nav labels sat right against the badge column.
 *
 * In rem, not px, so the rail tracks Settings → Appearance → UI scale like
 * every other size in the app. Fixed at 244px it would have kept its width
 * while the wordmark inside it grew, and "OpenAgents Launcher" would have
 * collided with the bell on the largest scale.
 */
const RAIL_WIDTH = "16.5rem"
const COLLAPSE_KEY = "launcher:sidebar-open"

function readStoredOpen(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) !== "false"
  } catch {
    return true
  }
}

export function AppShell({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  // SidebarProvider persists its own state to a cookie, which the renderer runs
  // too early (and on a file:// origin) to rely on — so the rail is controlled
  // here and remembered in localStorage instead.
  const [open, setOpen] = React.useState(readStoredOpen)

  // Gives the title-bar strip back when the window buttons go away.
  useFullScreen()

  const handleOpenChange = (next: boolean): void => {
    setOpen(next)
    try {
      localStorage.setItem(COLLAPSE_KEY, String(next))
    } catch {
      /* private mode — the rail just reopens next launch */
    }
  }

  return (
    <SidebarProvider
      open={open}
      onOpenChange={handleOpenChange}
      // The collapsed width is per-platform — on macOS the traffic lights are
      // drawn over the rail and it has to be at least as wide as they are. See
      // `--rail-icon-width` in globals.css.
      style={
        {
          "--sidebar-width": RAIL_WIDTH,
          "--sidebar-width-icon": "var(--rail-icon-width)",
        } as React.CSSProperties
      }
      className="h-screen overflow-hidden"
    >
      <AppSidebar />
      {/* Pages own their own scrolling, so the frame itself never scrolls.
          The top padding is the strip the window buttons live in. Padding
          rather than a layout row so every page keeps filling the inset exactly
          as it did with a system title bar.

          `--content-top-inset`, not `--titlebar-h`: this pane only yields on
          the platforms whose buttons are in ITS corner. On macOS they are over
          the rail instead, so this is 0 and the page starts at the window's top
          edge — as does the strip below, which collapses to nothing rather than
          covering the top of the page for no reason. */}
      <SidebarInset className="min-w-0 flex-1 overflow-hidden pt-(--content-top-inset)">
        {/* Grab handle for the window. It only covers the padding above the
            page, and the OS owns the rectangle under the buttons themselves. */}
        <div
          aria-hidden
          className="titlebar-drag absolute inset-x-0 top-0 h-(--content-top-inset)"
        />
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
