import React from "react"
import { BookOpen, CircleHelp, Compass } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu"
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "@renderer/components/ui/sidebar"
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
 * Help: the guided tour again, and the user guide. The tour only ran once on
 * its own, so someone who skipped it had no way back to it.
 */
export function NavHelp(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { isMobile } = useSidebar()
  const label = t("nav.help.label")
  const language = i18n.resolvedLanguage ?? i18n.language

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton tooltip={label} data-tour="help" data-testid="nav-help" className={RAIL_BUTTON}>
            <CircleHelp />
            <RailLabel label={label} short={t("nav.help.short")} />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="start" className="min-w-56">
          <DropdownMenuItem
            data-testid="nav-help-tour"
            onSelect={() => useUiStore.getState().startTour()}
          >
            <Compass />
            {t("nav.help.replayTour")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {DOC_LINKS.map(({ page, key }) => (
            <DropdownMenuItem key={page} onSelect={() => window.api.openExternal(docsUrl(page, language))}>
              <BookOpen />
              {t(key)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}
