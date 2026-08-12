import * as React from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "../ui/badge"

export type WorkspaceHealthState =
  | "healthy"
  | "warning"
  /** No agent bound here, but this device itself is paired to the workspace. */
  | "device"
  /**
   * This device WAS paired here and has since been paired elsewhere. A device
   * can only heartbeat one workspace, so this one sees it as offline — which
   * "disconnected" alone never explained.
   */
  | "deviceMoved"
  | "disconnected"
  | "error"

/**
 * Uses the shared Badge rather than the legacy `.badge-*-sm` helpers: those are
 * square-cornered and border-less, so a card carrying both this chip and an
 * agent status chip put two different chip shapes side by side.
 */
const VARIANT = {
  healthy: "success",
  warning: "warning",
  // Informational, not green: the device is in, but nothing is running here yet.
  device: "outline",
  deviceMoved: "warning",
  disconnected: "muted",
  error: "danger",
} as const

export function WorkspaceHealth({
  state,
  className,
}: {
  state: WorkspaceHealthState
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Badge variant={VARIANT[state]} size="sm" className={className}>
      {t(`workspaces.health.${state}`)}
    </Badge>
  )
}
