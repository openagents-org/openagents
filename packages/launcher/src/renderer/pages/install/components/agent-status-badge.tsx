import React from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@renderer/components/ui/badge"
import { cn } from "@renderer/lib/utils"

import { STATUS_VARIANT, type EntryStatus } from "../entry-meta"

const DOT: Record<EntryStatus, string> = {
  installed: "bg-success",
  update: "bg-warning",
  available: "bg-muted-foreground",
  comingSoon: "bg-muted-foreground",
}

/**
 * One chip, four states. The leading dot carries the state even where the tint
 * is faint (a `muted` chip on a card that is already muted), which is what
 * keeps "not installed" legible next to "installed".
 */
export function AgentStatusBadge({
  status,
  className,
}: {
  status: EntryStatus
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Badge variant={STATUS_VARIANT[status]} className={cn("gap-1.5", className)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", DOT[status])} />
      {t(`install.status.${status}`)}
    </Badge>
  )
}
