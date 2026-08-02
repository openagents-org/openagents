import React from "react"

import { SidebarInset, SidebarProvider } from "@renderer/components/ui/sidebar"
import { AppSidebar } from "./app-sidebar"

/** Matches the rail width the launcher shipped before the shadcn rewrite. */
const RAIL_WIDTH = "210px"
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
