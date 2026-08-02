import React from "react"

import {
  SidebarInset,
  SidebarProvider,
} from "@renderer/components/shadcn/sidebar"
import { AppSidebar } from "./app-sidebar"

/** Matches the rail width the launcher shipped before the shadcn rewrite. */
const RAIL_WIDTH = "210px"

export function AppShell({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <SidebarProvider
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
