import React from "react"
import { useTranslation } from "react-i18next"

import { cn } from "@renderer/lib/utils"
import type { CatalogEntry } from "@renderer/types"

import { CATEGORIES } from "../categories"

interface Props {
  catalog: CatalogEntry[]
  category: string
  onCategoryChange: (key: string) => void
}

/**
 * Category chips. A category that matches nothing in the current catalog is
 * hidden so the row isn't a list of always-empty buckets — except the active
 * one, which stays put; a chip that vanished on click would read as a glitch.
 */
export function MarketplaceCategories({
  catalog,
  category,
  onCategoryChange,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const visible = CATEGORIES.filter(
    (c) =>
      c.key === "all" || c.key === category || catalog.some((e) => c.match(e)),
  )

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((c) => {
        const active = c.key === category
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={active}
            onClick={() => onCategoryChange(c.key)}
            className={cn(
              "cursor-pointer rounded-full border px-3 py-1 text-2xs transition-colors",
              active
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {t(`install.categories.${c.key}`)}
          </button>
        )
      })}
    </div>
  )
}
