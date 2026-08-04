import React from "react"
import { useTranslation } from "react-i18next"

import { cn } from "@renderer/lib/utils"

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

/**
 * Catalog counters for the page header. Zero counts still render — "0 待更新"
 * is the answer to "is anything out of date?", and hiding it would leave the
 * question open.
 */
export function MarketplaceStats({
  counts,
}: {
  counts: MarketplaceCounts
}): React.JSX.Element {
  const { t } = useTranslation()
  const keys = Object.keys(TONE) as Array<keyof MarketplaceCounts>

  return (
    <div className="flex items-center gap-2 text-2xs text-muted-foreground">
      {keys.map((key, i) => (
        <React.Fragment key={key}>
          {i > 0 && <span className="opacity-40">/</span>}
          <span>
            <span className={cn("font-semibold", TONE[key])}>{counts[key]}</span>{" "}
            {t(`install.stats.${key}`)}
          </span>
        </React.Fragment>
      ))}
    </div>
  )
}
