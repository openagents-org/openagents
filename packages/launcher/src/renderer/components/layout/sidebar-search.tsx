import React from "react"
import { Search } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Kbd } from "@renderer/components/ui/kbd"
import { openCommandPalette } from "@renderer/components/command-palette/open"

/**
 * The rail's search affordance: reads as an input, behaves as a button. Typing
 * happens inside the palette, so an actual field here would only duplicate the
 * focus. Collapsed, it shrinks to the icon like every other rail control.
 */
export function SidebarSearch(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <button
      type="button"
      onClick={openCommandPalette}
      title={t("ui.topBar.openCommandPalette")}
      data-testid="sidebar-search"
      className="flex h-8 w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2 text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
    >
      <Search className="size-3.5 shrink-0" />
      <span className="flex-1 truncate text-left text-xs group-data-[collapsible=icon]:hidden">
        {t("nav.search")}
      </span>
      <Kbd className="bg-sidebar-border/60 text-2xs text-sidebar-muted group-data-[collapsible=icon]:hidden">
        ⌘K
      </Kbd>
    </button>
  )
}
