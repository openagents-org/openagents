import React from "react"
import { useTranslation } from "react-i18next"

import { cn } from "@renderer/lib/utils"
import type { StatusFilter } from "../use-marketplace"

export interface MarketplaceCounts {
  available: number
  installed: number
  updatable: number
}

const TONE: Record<keyof MarketplaceCounts, string> = {
  available: "text-foreground",
  installed: "text-success",
  updatable: "text-warning",
}

/** Which filter each counter turns on. "available" is the reset. */
const FILTER: Record<keyof MarketplaceCounts, StatusFilter> = {
  available: "all",
  installed: "installed",
  updatable: "updatable",
}

/**
 * Catalog counters for the page header, each one a filter.
 *
 * They started as plain text, which left "1 待更新" as a fact with nowhere to
 * go: the one agent it referred to was somewhere in a list of a dozen, and the
 * only way to find it was to scroll and read badges. Clicking a counter now
 * narrows the catalog to exactly what it counts (and clicking the active one
 * again clears it) — with the single-update case jumping straight to that
 * agent, since a filter showing one row helps nobody.
 *
 * Zero counts still render — "0 待更新" is the answer to "is anything out of
 * date?" — but a zero is not clickable; there is nothing to show.
 */
export function MarketplaceStats({
  counts,
  active = "all",
  onSelect,
}: {
  counts: MarketplaceCounts
  active?: StatusFilter
  onSelect?: (filter: StatusFilter) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const keys = Object.keys(TONE) as Array<keyof MarketplaceCounts>

  return (
    <div className="flex items-center gap-2 text-2xs text-muted-foreground">
      {keys.map((key, i) => {
        const filter = FILTER[key]
        const isActive = active === filter && filter !== "all"
        // "available" is always actionable — it is how you get back to the full
        // list — but a zero counter has nothing to filter to.
        const actionable = !!onSelect && (filter === "all" || counts[key] > 0)

        return (
          <React.Fragment key={key}>
            {i > 0 && <span className="opacity-40">/</span>}
            <button
              type="button"
              data-testid={`stats-filter-${key}`}
              disabled={!actionable}
              aria-pressed={isActive}
              title={t(`install.stats.filterHint.${key}`)}
              onClick={() => onSelect?.(isActive ? "all" : filter)}
              className={cn(
                "rounded-sm px-1 py-0.5 transition-colors",
                actionable
                  ? "cursor-pointer hover:bg-muted"
                  : "cursor-default opacity-70",
                isActive && "bg-muted text-foreground",
              )}
            >
              <span className={cn("font-semibold", TONE[key])}>
                {counts[key]}
              </span>{" "}
              {t(`install.stats.${key}`)}
            </button>
          </React.Fragment>
        )
      })}
    </div>
  )
}
