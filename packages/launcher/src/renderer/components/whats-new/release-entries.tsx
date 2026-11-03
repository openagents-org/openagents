import React from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@renderer/components/ui/badge"
import {
  localized,
  type Release,
  type ReleaseEntryType,
} from "@renderer/lib/changelog"

/**
 * Entry type → chip weight, in shadcn's own badge variants: solid for what is
 * new, soft grey for an improvement, outlined for a fix. The neutral theme
 * has no accent colour, so the three are told apart by weight rather than
 * hue — green and amber chips were the only colour left in the dialog. The
 * outline keeps full-strength text, so a fix does not read as disabled.
 */
const TONE: Record<ReleaseEntryType, "default" | "secondary" | "outline"> = {
  feature: "default",
  improvement: "secondary",
  fix: "outline",
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
      {/* A hairline between changes: with only a gap, each title sat as close
          to the previous description as to its own. */}
      <ul className="m-0 flex list-none flex-col divide-y p-0">
        {release.entries.map((entry, i) => (
          <li key={i} className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
            {/* One width for all three, so the titles start on a common left
                edge. Sized to the label, the column jumped between entries —
                barely visible in Chinese, where the three words are nearly the
                same width, and obviously ragged in English, where "New" and
                "Improved" are not. */}
            <Badge
              variant={TONE[entry.type]}
              size="sm"
              className="mt-0.5 w-16 shrink-0 justify-center"
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
                <p className="mt-1.5 mb-0 text-xs leading-relaxed text-muted-foreground">
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
