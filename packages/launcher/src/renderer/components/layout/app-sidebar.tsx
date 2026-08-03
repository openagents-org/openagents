import React from "react"
import { useTranslation } from "react-i18next"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@renderer/components/ui/sidebar"
import { BrandMark } from "@renderer/components/ui-kit"
import { SidebarNav } from "./sidebar-nav"
import { SidebarSearch } from "./sidebar-search"
import { SidebarFooterBar } from "./sidebar-footer-bar"
import { NotificationBell } from "./notification-bell"

/**
 * Brand row. Collapsed, the wordmark drops and the row stacks so the logo and
 * the bell each keep a full icon slot in the narrow rail.
 */
function Brand(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex min-w-0 items-center gap-2.5 px-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-2 group-data-[collapsible=icon]:px-0">
      <BrandMark className="size-7" />
      {/* Same key the About card uses, so the rail and Settings never disagree
          about what the app is called. It stays on one line at every UI scale
          because the rail is sized in rem — see RAIL_WIDTH. */}
      <span
        className="truncate text-base font-semibold tracking-tight text-white group-data-[collapsible=icon]:hidden"
        title={t("settings.about.productName")}
      >
        {t("settings.about.productName")}
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
