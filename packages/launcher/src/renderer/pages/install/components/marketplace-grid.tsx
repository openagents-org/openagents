import React from "react"
import { useTranslation } from "react-i18next"

import AgentIcon from "@renderer/components/AgentIcon"
import { Badge } from "@renderer/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card"
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
  /** The row itself: open the setup form on this type. */
  onOpen: (name: string) => void
  onInstall: (row: MarketplaceRow) => void
  /** An installed type's Manage: its marketplace page (versions, uninstall). */
  onManage: (name: string) => void
}

export function MarketplaceGrid({
  rows,
  onOpen,
  onInstall,
  onManage,
}: Props): React.JSX.Element {
  return (
    <div className={GRID}>
      {rows.map((row) => (
        <AgentCard key={row.entry.name} row={row} onOpen={onOpen} onInstall={onInstall} onManage={onManage} />
      ))}
    </div>
  )
}

function AgentCard({
  row,
  onOpen,
  onInstall,
  onManage,
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
      size="sm"
      className={cn(
        "transition-colors",
        disabled ? "opacity-60" : "cursor-pointer hover:ring-foreground/20",
      )}
    >
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2.5">
          <AgentIcon type={entry.name} size={24} />
          <span className="truncate">{entry.label || entry.name}</span>
        </CardTitle>
        <CardDescription className="truncate font-mono text-xs">
          {row.runtime || t("install.hero.builtin")}
        </CardDescription>
        <CardAction>
          <AgentStatusBadge status={status} />
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-2.5">
        <p className="m-0 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {describeEntry(entry, t) || t("install.card.noDescription")}
        </p>
        <div className="flex flex-wrap gap-1">
          {(entry.tags || []).slice(0, MAX_TAGS).map((tag) => (
            <Badge key={tag} variant="secondary" className="font-mono">
              {tag}
            </Badge>
          ))}
        </div>
      </CardContent>

      <CardFooter
        className="mt-auto justify-between gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="font-mono text-xs text-muted-foreground">
          {row.version ? `v${row.version}` : "—"}
        </span>
        <AgentActionButton
          name={entry.name}
          status={status}
          job={row.job}
          onInstall={() => onInstall(row)}
          onManage={() => onManage(entry.name)}
        />
      </CardFooter>
    </Card>
  )
}
