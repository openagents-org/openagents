import React from "react"

import { SidebarInset, SidebarProvider } from "@renderer/components/ui/sidebar"
import { useAccountStore } from "@renderer/store/account"
import { useSidebarStore } from "@renderer/store/sidebar"
import { useWorkspaceTabsStore } from "@renderer/store/workspace-tabs"
import { AppHeader } from "./app-header"
import { AppSidebar } from "./sidebar/app-sidebar"
import { WorkspaceBar } from "./workspace-bar"

/**
 * The window, laid out by side. This Computer: the sidebar down the left, then
 * the header and the current page. The Workspace: the tab bar across the top
 * and the workspace under it at full width — the web app brings a sidebar of
 * its own, and a second one beside it only cost room. Pages own their own
 * scrolling, so the frame itself never scrolls.
 */
export function AppFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  const local = useAccountStore((s) => s.mode === "launcher")
  const open = useSidebarStore((s) => s.open)
  const setOpen = useSidebarStore((s) => s.setOpen)
  const switchWidth = useSidebarStore((s) => s.switchWidth)
  // The open workspaces, for the tab bar and the header on either side.
  React.useEffect(() => { useWorkspaceTabsStore.getState().init() }, [])

  if (!local) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <WorkspaceBar />
        <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    )
  }

  return (
    <SidebarProvider
      open={open}
      onOpenChange={setOpen}
      className="h-screen min-h-0 overflow-hidden"
      style={{
        "--sidebar-width-icon": "var(--rail-icon-width)",
        // Wide enough for the switch at its full labels after the macOS traffic
        // lights, which are fixed px while the sidebar's 16rem follows the UI
        // scale: at a small scale, or with longer labels, the two cut it short.
        // The 1rem is the row's padding either side of it.
        "--sidebar-width": `max(16rem, calc(var(--traffic-lights-w) + ${switchWidth}px + 1rem))`,
      } as React.CSSProperties}
    >
      <AppSidebar />
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <AppHeader />
        <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
