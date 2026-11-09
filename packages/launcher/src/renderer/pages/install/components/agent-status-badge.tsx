import React from "react"
import { useTranslation } from "react-i18next"

import { StatusBadge, type StatusBadgeTone } from "@renderer/components/ui-kit"

import type { EntryStatus } from "../entry-meta"

const TONE: Record<EntryStatus, StatusBadgeTone> = {
  installed: "success",
  update: "warning",
  available: "neutral",
  comingSoon: "neutral",
}

/** One chip, four states — the shared status badge, its dot carrying the state. */
export function AgentStatusBadge({
  status,
  className,
}: {
  status: EntryStatus
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <StatusBadge tone={TONE[status]} className={className}>
      {t(`install.status.${status}`)}
    </StatusBadge>
  )
}
