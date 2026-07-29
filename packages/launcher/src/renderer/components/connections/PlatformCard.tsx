import React from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { MoreHorizontal } from "lucide-react"
import { Button } from "../ui/Button"
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/DropdownMenu"
import { PlatformLogo } from "./PlatformLogo"
import { ConnectionStatusBadge } from "./ConnectionStatusBadge"
import type { PlatformDef } from "./platforms"
import type { ConnectionRecord } from "../../types"

/**
 * Relative sync time, or null when the platform has never been synced — the
 * caller then omits the line entirely rather than rendering "Synced never",
 * which read as broken on the (majority) disconnected cards.
 */
function relativeTime(t: TFunction, iso?: string): string | null {
  if (!iso) return null
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return null
  const diff = Date.now() - ts
  if (diff < 60_000) return t("connections.relativeTime.justNow")
  if (diff < 3_600_000)
    return t("connections.relativeTime.minutesAgo", { count: Math.floor(diff / 60_000) })
  if (diff < 86_400_000)
    return t("connections.relativeTime.hoursAgo", { count: Math.floor(diff / 3_600_000) })
  return t("connections.relativeTime.daysAgo", { count: Math.floor(diff / 86_400_000) })
}

export function PlatformCard({
  platform,
  connection,
  onConnect,
  onReconnect,
  onTest,
  onDisconnect,
  onApplyToAgents,
  onConfigureMcp,
  hasMcp,
  busy,
}: {
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
}): React.JSX.Element {
  const { t } = useTranslation()
  const planned = platform.support === "planned"
  const connected = connection?.status === "connected"
  const synced = relativeTime(t, connection?.lastSyncAt)
  return (
    <div className="flex flex-col h-full bg-(--bg-card) border border-(--border) rounded-(--radius) px-[18px] py-4 shadow-sm transition-all duration-200 hover:shadow-md hover:border-(--border-hover)">
      <div className="flex items-start gap-3 mb-3">
        <PlatformLogo platform={platform} size={40} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[13px] tracking-tight text-(--text-primary)">
              {platform.label}
            </span>
            {planned && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-(--bg-input) text-(--text-tertiary)">
                {t("connections.card.planned")}
              </span>
            )}
          </div>
          <div className="text-[11px] text-(--text-tertiary) leading-snug mt-0.5">
            {platform.blurb}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 mb-3 text-[11px] text-(--text-secondary)">
        <div className="flex items-center justify-between gap-2">
          <ConnectionStatusBadge status={connection?.status || "disconnected"} />
          {synced && (
            <span className="text-[10px] text-(--text-tertiary)">
              {t("connections.card.synced", { time: synced })}
            </span>
          )}
        </div>
        {connection?.account && (
          <div className="text-(--text-secondary) truncate">
            <span className="text-(--text-tertiary)">{t("connections.card.account")}</span>
            {connection.account}
          </div>
        )}
        {connection?.lastError && connection.status !== "connected" && (
          <div className="text-(--danger-text) truncate" title={connection.lastError}>
            {connection.lastError}
          </div>
        )}
      </div>

      {/* One row, always. A connected platform has up to five actions and the
          card's content box is only ~260px wide, so everything past the single
          most useful action lives behind the ⋯ menu rather than wrapping. */}
      <div className="flex items-center gap-2 mt-auto pt-3">
        {/* A planned platform can't be connected yet, but one that was already
            connected before it got demoted still needs Test/Disconnect — don't
            strand the record. */}
        {planned && !connection ? (
          // Disabled rather than absent, so every card's action row sits at the
          // same weight; the hint explains why it can't be pressed.
          <Button size="sm" disabled title={t("connections.card.plannedHint")}>
            {t("connections.card.connect")}
          </Button>
        ) : !connection ? (
          <Button size="sm" variant="primary" onClick={onConnect} disabled={busy}>
            {t("connections.card.connect")}
          </Button>
        ) : (
          <>
            {/* What the card is *for* depends on status: a healthy connection
                wants handing to agents, a broken one wants fixing. Whichever it
                is gets the one visible button; the rest go in the menu. */}
            {!connected ? (
              <Button size="sm" variant="primary" onClick={onReconnect} disabled={busy}>
                {t("connections.card.reconfigure")}
              </Button>
            ) : hasMcp ? (
              <Button size="sm" variant="primary" onClick={onConfigureMcp} disabled={busy}>
                {t("connections.card.configureMcp")}
              </Button>
            ) : (
              platform.defaultEnvKey && (
                <Button size="sm" variant="primary" onClick={onApplyToAgents} disabled={busy}>
                  {t("connections.card.applyToAgents")}
                </Button>
              )
            )}

            {/* Pushed to the right edge so the action row echoes the status row
                above it, which is also justified to both edges. */}
            <DropdownMenu
              className="ml-auto"
              trigger={
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-0 w-7"
                  disabled={busy}
                  title={t("connections.card.more")}
                  aria-label={t("connections.card.more")}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              }
            >
              {/* Only surfaced here when it isn't already the primary button. */}
              {connected && hasMcp && platform.defaultEnvKey && (
                <DropdownMenuItem onSelect={onApplyToAgents}>
                  {t("connections.card.applyToAgents")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onTest}>
                {t("connections.card.test")}
              </DropdownMenuItem>
              {connected && (
                <DropdownMenuItem onSelect={onReconnect}>
                  {t("connections.card.reconfigure")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={onDisconnect}>
                {t("connections.card.disconnect")}
              </DropdownMenuItem>
            </DropdownMenu>
          </>
        )}
      </div>
    </div>
  )
}
