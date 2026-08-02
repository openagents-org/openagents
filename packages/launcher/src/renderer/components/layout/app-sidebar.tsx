import React from "react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@renderer/components/shadcn/sidebar"
import { SidebarNav } from "./sidebar-nav"
import { SidebarFooterBar } from "./sidebar-footer-bar"

function Brand(): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-1 pt-2">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-linear-135 from-indigo-500 to-indigo-600 text-2xs font-bold text-white shadow-md shadow-indigo-500/35">
        OA
      </div>
      <span
        className="truncate text-base font-semibold tracking-tight text-white"
        title="OpenAgents"
      >
        OpenAgents
      </span>
    </div>
  )
}

export function AppSidebar(): React.JSX.Element {
  return (
    // `collapsible="none"` keeps the rail at a fixed width: there is nowhere to
    // put a trigger until the page headers are unified, and the launcher window
    // is never narrow enough for collapsing to earn its keep.
    // `sidebar-drag` makes the rail a window drag handle (Electron); every
    // interactive child re-enables pointer events via `sidebar-no-drag`.
    <Sidebar
      collapsible="none"
      className="sidebar-drag h-screen select-none border-r border-sidebar-border"
    >
      <SidebarHeader className="sidebar-no-drag">
        <Brand />
      </SidebarHeader>
      <SidebarContent className="sidebar-no-drag">
        <SidebarNav />
      </SidebarContent>
      <SidebarFooter className="sidebar-no-drag">
        <SidebarFooterBar />
      </SidebarFooter>
    </Sidebar>
  )
}
