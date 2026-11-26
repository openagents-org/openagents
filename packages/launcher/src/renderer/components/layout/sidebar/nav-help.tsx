import React from "react"
import { ChevronRight, CircleHelp } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@renderer/components/ui/collapsible"
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@renderer/components/ui/sidebar"
import { useSidebarStore } from "@renderer/store/sidebar"
import { useUiStore } from "@renderer/store/ui"
import { docsUrl, type DocsPage } from "@renderer/lib/docs-links"
import { RAIL_BUTTON, RailLabel } from "./rail-label"

/** The guide's chapters people ask about most, then its front page. */
const DOC_LINKS: { page: DocsPage; key: string }[] = [
  { page: "workspaceVsLauncher", key: "nav.help.workspaceVsComputer" },
  { page: "managingAgents", key: "nav.help.managingAgents" },
  { page: "overview", key: "nav.help.allDocs" },
]

/**
 * Help: the guided tour again, and the user guide. The tour only runs once on
 * its own, so someone who skipped it had no way back to it.
 *
 * It opens in place like Settings: its entries list under it and fold away
 * with a second click. In the icon rail there is nowhere to list them, so the
 * icon widens the sidebar first.
 */
export function NavHelp(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { state, isMobile } = useSidebar()
  const [open, setOpen] = React.useState(false)
  const language = i18n.resolvedLanguage ?? i18n.language
  const label = t("nav.help.label")

  const onToggle = (next: boolean): void => {
    const fromRail = state === "collapsed" && !isMobile
    if (fromRail) useSidebarStore.getState().setOpen(true)
    setOpen(fromRail || next)
  }

  return (
    <Collapsible asChild open={open} onOpenChange={onToggle} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={label} data-tour="help" data-testid="nav-help" className={RAIL_BUTTON}>
            <CircleHelp />
            <RailLabel label={label} short={t("nav.help.short")} />
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 group-data-[collapsible=icon]:hidden" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            <SidebarMenuSubItem>
              <SidebarMenuSubButton asChild>
                <button type="button" data-testid="nav-help-tour" onClick={() => useUiStore.getState().startTour()}>
                  <span>{t("nav.help.replayTour")}</span>
                </button>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
            <li aria-hidden className="mx-2 my-1 h-px bg-sidebar-border" />
            {DOC_LINKS.map(({ page, key }) => (
              <SidebarMenuSubItem key={page}>
                <SidebarMenuSubButton asChild>
                  {/* The guide opens in the browser, not in the app. */}
                  <button type="button" onClick={() => window.api.openExternal(docsUrl(page, language))}>
                    <span>{t(key)}</span>
                  </button>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}
