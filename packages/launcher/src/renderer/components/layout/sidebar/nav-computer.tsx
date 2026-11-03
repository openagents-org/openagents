import React from "react"
import { Layers } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@renderer/components/ui/sidebar"
import { useAccountStore } from "@renderer/store/account"
import { useUiStore } from "@renderer/store/ui"
import { capture } from "@renderer/lib/analytics"
import { NavAgents } from "./nav-agents"
import { NavSettings } from "./nav-settings"
import { RAIL_BUTTON, RailLabel } from "./rail-label"

/**
 * This Computer's menu: its agents, the workspaces it has joined as a device,
 * and Settings unfolding in place.
 */
export function NavComputer(): React.JSX.Element {
  const { t } = useTranslation()
  const onJoined = useUiStore((s) => s.currentTab === "workspaces")
  const label = t("nav.items.workspaces.label")
  return (
    <SidebarGroup>
      <SidebarMenu className="group-data-[collapsible=icon]:items-center">
        <NavAgents />
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={onJoined}
            tooltip={label}
            data-tour="workspaces"
            data-testid="nav-workspaces"
            className={RAIL_BUTTON}
            onClick={() => {
              capture("tab_switched", { tab: "workspaces" })
              useAccountStore.getState().exitWorkspace("workspaces")
            }}
          >
            <Layers />
            <RailLabel label={label} short={t("nav.items.workspaces.short")} />
          </SidebarMenuButton>
        </SidebarMenuItem>
        <NavSettings />
      </SidebarMenu>
    </SidebarGroup>
  )
}
