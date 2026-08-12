import React from "react"
import { useTranslation } from "react-i18next"
import {
  Copy,
  ExternalLink,
  Laptop,
  MoreHorizontal,
  Pencil,
  Star,
  Trash2,
} from "lucide-react"

import { Button } from "../ui/button"
import { Card } from "../ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu"
import { WorkspaceHealth, type WorkspaceHealthState } from "./WorkspaceHealth"
import { Badge } from "../ui/badge"
import { WorkspaceQrcodeDialog } from "./WorkspaceQrcodeDialog"
import { ActivitySparkline } from "./activity-sparkline"
import { QrcodeIcon } from "../icons/qrcode-icon"
import { PLATFORMS } from "../connections/platforms"
import { relativeTimeAgo } from "@renderer/lib/relative-time"
import { cn } from "../../lib/utils"
import type { Agent, Workspace } from "../../types"
import { workspaceDisplayHost } from "../../lib/workspace-urls"
import { ACTIVITY_DAYS, type WorkspaceActivity } from "@renderer/pages/workspaces/use-workspace-activity"
import type { DeviceLink } from "@renderer/pages/workspaces/use-workspaces-data"

export interface WorkspaceCardData {
  ws: Workspace
  agents: Agent[]
  health: WorkspaceHealthState
  lastActiveAt: string | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  sessionCount: number
  connectedPlatforms: string[]
  /** Whether THIS machine is the node behind this workspace. */
  device?: DeviceLink
  activity?: WorkspaceActivity
}

interface Props {
  data: WorkspaceCardData
  favorite: boolean
  onToggleFavorite: () => void
  onCopyUrl: () => void
  onOpen: () => void
  onRename: () => void
  onRemove: () => void
}

/** The trend line takes the workspace's own health colour. */
const TREND_TONE: Record<WorkspaceHealthState, string> = {
  healthy: "text-success",
  warning: "text-warning",
  error: "text-destructive",
  device: "text-muted-foreground",
  deviceMoved: "text-warning",
  disconnected: "text-muted-foreground",
}

/**
 * What an agent-less card says depends on WHY it has none: nothing set up here,
 * this device paired in, or this device having since paired somewhere else.
 */
const EMPTY_TITLE: Partial<Record<WorkspaceHealthState, string>> = {
  device: "workspaces.card.deviceLinkedTitle",
  deviceMoved: "workspaces.card.deviceMovedTitle",
}
const EMPTY_BODY: Partial<Record<WorkspaceHealthState, string>> = {
  device: "workspaces.card.deviceLinked",
  deviceMoved: "workspaces.card.deviceMoved",
}

function Metric({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-2xs text-muted-foreground">{label}</div>
      <div className="flex h-5 items-center text-sm font-medium">{children}</div>
    </div>
  )
}

export function WorkspaceCard({
  data,
  favorite,
  onToggleFavorite,
  onCopyUrl,
  onOpen,
  onRename,
  onRemove,
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
    device,
    activity,
  } = data
  const slug = ws.slug || ws.id
  const [qrcodeOpen, setQrcodeOpen] = React.useState(false)

  // The card has no room for the last message, so it rides along as the
  // "last active" tooltip instead of being dropped.
  const activityTitle = lastMessageAt
    ? t("workspaces.recentActivity.lastMessage", {
        time: relativeTimeAgo(t, lastMessageAt),
      }) + (lastMessagePreview ? ` — ${lastMessagePreview}` : "")
    : sessionCount > 0
      ? t("workspaces.recentActivity.noActivityWithSessions", {
          count: sessionCount,
        })
      : t("workspaces.recentActivity.noActivity")

  const platforms = connectedPlatforms
    .map((id) => PLATFORMS.find((p) => p.id === id))
    .filter((p): p is (typeof PLATFORMS)[number] => !!p)

  return (
    <Card className="gap-0 overflow-hidden p-0 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3">
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
            className="mt-0.5 border-0 bg-transparent p-0 leading-none"
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
              <span className="truncate text-sm font-semibold tracking-tight">
                {ws.name || slug}
              </span>
              <WorkspaceHealth state={health} />
              {/* Health answers "are the agents alright"; this answers "is this
                  machine in here at all" — two facts that were sharing one chip
                  and lost the second one the moment an agent bound here.
                  Skipped when health is already saying it (no agents yet). */}
              {device && health !== "device" && health !== "deviceMoved" && (
                <Badge
                  variant={device === "active" ? "outline" : "warning"}
                  size="sm"
                  className="shrink-0 gap-1"
                  title={t(
                    device === "active"
                      ? "workspaces.card.deviceBadgeHint"
                      : "workspaces.card.deviceMovedBadgeHint",
                  )}
                >
                  <Laptop />
                  {t(
                    device === "active"
                      ? "workspaces.card.deviceBadge"
                      : "workspaces.card.deviceMovedBadge",
                  )}
                </Badge>
              )}
            </div>
            <div className="truncate font-mono text-2xs text-muted-foreground">
              {workspaceDisplayHost(ws.endpoint)}/{slug}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 px-4 pb-3">
        <Metric label={t("workspaces.card.agents")}>{agents.length}</Metric>
        <Metric label={t("workspaces.card.platforms")}>
          {platforms.length > 0 ? (
            <span className="flex items-center gap-1">
              {platforms.map((p) => (
                <span
                  key={p.id}
                  title={p.label}
                  className="flex size-5 items-center justify-center rounded-sm text-3xs font-bold text-white"
                  style={{ background: p.tint }}
                >
                  {p.glyph}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {t("workspaces.card.platformsNone")}
            </span>
          )}
        </Metric>
        <Metric label={t("workspaces.card.lastActive")}>
          <span className="truncate" title={activityTitle}>
            {relativeTimeAgo(t, lastActiveAt) || t("workspaces.relativeTime.never")}
          </span>
        </Metric>
      </div>

      {/* Agents first: a workspace with none can't produce activity, so the
          trend line would just be a flat lie where the real answer is "install
          something here". */}
      {agents.length === 0 ? (
        <div className="mx-4 mb-3 rounded-md border border-dashed px-4 py-5 text-center">
          <div className="text-xs text-muted-foreground">
            {t(EMPTY_TITLE[health] || "workspaces.card.noAgentsTitle")}
          </div>
          <div className="mt-1 text-2xs text-muted-foreground">
            {t(EMPTY_BODY[health] || "workspaces.card.noAgents")}
          </div>
        </div>
      ) : (
        <div className="px-4 pb-2">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-2xs text-muted-foreground">
              {t("workspaces.card.trend", { days: ACTIVITY_DAYS })}
            </span>
            {activity && activity.total > 0 && (
              <span
                className="text-2xs text-muted-foreground tabular-nums"
                title={
                  activity.truncated
                    ? t("workspaces.card.trendTruncated")
                    : undefined
                }
              >
                {t("workspaces.card.trendMessages", { count: activity.total })}
                {activity.truncated ? "+" : ""}
              </span>
            )}
          </div>
          {activity && activity.total > 0 ? (
            <ActivitySparkline
              values={activity.buckets}
              className={TREND_TONE[health]}
            />
          ) : (
            // A sparkline of nothing is a flat line pinned to the floor, which
            // reads as a rendering fault rather than as "no messages yet".
            <div className="flex h-10 items-center justify-center text-2xs text-muted-foreground">
              {t("workspaces.card.trendEmpty")}
            </div>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t px-4 py-2.5">
        <Button size="sm" variant="link" className="px-0" onClick={onOpen}>
          <ExternalLink />
          {t("workspaces.card.openWorkspace")}
        </Button>
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("workspaces.card.qrcode")}
            title={t("workspaces.card.qrcode")}
            onClick={() => setQrcodeOpen(true)}
          >
            <QrcodeIcon />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t("workspaces.card.more")}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onCopyUrl}>
                <Copy />
                {t("workspaces.card.copyUrl")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onRename}>
                <Pencil />
                {t("workspaces.card.rename")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onRemove}>
                <Trash2 />
                {t("workspaces.card.remove")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <WorkspaceQrcodeDialog
        ws={ws}
        open={qrcodeOpen}
        onOpenChange={setQrcodeOpen}
      />
    </Card>
  )
}
