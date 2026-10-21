import React from "react"
import { Search } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Kbd } from "@renderer/components/ui/kbd"
import { openCommandPalette } from "@renderer/components/command-palette/open"
import { PALETTE_SHORTCUT } from "@renderer/lib/platform"

/**
 * Reads as an input, behaves as a button: typing happens inside the command
 * palette, so a real field here would only duplicate the focus.
 */
export function TopSearch(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      title={t("ui.topBar.openCommandPalette")}
      data-testid="top-search"
      className="flex h-8 w-64 min-w-0 items-center gap-2 rounded-md border bg-card px-2.5 text-muted-foreground transition-colors hover:border-(--border-hover) hover:text-foreground"
    >
      <Search className="size-3.5 shrink-0" />
      <span className="flex-1 truncate text-left text-xs">{t("nav.search")}</span>
      <Kbd className="text-2xs">{PALETTE_SHORTCUT}</Kbd>
    </button>
  )
}
