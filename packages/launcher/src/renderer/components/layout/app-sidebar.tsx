import React from "react"
import { useTranslation } from "react-i18next"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@renderer/components/ui/sidebar"
import { SidebarNav } from "./sidebar-nav"
import { SidebarSearch } from "./sidebar-search"
import { SidebarFooterBar } from "./sidebar-footer-bar"
import { NotificationBell } from "./notification-bell"

/**
 * Brand row. Collapsed, the wordmark drops and the row stacks so the logo and
 * the bell each keep a full icon slot in the narrow rail.
 */
function Brand(): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-2 group-data-[collapsible=icon]:px-0">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-linear-135 from-indigo-500 to-indigo-600 text-2xs font-bold text-white shadow-md shadow-indigo-500/35">
        OA
      </div>
      <span
        className="truncate text-base font-semibold tracking-tight text-white group-data-[collapsible=icon]:hidden"
        title="OpenAgents"
      >
        OpenAgents
      </span>
      <NotificationBell className="ml-auto group-data-[collapsible=icon]:ml-0" />
    </div>
  )
}

export function AppSidebar(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    // `sidebar-drag` makes the rail a window drag handle (Electron); every
    // interactive child re-enables pointer events via `sidebar-no-drag`.
    <Sidebar
      collapsible="icon"
      className="sidebar-drag h-screen border-r border-sidebar-border select-none"
    >
      <SidebarHeader className="sidebar-no-drag gap-2 pt-3">
        <Brand />
        <SidebarSearch />
      </SidebarHeader>
      <SidebarContent className="sidebar-no-drag">
        <SidebarNav />
      </SidebarContent>
      <SidebarFooter className="sidebar-no-drag">
        <SidebarFooterBar />
      </SidebarFooter>
      {/* The hairline between rail and content doubles as the collapse handle;
          ⌘B toggles it from the keyboard. */}
      <SidebarRail
        className="sidebar-no-drag"
        title={t("nav.toggleSidebar")}
        aria-label={t("nav.toggleSidebar")}
      />
    </Sidebar>
  )
}
