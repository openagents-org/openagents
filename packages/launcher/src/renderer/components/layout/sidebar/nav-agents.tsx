import React from "react"
import { Bot } from "lucide-react"
import { useTranslation } from "react-i18next"

import { SidebarMenuButton, SidebarMenuItem } from "@renderer/components/ui/sidebar"
import { useAccountStore } from "@renderer/store/account"
import { useUiStore } from "@renderer/store/ui"
import { capture } from "@renderer/lib/analytics"
import { RAIL_BUTTON, RailLabel } from "./rail-label"

/**
 * Connect Agents — this computer's agents, and the way to every new one. It
 * carries no badge: pending agent updates are listed in the marketplace, and a
 * red count here read as unhandled alerts rather than optional upgrades.
 */
export function NavAgents(): React.JSX.Element {
  const { t } = useTranslation()
  const inLauncher = useAccountStore((s) => s.mode === "launcher")
  // The marketplace has no entry of its own; it is reached from here, so this
  // entry stays lit while it is open.
  const onAgents = useUiStore((s) => s.currentTab === "dashboard" || s.currentTab === "install")
  const active = inLauncher && onAgents
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
    </SidebarMenuItem>
  )
}
