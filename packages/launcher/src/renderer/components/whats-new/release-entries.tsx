import React from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@renderer/components/ui/badge"
import {
  localized,
  type Release,
  type ReleaseEntryType,
} from "@renderer/lib/changelog"

/**
 * Entry type → chip tint. Three distinct hues rather than a grey for fixes:
 * the neutral chip sat at the same lightness as the dialog behind it and read
 * as disabled text.
 */
const TONE: Record<ReleaseEntryType, "default" | "success" | "warning"> = {
  feature: "default",
  improvement: "success",
  fix: "warning",
}

/**
 * One release, rendered as a list of labelled changes.
 *
 * Shared by everything that shows notes: "What's new" after an update, and —
 * since updates now ask before they download or install — the update offer
 * dialog and Settings → Updates, which describe a version the user has *not*
 * installed yet. One renderer, so "what changed" looks the same whether it is a promise
 * or a summary.
 */
export function ReleaseEntries({
  release,
  showHeading = false,
}: {
  release: Release
  /** Version + date above the list; needed only when several are stacked. */
  showHeading?: boolean
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const language = i18n.language

  return (
    <section>
      {showHeading && (
        <div className="mb-3 flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold">
            v{release.version}
          </span>
          <span className="text-2xs text-muted-foreground">{release.date}</span>
        </div>
      )}
      <ul className="m-0 flex list-none flex-col gap-4 p-0">
        {release.entries.map((entry, i) => (
          <li key={i} className="flex items-start gap-2.5">
            {/* One width for all three, so the titles start on a common left
                edge. Sized to the label, the column jumped between entries —
                barely visible in Chinese, where the three words are nearly the
                same width, and obviously ragged in English, where "New" and
                "Improved" are not. */}
            <Badge
              variant={TONE[entry.type]}
              size="sm"
              className="mt-0.5 w-20 shrink-0 justify-center"
            >
              {t(`whatsNew.types.${entry.type}`)}
            </Badge>
            {/* Two levels: the change in a few words, then the detail. A single
                paragraph made every line weigh the same, so scanning the list
                meant reading all of it. */}
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {localized(entry.title, language)}
              </div>
              {entry.description && (
                <p className="mt-1 mb-0 text-xs leading-relaxed text-muted-foreground">
                  {localized(entry.description, language)}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
