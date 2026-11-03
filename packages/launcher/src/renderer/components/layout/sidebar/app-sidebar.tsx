import React from "react"
import { useTranslation } from "react-i18next"

import {
  Sidebar,
  SidebarContent,
  SidebarRail,
} from "@renderer/components/ui/sidebar"
import { NavComputer } from "./nav-computer"
import { SidebarBrand } from "./sidebar-brand"
import { SidebarStatus } from "./sidebar-status"

/**
 * This Computer's navigation: the switch to the Workspace and the app and this
 * computer at the top (SidebarBrand), This Computer's menu, and this
 * computer's status at the bottom. The Workspace side has no
 * sidebar — the web app brings its own — and switches with the tab bar across
 * its top instead (WorkspaceBar).
 *
 * At the bottom, this computer's state rather than an account: This Computer
 * works without one, and the workspace shows who is signed in itself.
 *
 * Collapsible to an icon rail; only the user collapses or widens it (see
 * store/sidebar.ts).
 */
export function AppSidebar(): React.JSX.Element {
  const { t } = useTranslation()
  const toggle = t("nav.toggleSidebar")
  return (
    <Sidebar collapsible="icon">
      <SidebarBrand />
      <SidebarContent>
        <NavComputer />
      </SidebarContent>
      <SidebarStatus />
      <SidebarRail aria-label={toggle} title={toggle} />
    </Sidebar>
  )
}
