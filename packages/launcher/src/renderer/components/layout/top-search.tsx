import React from "react"
import { Search } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { openCommandPalette } from "@renderer/components/command-palette/open"
import { PALETTE_SHORTCUT } from "@renderer/lib/platform"

/**
 * The top bar's way into the command palette: just the icon, since typing
 * happens inside the palette and a field here would only duplicate the focus.
 */
export function TopSearch(): React.JSX.Element {
  const { t } = useTranslation()
  const label = `${t("ui.topBar.openCommandPalette")} (${PALETTE_SHORTCUT})`
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={openCommandPalette}
      aria-label={label}
      title={label}
      data-testid="top-search"
      className="size-8 text-muted-foreground hover:text-foreground"
    >
      <Search className="size-4" />
    </Button>
  )
}
