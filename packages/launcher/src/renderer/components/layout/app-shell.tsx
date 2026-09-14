import React from "react"

import { SidebarInset, SidebarProvider } from "@renderer/components/ui/sidebar"
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
      className="h-full overflow-hidden"
    >
      <AppSidebar />
      {/* Pages own their own scrolling, so the frame itself never scrolls.

          The inset is zero on every platform now: the mode bar above this shell
          carries the window buttons' clearance for the whole window, and the
          drag handle with it. Both are kept in terms of the token rather than
          deleted, so a layout that goes back to a per-pane strip only has to
          change globals.css. */}
      <SidebarInset className="min-w-0 flex-1 overflow-hidden pt-(--content-top-inset)">
        {/* Grab handle for whatever padding the token asks for — nothing, while
            the mode bar is the window's drag region. */}
        <div
          aria-hidden
          className="titlebar-drag absolute inset-x-0 top-0 h-(--content-top-inset)"
        />
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
