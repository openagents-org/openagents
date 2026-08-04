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
      style={{ "--sidebar-width": RAIL_WIDTH } as React.CSSProperties}
      className="h-screen overflow-hidden"
    >
      <AppSidebar />
      {/* Pages own their own scrolling, so the frame itself never scrolls. */}
      <SidebarInset className="min-w-0 flex-1 overflow-hidden">
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
