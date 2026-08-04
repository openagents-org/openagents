import React from "react"
import { useTranslation } from "react-i18next"

import type { CatalogEntry } from "@renderer/types"

import { describeEntry } from "../entry-meta"

/**
 * The agent's own long description when it ships one (whitespace preserved —
 * the registry never delivers HTML, so React's escaping is enough), falling
 * back to the translated blurb. Long-form English beats a one-line
 * translation here; the card grid, where space is tight, prefers the reverse.
 */
export function DetailOverview({
  entry,
}: {
  entry: CatalogEntry
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <p className="m-0 max-w-prose text-xs leading-loose whitespace-pre-wrap text-muted-foreground">
      {entry.long_description ||
        describeEntry(entry, t) ||
        t("agents.readme.noDescription")}
    </p>
  )
}
