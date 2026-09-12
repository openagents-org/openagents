import React from "react"
import { useTranslation } from "react-i18next"

import type { CatalogEntry } from "@renderer/types"

import { describeEntry } from "../entry-meta"

/**
 * The agent's own long description when it ships one (whitespace preserved —
 * the registry never delivers HTML, so React's escaping is enough), falling
 * back to the translated blurb. Long-form English beats a one-line
 * translation here; the card grid, where space is tight, prefers the reverse.
 *
 * It fills the document column rather than carrying a measure of its own. A
 * `ch` cap is counted on the "0" glyph at the CURRENT size, and at 12px a
 * 65ch paragraph came to about 460px — half the column, with the description
 * wrapping mid-sentence beside a hole the width of itself. The column is
 * already bounded (the page is `max-w-7xl` less the rail), which is the
 * constraint that was actually wanted.
 */
export function DetailOverview({
  entry,
}: {
  entry: CatalogEntry
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <p className="m-0 text-xs leading-loose whitespace-pre-wrap text-muted-foreground">
      {entry.long_description ||
        describeEntry(entry, t) ||
        t("agents.readme.noDescription")}
    </p>
  )
}
