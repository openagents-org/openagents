import React from "react"
import { Search } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/shadcn/button"
import { Kbd } from "@renderer/components/shadcn/kbd"
import { cn } from "@renderer/lib/utils"

interface PageHeaderProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Rendered on the right, before the search box. */
  actions?: React.ReactNode
  /** Shows the ⌘K box that opens the command palette. */
  showSearch?: boolean
  className?: string
}

/** Replays ⌘K so the globally-mounted palette opens; it owns its own state. */
function openCommandPalette(): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true }),
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
  showSearch = false,
  className,
}: PageHeaderProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <header
      className={cn(
        "flex shrink-0 items-center justify-between gap-4 border-b px-9 py-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="m-0 truncate text-xl font-bold tracking-tight">{title}</h1>
        {subtitle && (
          <span className="truncate text-sm text-muted-foreground">{subtitle}</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {actions}
        {showSearch && (
          <Button
            variant="outline"
            onClick={openCommandPalette}
            title={t("ui.topBar.openCommandPalette")}
            className="h-8 min-w-65 justify-start gap-2 px-3 font-normal text-muted-foreground"
          >
            <Search className="size-3.5" />
            <span className="flex-1 text-left text-xs">
              {t("ui.topBar.searchPlaceholder")}
            </span>
            <Kbd>⌘K</Kbd>
          </Button>
        )}
      </div>
    </header>
  )
}
