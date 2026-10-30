import React from "react"
import { Monitor } from "lucide-react"
import { useTranslation } from "react-i18next"

import { StatusDot } from "@renderer/components/ui-kit"
import { useDeviceReadout } from "./use-device-readout"
import { ThemeMenu } from "./theme-menu"
import { NotificationBell } from "./notification-bell"

/**
 * One quiet line along the bottom of This Computer: which machine this is,
 * what its agents are doing, the app version, and the theme and notification
 * controls.
 */
export function StatusFooter(): React.JSX.Element {
  const { t } = useTranslation()
  const { hostname, status, statusLabel, version } = useDeviceReadout()
  return (
    <footer
      className="flex h-10 shrink-0 items-center gap-2 border-t bg-background px-9 text-xs text-muted-foreground"
      data-testid="status-footer"
    >
      <Monitor className="size-4 shrink-0" />
      <span className="truncate text-foreground">{hostname || t("agents.shared.thisComputer")}</span>
      <span aria-hidden>·</span>
      {/* `stopped` is a deliberate state, not a fault — StatusDot renders it in
          the same muted tone as no agents at all, which is the intent. */}
      <StatusDot state={status} />
      <span className="truncate">{statusLabel}</span>
      <span className="ml-auto shrink-0 font-mono">{version}</span>
      <span aria-hidden className="mx-1 h-4 w-px bg-border" />
      <div className="flex shrink-0 items-center gap-0.5">
        <ThemeMenu />
        <NotificationBell />
      </div>
    </footer>
  )
}
