import React from "react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@renderer/components/ui/breadcrumb"
import { Separator } from "@renderer/components/ui/separator"
import { SidebarTrigger } from "@renderer/components/ui/sidebar"
import { useUiStore } from "@renderer/store/ui"
import { HeaderTooltip } from "./header-tooltip"
import { NotificationBell } from "./notification-bell"
import { ThemeMenu } from "./theme-menu"
import { TopSearch } from "./top-search"

/** Where the user is, as the crumbs after the side of the window. */
function usePageCrumbs(): string[] {
  const { t } = useTranslation()
  const { currentTab, section } = useUiStore(
    useShallow((s) => ({ currentTab: s.currentTab, section: s.visibleSettingsSection })),
  )
  if (currentTab === "settings") {
    const page = t("nav.items.settings.label")
    return section ? [page, t(`settings.sections.${section}`)] : [page]
  }
  return [t("nav.modeLauncher"), t(`nav.items.${currentTab}.label`, { defaultValue: currentTab })]
}

/**
 * This Computer's strip across the top of the main area: the sidebar toggle,
 * where the user is, and the search, theme and notification controls. (The
 * Workspace side has its own bar; see WorkspaceBar.)
 *
 * It is also the window's title bar — it drags the window, and on Windows and
 * Linux the OS draws its buttons over its right end, which `--window-controls-w`
 * keeps clear.
 */
export function AppHeader(): React.JSX.Element {
  const { t } = useTranslation()
  const crumbs = usePageCrumbs()
  const toggle = t("nav.toggleSidebar")

  return (
    <header className="titlebar-drag flex h-(--mode-bar-h) shrink-0 items-center gap-2 border-b bg-background pr-(--window-controls-w) pl-3 transition-[padding] duration-300 ease-in-out group-has-data-[collapsible=icon]/sidebar-wrapper:pl-(--header-inset-rail)">
      <HeaderTooltip label={toggle}>
        <SidebarTrigger className="titlebar-no-drag -ml-1" aria-label={toggle} />
      </HeaderTooltip>
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {crumbs.map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                {i === crumbs.length - 1
                  ? <BreadcrumbPage className="truncate">{crumb}</BreadcrumbPage>
                  : <span className="truncate">{crumb}</span>}
              </BreadcrumbItem>
            </React.Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="titlebar-no-drag ml-auto flex shrink-0 items-center gap-1 pr-3">
        <TopSearch />
        <ThemeMenu />
        <NotificationBell />
      </div>
    </header>
  )
}
