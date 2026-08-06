import React from "react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@renderer/components/ui/sidebar"
import { useUiStore } from "@renderer/store/ui"
import { useUpdateCount } from "@renderer/hooks/useUpdateCount"
import { capture } from "@renderer/lib/analytics"
import { cn } from "@renderer/lib/utils"
import { NAV_ITEMS, NAV_SECTIONS } from "./nav-config"

/* This badge paints its own accent-coloured pill, so it has to hold its own
   foreground colour too. shadcn's base recolours a badge to the row's hover /
   active text colour, and in this rail that colour IS the accent — accent on
   accent, so the count vanished and left a bare dot the moment the row was
   selected or hovered. */
const BADGE_CLASS = cn(
  "rounded-full bg-sidebar-primary text-3xs font-bold text-sidebar-primary-foreground",
  "peer-hover/menu-button:text-sidebar-primary-foreground",
  "peer-data-[active=true]/menu-button:text-sidebar-primary-foreground",
)

export function SidebarNav(): React.JSX.Element {
  const { t } = useTranslation()
  const { currentTab, setCurrentTab, goToInstallList } = useUiStore(
    useShallow((s) => ({
      currentTab: s.currentTab,
      setCurrentTab: s.setCurrentTab,
      goToInstallList: s.goToInstallList,
    })),
  )
  const updateCount = useUpdateCount()

  const open = (id: string): void => {
    capture("tab_switched", { tab: id })
    // Install always returns to its list rather than resuming a stale detail
    // view, so the entry point is predictable.
    if (id === "install") goToInstallList()
    else setCurrentTab(id)
  }

  return (
    <>
      {NAV_SECTIONS.map((section) => (
        <SidebarGroup key={section}>
          <SidebarGroupLabel className="text-3xs font-semibold tracking-wider text-sidebar-muted uppercase">
            {t(`nav.sections.${section}`)}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.filter((i) => i.section === section).map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={currentTab === item.id}
                    onClick={() => open(item.id)}
                    data-tour={item.id}
                    data-testid={`nav-${item.id}`}
                    // Both, deliberately: `tooltip` only renders while the rail
                    // is collapsed and carries the label the icon replaced, so
                    // the native `title` keeps the longer description available
                    // while the rail is expanded.
                    title={t(`nav.items.${item.id}.description`)}
                    tooltip={t(`nav.items.${item.id}.label`)}
                  >
                    <item.icon />
                    <span>{t(`nav.items.${item.id}.label`)}</span>
                  </SidebarMenuButton>
                  {item.id === "install" && updateCount > 0 && (
                    <SidebarMenuBadge className={BADGE_CLASS}>
                      {updateCount}
                    </SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  )
}
