import React from "react"
import { useTranslation } from "react-i18next"

import { ReleaseEntries } from "@renderer/components/whats-new/release-entries"
import type { Release } from "@renderer/lib/changelog"

/**
 * What an offered update would change, shown inside the Updates panel.
 *
 * The panel used to name a version and link out to the GitHub releases page —
 * which, in a monorepo, lists every merged PR rather than what the desktop app
 * gained. These are the release's own notes, fetched from the update feed by
 * main (see main/release-notes.ts) because the bundled changelog can only ever
 * describe the build already running.
 */
export function PendingReleaseNotes({
  release,
}: {
  release: Release
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mt-1 border-t border-(--border) pt-4">
      <p className="mt-0 mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t("settings.updates.offerWhatsNew")}
      </p>
      <ReleaseEntries release={release} />
    </div>
  )
}
