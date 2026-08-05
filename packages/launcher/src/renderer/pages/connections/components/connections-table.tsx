import React from "react"
import { useTranslation } from "react-i18next"

import { ConnectionStatusBadge } from "@renderer/components/connections/ConnectionStatusBadge"
import { PlatformLogo } from "@renderer/components/connections/PlatformLogo"
import { Badge } from "@renderer/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table"
import { relativeTimeAgo } from "@renderer/lib/relative-time"
import type { ConnectionRecord } from "@renderer/types"

import type { ConnectionRow } from "../use-connections-view"
import { ConnectionActions } from "./connection-actions"

const COLUMNS = ["platform", "purpose", "status", "lastSync", "actions"] as const

export interface ConnectionRowHandlers {
  onConnect: (row: ConnectionRow) => void
  onTest: (conn: ConnectionRecord) => void
  onDisconnect: (conn: ConnectionRecord) => void
  onApplyToAgents: (conn: ConnectionRecord) => void
  onConfigureMcp: (row: ConnectionRow) => void
}

interface Props extends ConnectionRowHandlers {
  rows: ConnectionRow[]
  /** Platform ids the launcher can register as an MCP server. */
  mcpPlatforms: Set<string>
  busyId: string | null
}

/**
 * One row per platform, connected or not. A table rather than cards: every
 * platform carries the same few facts and the point of the page is comparing
 * them — which are live, which are stale, which can't be used yet.
 *
 * There is no "scopes" column. Only an OAuth grant returns scopes and nothing
 * here uses OAuth yet, so it was a column of dashes; whatever a connection
 * does report rides along under its status instead.
 */
export function ConnectionsTable({
  rows,
  mcpPlatforms,
  busyId,
  ...handlers
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {/* Same scale and gutters as the agents table. Five columns at the
          1200px minimum window leave ~856px, and the fixed platform catalog
          spends ~816px of it — see the per-cell caps below, which are what
          keep the table off its own horizontal scrollbar. */}
      <Table className="[&_td]:px-3 [&_th]:px-3">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((c) => (
              <TableHead
                key={c}
                className={c === "actions" ? "text-center" : undefined}
              >
                {t(`connections.table.${c}`)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <Row
              key={row.platform.id}
              row={row}
              hasMcp={mcpPlatforms.has(row.platform.id)}
              busy={!!row.connection && busyId === row.connection.id}
              {...handlers}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function Row({
  row,
  hasMcp,
  busy,
  onConnect,
  onTest,
  onDisconnect,
  onApplyToAgents,
  onConfigureMcp,
}: ConnectionRowHandlers & {
  row: ConnectionRow
  hasMcp: boolean
  busy: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { platform, connection } = row
  // Whatever the connection can say about itself, in priority order: what
  // broke, who it is, what it may touch.
  const detail = !row.connected
    ? connection?.lastError
    : connection?.account || connection?.scopes?.join(", ")

  return (
    <TableRow className="h-16">
      <TableCell>
        <div className="flex items-center gap-3">
          <PlatformLogo platform={platform} size={32} />
          <span className="truncate text-sm font-medium">{platform.label}</span>
          {row.planned && (
            <Badge variant="muted" size="sm">
              {t("connections.card.planned")}
            </Badge>
          )}
        </div>
      </TableCell>

      <TableCell>
        {/* Wraps rather than truncates. The blurb is the only cell whose text
            the launcher writes itself, and at this width the longest one needs
            a second line — which the row, already two lines tall next door in
            the status cell, has room for. Falls back to the catalog's own
            English blurb for a platform added after the translations were
            written. */}
        <div className="line-clamp-2 max-w-36 whitespace-normal text-sm text-muted-foreground">
          {t(`connections.platforms.${platform.id}`, {
            defaultValue: platform.blurb,
          })}
        </div>
      </TableCell>

      <TableCell>
        <ConnectionStatusBadge
          size="default"
          status={connection?.status || "disconnected"}
        />
        {detail && (
          // An account or an error message — arbitrary length, so it is capped
          // and tooltipped exactly like the agents table's error line.
          <div
            className={
              row.connected
                ? "mt-1 max-w-40 truncate text-2xs text-muted-foreground"
                : "mt-1 max-w-40 truncate text-2xs text-destructive"
            }
            title={detail}
          >
            {detail}
          </div>
        )}
      </TableCell>

      <TableCell className="text-xs text-muted-foreground">
        {relativeTimeAgo(t, connection?.lastSyncAt) || "—"}
      </TableCell>

      <TableCell>
        <ConnectionActions
          platform={platform}
          connection={connection}
          busy={busy}
          hasMcp={hasMcp}
          onConnect={() => onConnect(row)}
          onTest={() => connection && onTest(connection)}
          onDisconnect={() => connection && onDisconnect(connection)}
          onApplyToAgents={() => connection && onApplyToAgents(connection)}
          onConfigureMcp={() => onConfigureMcp(row)}
        />
      </TableCell>
    </TableRow>
  )
}
