import React from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "../ui/badge"
import { Card } from "../ui/card"
import { PlatformLogo } from "./PlatformLogo"
import { ConnectionStatusBadge } from "./ConnectionStatusBadge"
import { PlatformCardActions } from "./PlatformCardActions"
import { relativeTime } from "./relative-time"
import type { PlatformDef } from "./platforms"
import type { ConnectionRecord } from "../../types"

interface Props {
  platform: PlatformDef
  connection: ConnectionRecord | null
  onConnect: () => void
  onReconnect: () => void
  onTest: () => void
  onDisconnect: () => void
  onApplyToAgents: () => void
  onConfigureMcp: () => void
  /** Platform has a hosted MCP endpoint the launcher can register. */
  hasMcp: boolean
  busy: boolean
}

export function PlatformCard({
  platform,
  connection,
  busy,
  hasMcp,
  ...actions
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const synced = relativeTime(t, connection?.lastSyncAt)

  return (
    <Card className="h-full gap-3 px-4 py-4 transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        <PlatformLogo platform={platform} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">
              {platform.label}
            </span>
            {platform.support === "planned" && (
              <Badge variant="secondary" size="sm">
                {t("connections.card.planned")}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-2xs leading-snug text-muted-foreground">
            {platform.blurb}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 text-2xs">
        <div className="flex items-center justify-between gap-2">
          <ConnectionStatusBadge status={connection?.status || "disconnected"} />
          {synced && (
            <span className="text-3xs text-muted-foreground">
              {t("connections.card.synced", { time: synced })}
            </span>
          )}
        </div>
        {connection?.account && (
          <p className="truncate">
            <span className="text-muted-foreground">
              {t("connections.card.account")}
            </span>
            {connection.account}
          </p>
        )}
        {connection?.lastError && connection.status !== "connected" && (
          <p className="truncate text-(--danger-text)" title={connection.lastError}>
            {connection.lastError}
          </p>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-3">
        <PlatformCardActions
          platform={platform}
          connection={connection}
          busy={busy}
          hasMcp={hasMcp}
          {...actions}
        />
      </div>
    </Card>
  )
}
