import React from "react"
import { useTranslation } from "react-i18next"
import { Copy, ExternalLink, Pencil, Star, Trash2 } from "lucide-react"

import { Button } from "../ui/button"
import { Card } from "../ui/card"
import { WorkspaceHealth, type WorkspaceHealthState } from "./WorkspaceHealth"
import { WorkspaceAgentRow } from "./WorkspaceAgentRow"
import { workspaceRelativeTime } from "./relative-time"
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
  value,
  title,
}: {
  label: string
  value: React.ReactNode
  title?: string
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-2xs text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium" title={title}>
        {value}
      </div>
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

  // The card no longer gives the last message its own block, so it rides along
  // as the "last active" tooltip instead of being dropped.
  const activityTitle = lastMessageAt
    ? t("workspaces.recentActivity.lastMessage", {
        time: workspaceRelativeTime(lastMessageAt, t),
      }) +
      (lastMessagePreview ? ` — ${lastMessagePreview}` : "")
    : sessionCount > 0
      ? t("workspaces.recentActivity.noActivityWithSessions", {
          count: sessionCount,
        })
      : t("workspaces.recentActivity.noActivity")

  return (
    // `p-0` + per-band padding: the dividers have to run the full width of the
    // card, which they cannot do inside a padded container.
    <Card className="gap-0 overflow-hidden p-0 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3 px-4 py-3.5">
        {/* The star sits outside the text column so the URL lines up under the
            workspace name rather than under the star itself. */}
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <button
            type="button"
            onClick={onToggleFavorite}
            title={
              favorite
                ? t("workspaces.card.unfavorite")
                : t("workspaces.card.favorite")
            }
            className="mt-1 cursor-pointer border-0 bg-transparent p-0 leading-none"
          >
            <Star
              className={cn(
                "size-3.5",
                favorite ? "fill-warning text-warning" : "text-muted-foreground",
              )}
            />
          </button>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span className="truncate text-base font-semibold tracking-tight">
                {ws.name || slug}
              </span>
              <WorkspaceHealth state={health} />
            </div>
            <div className="truncate font-mono text-2xs text-muted-foreground">
              {workspaceDisplayHost(ws.endpoint)}/{slug}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onCopyUrl}
            title={t("workspaces.card.copyUrl")}
          >
            <Copy />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onOpen}
            title={t("workspaces.card.openInBrowser")}
          >
            <ExternalLink />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onRename}
            title={t("workspaces.card.rename")}
          >
            <Pencil />
          </Button>
          {/* The only irreversible action in the row — tinted so it never gets
              hit on the way to rename. */}
          <Button
            size="icon-sm"
            variant="destructive-ghost"
            onClick={onRemove}
            title={t("workspaces.card.remove")}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 border-t px-4 py-3">
        <Stat label={t("workspaces.card.agents")} value={agents.length} />
        <Stat
          label={t("workspaces.card.lastActive")}
          value={workspaceRelativeTime(lastActiveAt, t)}
          title={activityTitle}
        />
        <Stat
          label={t("workspaces.card.platforms")}
          value={
            connectedPlatforms.length > 0
              ? t("workspaces.card.platformsLinked", {
                  count: connectedPlatforms.length,
                })
              : t("workspaces.card.platformsNone")
          }
        />
      </div>

      {/* Both trailing bands sit on the same wash, so a card with agents and a
          card without still end on the same colour. */}
      {agents.length > 0 ? (
        <div className="flex flex-col border-t bg-muted/40">
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
        // Dashed and washed out: an empty slot to fill, not a populated band.
        <p className="m-0 border-t border-dashed bg-muted/40 px-4 py-4 text-center text-2xs text-muted-foreground">
          {t("workspaces.card.noAgents")}
        </p>
      )}
    </Card>
  )
}
