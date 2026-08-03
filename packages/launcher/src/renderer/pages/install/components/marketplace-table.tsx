import React from "react"
import { useTranslation } from "react-i18next"

import AgentIcon from "@renderer/components/AgentIcon"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table"
import { cn } from "@renderer/lib/utils"

import { describeEntry } from "../entry-meta"
import type { MarketplaceRow } from "../use-marketplace"
import { AgentActionButton } from "./agent-action-button"
import { AgentStatusBadge } from "./agent-status-badge"

const COLUMNS = ["agent", "status", "version", "runtime", "actions"] as const

interface Props {
  rows: MarketplaceRow[]
  onOpen: (name: string) => void
  onInstall: (row: MarketplaceRow) => void
}

/**
 * List view. Every agent carries the same four facts — state, version,
 * runtime, one action — and comparing them across the catalog is the whole
 * point of this view, so it's a table rather than a stack of cards.
 */
export function MarketplaceTable({
  rows,
  onOpen,
  onInstall,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((c) => (
              <TableHead key={c} className={c === "actions" ? "text-right" : undefined}>
                {t(`install.table.${c}`)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <Row key={row.entry.name} row={row} onOpen={onOpen} onInstall={onInstall} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function Row({
  row,
  onOpen,
  onInstall,
}: { row: MarketplaceRow } & Omit<Props, "rows">): React.JSX.Element {
  const { t } = useTranslation()
  const { entry, status } = row
  const disabled = status === "comingSoon"
  const open = (): void => {
    if (!disabled) onOpen(entry.name)
  }

  return (
    <TableRow
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      data-testid={`agent-card-${entry.name}`}
      data-installed={entry.installed ? "true" : "false"}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter") open()
      }}
      className={cn(disabled ? "opacity-60" : "cursor-pointer")}
    >
      <TableCell>
        <div className="flex items-center gap-3">
          <AgentIcon type={entry.name} size={30} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {entry.label || entry.name}
            </div>
            <div className="truncate text-2xs text-muted-foreground">
              {describeEntry(entry, t) || t("install.card.noDescription")}
            </div>
          </div>
        </div>
      </TableCell>

      <TableCell>
        <AgentStatusBadge status={status} />
      </TableCell>

      <TableCell className="font-mono text-2xs text-muted-foreground">
        {row.version ? `v${row.version}` : "—"}
      </TableCell>

      <TableCell className="font-mono text-2xs text-muted-foreground">
        {row.runtime || t("install.hero.builtin")}
      </TableCell>

      {/* The row itself opens the detail page, so a click on the button must
          not also count as a click on the row. */}
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        <AgentActionButton
          name={entry.name}
          status={status}
          job={row.job}
          onInstall={() => onInstall(row)}
          onManage={() => onOpen(entry.name)}
        />
      </TableCell>
    </TableRow>
  )
}
