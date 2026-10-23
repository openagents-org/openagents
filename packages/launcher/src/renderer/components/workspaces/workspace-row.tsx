import React from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowUpRight,
  Copy,
  ExternalLink,
  Info,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react"

import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu"
import { TableCell, TableRow } from "../ui/table"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip"
import type { WorkspaceHealthState } from "./WorkspaceHealth"
import { WorkspaceQrcodeDialog } from "./WorkspaceQrcodeDialog"
import { QrcodeIcon } from "../icons/qrcode-icon"
import { relativeTimeAgo } from "@renderer/lib/relative-time"
import { cn } from "../../lib/utils"
import type { Agent, Workspace } from "../../types"
import { workspaceDisplayHost } from "../../lib/workspace-urls"

export interface WorkspaceRowData {
  ws: Workspace
  agents: Agent[]
  health: WorkspaceHealthState
  lastActiveAt: string | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  sessionCount: number
  connectedPlatforms: string[]
  /** Whether THIS machine is the node behind this workspace. */
  device?: boolean
}

export type BrowserOnlyReason = "signedOut" | "otherDeployment" | "notMember"

interface Props {
  data: WorkspaceRowData
  onCopyUrl: () => void
  /**
   * Whether the app's own Workspace can open it: signed in, same deployment,
   * and the account already a member. Decides which way the row's button opens.
   */
  opensInApp: boolean
  /** Why it opens only in the browser; the button's tooltip says so. */
  browserOnlyReason?: BrowserOnlyReason | null
  onOpen: () => void
  onOpenInBrowser: () => void
  onRename: () => void
  onRemove: () => void
  /** Re-open the pairing dialog after the workspace revoked this device. */
  onRepair?: () => void
}

/** Colour plus the word, never colour alone. */
const DOT: Record<WorkspaceHealthState, string> = {
  healthy: "bg-(--success)",
  warning: "bg-(--warning)",
  device: "bg-(--success)",
  revoked: "bg-(--danger)",
  disconnected: "bg-muted-foreground/50",
  error: "bg-(--danger)",
}
const TEXT: Record<WorkspaceHealthState, string> = {
  healthy: "text-(--success-text)",
  warning: "text-(--warning-text)",
  device: "text-(--success-text)",
  revoked: "text-(--danger-text)",
  disconnected: "text-muted-foreground",
  error: "text-(--danger-text)",
}

/** One joined workspace as a row of the Joined Workspaces table. */
export function WorkspaceRow({
  data,
  onCopyUrl,
  opensInApp,
  browserOnlyReason,
  onOpen,
  onOpenInBrowser,
  onRename,
  onRemove,
  onRepair,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { ws, agents, health, lastActiveAt, lastMessageAt, lastMessagePreview, device } = data
  const slug = ws.slug || ws.id
  const [qrcodeOpen, setQrcodeOpen] = React.useState(false)
  // A device with no agent yet still reads as fine, with the "this device"
  // tag carrying what the old dedicated state said.
  const status: WorkspaceHealthState = health === "device" ? "healthy" : health

  const activityTitle = lastMessageAt
    ? t("workspaces.recentActivity.lastMessage", { time: relativeTimeAgo(t, lastMessageAt) }) +
      (lastMessagePreview ? ` — ${lastMessagePreview}` : "")
    : undefined

  return (
    <TableRow className="h-16" data-testid={`workspace-row-${slug}`}>
      <TableCell className="px-4">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{ws.name || slug}</div>
            <div className="truncate font-mono text-2xs text-muted-foreground">
              {workspaceDisplayHost(ws.endpoint)}/{slug}
            </div>
          </div>
        </div>
      </TableCell>

      <TableCell className="px-4 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 shrink-0 rounded-full", DOT[status])} />
          <span className={cn("text-sm", TEXT[status])}>{t(`workspaces.health.${status}`)}</span>
          {device && health !== "revoked" && (
            <Badge variant="muted" size="sm" title={t("workspaces.card.deviceBadgeHint")}>
              {t("workspaces.health.device")}
            </Badge>
          )}
        </div>
      </TableCell>

      <TableCell className="px-4 text-sm whitespace-nowrap tabular-nums">
        {t("workspaces.table.agentCount", { count: agents.length })}
      </TableCell>

      <TableCell className="px-4 font-mono text-xs whitespace-nowrap text-muted-foreground" title={activityTitle}>
        {relativeTimeAgo(t, lastActiveAt) ||
          t(health === "revoked" ? "workspaces.relativeTime.unknown" : "workspaces.relativeTime.never")}
      </TableCell>

      <TableCell className="px-4 whitespace-nowrap">
        <div className="flex items-center justify-end gap-1.5">
          {health === "revoked" && onRepair ? (
            <Button size="sm" onClick={onRepair}>
              <RotateCcw />
              {t("workspaces.card.repair")}
            </Button>
          ) : opensInApp ? (
            <Button size="sm" variant="outline" onClick={onOpen}>
              <ArrowUpRight />
              {t("workspaces.card.openInApp")}
            </Button>
          ) : (
            <>
              {/* Why only the browser, beside the row it applies to. */}
              {browserOnlyReason && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        aria-label={t(`workspaces.card.browserOnly.${browserOnlyReason}`)}
                        data-testid="browser-only-reason"
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Info className="size-4" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={4} className="whitespace-nowrap">
                      {t(`workspaces.card.browserOnly.${browserOnlyReason}`)}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <Button size="sm" variant="outline" onClick={onOpenInBrowser}>
                <ExternalLink />
                {t("workspaces.card.openInBrowser")}
              </Button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={t("workspaces.card.more")}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {opensInApp && (
                <DropdownMenuItem onClick={onOpenInBrowser}>
                  <ExternalLink />
                  {t("workspaces.card.openInBrowser")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setQrcodeOpen(true)}>
                <QrcodeIcon />
                {t("workspaces.card.qrcode")}
              </DropdownMenuItem>
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
        <WorkspaceQrcodeDialog ws={ws} open={qrcodeOpen} onOpenChange={setQrcodeOpen} />
      </TableCell>
    </TableRow>
  )
}
