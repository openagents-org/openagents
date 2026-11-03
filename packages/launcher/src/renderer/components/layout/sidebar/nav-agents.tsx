import React from "react"
import { Bot } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@renderer/components/ui/sidebar"
import { useAccountStore } from "@renderer/store/account"
import { useUiStore } from "@renderer/store/ui"
import { useUpdateCount } from "@renderer/hooks/useUpdateCount"
import { capture } from "@renderer/lib/analytics"
import { RAIL_BUTTON, RailLabel } from "./rail-label"

/**
 * Connect Agents — this computer's agents, and the way to every new one. The
 * agent update count rides on it in red, the same badge the notification bell
 * uses; in the icon rail, where the count has no room, a red dot stands in.
 */
export function NavAgents(): React.JSX.Element {
  const { t } = useTranslation()
  const inLauncher = useAccountStore((s) => s.mode === "launcher")
  // The marketplace has no entry of its own; it is reached from here, so this
  // entry stays lit while it is open.
  const onAgents = useUiStore((s) => s.currentTab === "dashboard" || s.currentTab === "install")
  const active = inLauncher && onAgents
  const updates = useUpdateCount()
  const label = t("nav.items.dashboard.label")

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={label}
        data-tour="dashboard"
        data-testid="nav-dashboard"
        className={RAIL_BUTTON}
        onClick={() => {
          capture("tab_switched", { tab: "dashboard" })
          useAccountStore.getState().exitWorkspace("dashboard")
        }}
      >
        <Bot />
        <RailLabel label={label} short={t("nav.items.dashboard.short")} />
      </SidebarMenuButton>
      {updates > 0 && (
        <>
          <SidebarMenuBadge className="rounded-full bg-destructive px-1.5 font-semibold text-white peer-hover/menu-button:text-white peer-data-[active=true]/menu-button:text-white">
            {updates > 99 ? "99+" : updates}
          </SidebarMenuBadge>
          <span aria-hidden className="pointer-events-none absolute top-1.5 left-1/2 ml-1.5 hidden size-2 rounded-full bg-destructive group-data-[collapsible=icon]:block" />
        </>
      )}
    </SidebarMenuItem>
  )
}
