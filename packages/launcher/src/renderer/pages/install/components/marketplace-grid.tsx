import React from "react"
import { useTranslation } from "react-i18next"

import AgentIcon from "@renderer/components/AgentIcon"
import { Badge } from "@renderer/components/ui/badge"
import { Card } from "@renderer/components/ui/card"
import { cn } from "@renderer/lib/utils"

import { describeEntry } from "../entry-meta"
import type { MarketplaceRow } from "../use-marketplace"
import { AgentActionButton } from "./agent-action-button"
import { AgentStatusBadge } from "./agent-status-badge"

/** Column count climbs with viewport width; breakpoints are @theme tokens. */
export const GRID =
  "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-5 5xl:grid-cols-6"

const MAX_TAGS = 3

interface Props {
  rows: MarketplaceRow[]
  onOpen: (name: string) => void
  onInstall: (row: MarketplaceRow) => void
}

export function MarketplaceGrid({
  rows,
  onOpen,
  onInstall,
}: Props): React.JSX.Element {
  return (
    <div className={GRID}>
      {rows.map((row) => (
        <AgentCard key={row.entry.name} row={row} onOpen={onOpen} onInstall={onInstall} />
      ))}
    </div>
  )
}

function AgentCard({
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
    <Card
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      data-testid={`agent-card-${entry.name}`}
      data-installed={entry.installed ? "true" : "false"}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter") open()
      }}
      className={cn(
        "gap-3.5 px-4.5 py-4 transition-colors",
        disabled ? "opacity-60" : "cursor-pointer hover:border-primary/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <AgentIcon type={entry.name} size={34} />
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">
              {entry.label || entry.name}
            </div>
            <div className="truncate font-mono text-3xs text-muted-foreground">
              {row.runtime || t("install.hero.builtin")}
            </div>
          </div>
        </div>
        <AgentStatusBadge status={status} className="shrink-0" />
      </div>

      <p className="m-0 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {describeEntry(entry, t) || t("install.card.noDescription")}
      </p>

      <div className="flex flex-wrap gap-1">
        {(entry.tags || []).slice(0, MAX_TAGS).map((tag) => (
          <Badge key={tag} variant="muted" size="sm" className="font-mono">
            {tag}
          </Badge>
        ))}
      </div>

      <div
        className="mt-auto flex items-center justify-between gap-2 border-t pt-3.5"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="font-mono text-2xs text-muted-foreground">
          {row.version ? `v${row.version}` : "—"}
        </span>
        <AgentActionButton
          name={entry.name}
          status={status}
          job={row.job}
          onInstall={() => onInstall(row)}
          onManage={() => onOpen(entry.name)}
        />
      </div>
    </Card>
  )
}
