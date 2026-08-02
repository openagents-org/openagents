import React from "react"
import { useTranslation } from "react-i18next"
import { Copy, ExternalLink, Pencil, Star, Trash2 } from "lucide-react"

import { Badge } from "../shadcn/badge"
import { Button } from "../shadcn/button"
import { Card } from "../shadcn/card"
import { WorkspaceHealth, type WorkspaceHealthState } from "./WorkspaceHealth"
import { WorkspaceAgentRow } from "./WorkspaceAgentRow"
import {
  WorkspaceRecentActivity,
  workspaceRelativeTime,
} from "./WorkspaceRecentActivity"
import { platformLabel } from "../connections/platforms"
import { cn } from "../../lib/utils"
import type { Agent, Workspace } from "../../types"
import { workspaceDisplayHost } from "../../lib/workspace-urls"

export interface WorkspaceCardData {
  ws: Workspace
  agents: Agent[]
  health: WorkspaceHealthState
  lastActiveAt: string | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  sessionCount: number
  connectedPlatforms: string[]
}

interface Props {
  data: WorkspaceCardData
  pendingNames: Set<string>
  favorite: boolean
  onToggleFavorite: () => void
  onCopyUrl: () => void
  onOpen: () => void
  onRename: () => void
  onRemove: () => void
  onToggleAgent: (a: Agent) => void
  onOpenAgentLogs: (a: Agent) => void
}

function Stat({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-0.5 text-3xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
  )
}

export function WorkspaceCard({
  data,
  pendingNames,
  favorite,
  onToggleFavorite,
  onCopyUrl,
  onOpen,
  onRename,
  onRemove,
  onToggleAgent,
  onOpenAgentLogs,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const {
    ws,
    agents,
    health,
    lastActiveAt,
    lastMessageAt,
    lastMessagePreview,
    sessionCount,
    connectedPlatforms,
  } = data
  const slug = ws.slug || ws.id

  return (
    <Card className="gap-3 px-4 py-4 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleFavorite}
              title={
                favorite
                  ? t("workspaces.card.unfavorite")
                  : t("workspaces.card.favorite")
              }
              className="cursor-pointer border-0 bg-transparent p-0 leading-none"
            >
              <Star
                className={cn(
                  "size-3.5",
                  favorite ? "fill-warning text-warning" : "text-muted-foreground",
                )}
              />
            </button>
            <span className="truncate text-base font-semibold tracking-tight">
              {ws.name || slug}
            </span>
            <WorkspaceHealth state={health} />
          </div>
          <div className="truncate text-2xs text-muted-foreground">
            {workspaceDisplayHost(ws.endpoint)}/{slug}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="icon" variant="ghost" onClick={onCopyUrl} title={t("workspaces.card.copyUrl")}>
            <Copy />
          </Button>
          <Button size="icon" variant="ghost" onClick={onOpen} title={t("workspaces.card.openInBrowser")}>
            <ExternalLink />
          </Button>
          <Button size="icon" variant="ghost" onClick={onRename} title={t("workspaces.card.rename")}>
            <Pencil />
          </Button>
          <Button size="icon" variant="ghost" onClick={onRemove} title={t("workspaces.card.remove")}>
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-2xs">
        <Stat label={t("workspaces.card.agents")}>
          <span className="font-semibold">{agents.length}</span>
        </Stat>
        <Stat label={t("workspaces.card.lastActive")}>
          {workspaceRelativeTime(lastActiveAt, t)}
        </Stat>
        <Stat label={t("workspaces.card.platforms")}>
          {connectedPlatforms.length > 0
            ? t("workspaces.card.platformsLinked", { count: connectedPlatforms.length })
            : t("workspaces.card.platformsNone")}
        </Stat>
      </div>

      <WorkspaceRecentActivity
        lastMessageAt={lastMessageAt}
        lastMessagePreview={lastMessagePreview}
        sessionCount={sessionCount}
      />

      {connectedPlatforms.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {connectedPlatforms.map((p) => (
            <Badge key={p} variant="secondary" className="px-1.5 py-0 text-3xs">
              {platformLabel(p)}
            </Badge>
          ))}
        </div>
      )}

      {agents.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t pt-3">
          {agents.map((a) => (
            <WorkspaceAgentRow
              key={a.name}
              agent={a}
              pending={pendingNames.has(a.name)}
              onToggle={() => onToggleAgent(a)}
              onOpenLogs={() => onOpenAgentLogs(a)}
            />
          ))}
        </div>
      ) : (
        <p className="border-t py-3 text-center text-2xs text-muted-foreground">
          {t("workspaces.card.noAgents")}
        </p>
      )}
    </Card>
  )
}
