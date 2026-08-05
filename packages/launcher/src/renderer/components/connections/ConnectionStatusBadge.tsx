import * as React from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "../ui/badge"
import { cn } from "../../lib/utils"
import type { ConnectionStatus } from "../../types"

type Tone = "success" | "warning" | "danger" | "secondary"

const TONE: Record<ConnectionStatus, Tone> = {
  connected: "success",
  expired: "warning",
  rate_limited: "warning",
  unauthorized: "danger",
  error: "danger",
  disconnected: "secondary",
  offline: "secondary",
}

const DOT: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  secondary: "bg-muted-foreground",
}

export function ConnectionStatusBadge({
  status,
  size = "sm",
  className,
}: {
  status: ConnectionStatus
  /** `default` in the connections table, where it sits at the agents-page
   *  scale; `sm` everywhere it rides along inside denser content. */
  size?: "default" | "sm"
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const tone = TONE[status]

  return (
    <Badge variant={tone} size={size} className={cn("gap-1.5", className)}>
      <span className={cn("inline-block size-1.5 rounded-full", DOT[tone])} />
      {t(`connections.status.${status}`)}
    </Badge>
  )
}
