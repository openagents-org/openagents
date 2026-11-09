import React from "react"
import { useTranslation } from "react-i18next"
import {
  Copy,
  ExternalLink,
  LogIn,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react"

import AgentIcon from "../AgentIcon"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "../ui/item"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip"
import type { WorkspaceHealthState } from "./WorkspaceHealth"
import { WorkspaceQrcodeDialog } from "./WorkspaceQrcodeDialog"
import { QrcodeIcon } from "../icons/qrcode-icon"
import { relativeTimeAgo } from "@renderer/lib/relative-time"
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
  /** Whether THIS machine is the node behind this workspace. */
  device?: boolean
}

export type BrowserOnlyReason = "signedOut" | "otherDeployment" | "notMember"

interface Props {
  data: WorkspaceCardData
  onCopyUrl: () => void
  /** Why it opens only in the browser; the button's tooltip says so. */
  browserOnlyReason?: BrowserOnlyReason | null
  /** Enter it: in the app where it can, else the browser (useWorkspaceOpening). */
  onOpen: () => void
  /** Offered in the menu while it would otherwise open in the app. */
  opensInApp: boolean
  onOpenInBrowser: () => void
  onRename: () => void
  onRemove: () => void
  /** Re-open the pairing dialog after the workspace revoked this device. */
  onRepair?: () => void
}

/** Colour on the dot; only a problem colours the word too. */
const DOT: Record<WorkspaceHealthState, string> = {
  healthy: "bg-(--success)",
  warning: "bg-(--warning)",
  device: "bg-(--success)",
  revoked: "bg-(--danger)",
  disconnected: "bg-muted-foreground/50",
  error: "bg-(--danger)",
}
const TEXT: Record<WorkspaceHealthState, string> = {
  healthy: "text-muted-foreground",
  warning: "text-muted-foreground",
  device: "text-muted-foreground",
  revoked: "text-(--danger-text)",
  disconnected: "text-muted-foreground",
  error: "text-(--danger-text)",
}

/** Agent marks shown before the rest fold into "+N". */
const AGENTS_SHOWN = 4

/**
 * One joined workspace as a card: who it is (a monogram, its name and state),
 * where it lives and how lively it is on one quiet line under that, its agents
 * as a stack of marks, then the one way in and a menu for the rest.
 *
 * A card rather than a table row: a device joins a handful of workspaces, and
 * a table of one or two rows was mostly column headers and empty columns.
 */
export function WorkspaceCard({
  data,
  onCopyUrl,
  browserOnlyReason,
  onOpen,
  opensInApp,
  onOpenInBrowser,
  onRename,
  onRemove,
  onRepair,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { ws, agents, health, lastActiveAt, lastMessageAt, lastMessagePreview, device } = data
  const slug = ws.slug || ws.id
  const name = ws.name || slug
  const [qrcodeOpen, setQrcodeOpen] = React.useState(false)
  // A device with no agent yet still reads as fine, with the "this device"
  // tag carrying what the old dedicated state said.
  const status: WorkspaceHealthState = health === "device" ? "healthy" : health
  const revoked = health === "revoked" && !!onRepair

  const active = relativeTimeAgo(t, lastActiveAt)
  const activityTitle = lastMessageAt
    ? t("workspaces.recentActivity.lastMessage", { time: relativeTimeAgo(t, lastMessageAt) }) +
      (lastMessagePreview ? ` — ${lastMessagePreview}` : "")
    : undefined
  const meta = [
    `${workspaceDisplayHost(ws.endpoint)}/${slug}`,
    t("workspaces.card.agentCount", { count: agents.length }),
    active ? t("workspaces.card.activeAt", { time: active }) : revoked ? null : t("workspaces.card.noActivity"),
  ].filter((m): m is string => !!m)

  // The same button whether it opens in the app or the browser — that is only
  // known once the account's workspaces load, and an icon or label picked from
  // it changed under the user a moment after the page opened. The tooltip says
  // when it is the browser.
  const enterButton = (
    <Button size="sm" variant="outline" onClick={onOpen} data-testid="workspace-enter">
      <LogIn />
      {t("workspaces.card.enter")}
    </Button>
  )

  return (
    <Item
      variant="outline"
      data-testid={`workspace-row-${slug}`}
      // The whole card enters too; the button stays so it is plain that it can.
      onClick={revoked ? undefined : onOpen}
      className={cn("bg-card", !revoked && "cursor-pointer hover:bg-accent/40")}
    >
      <ItemMedia className="size-10 rounded-lg border bg-muted text-sm font-semibold uppercase">
        {Array.from(name)[0]}
      </ItemMedia>

      <ItemContent className="min-w-0 gap-1.5">
        <ItemTitle className="w-full min-w-0">
          <span className="truncate">{name}</span>
          <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs font-normal", TEXT[status])}>
            <span className={cn("size-1.5 rounded-full", DOT[status])} />
            {t(`workspaces.health.${status}`)}
          </span>
          {device && health !== "revoked" && (
            <Badge variant="outline" size="sm" className="font-normal text-muted-foreground" title={t("workspaces.card.deviceBadgeHint")}>
              {t("workspaces.health.device")}
            </Badge>
          )}
        </ItemTitle>
        <ItemDescription className="truncate text-xs" title={activityTitle}>
          {meta.join(" · ")}
        </ItemDescription>
      </ItemContent>

      {agents.length > 0 && (
        <div className="hidden shrink-0 items-center -space-x-1.5 md:flex" title={agents.map((a) => a.displayName || a.name).join(", ")}>
          {agents.slice(0, AGENTS_SHOWN).map((a) => (
            <AgentIcon key={a.name} type={a.type} size={24} chip className="outline-2 outline-card" />
          ))}
          {agents.length > AGENTS_SHOWN && (
            <span className="flex size-6 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground outline-2 outline-card">
              +{agents.length - AGENTS_SHOWN}
            </span>
          )}
        </div>
      )}

      {/* Clicks here — the menu, the QR dialog rendered inside it — are not
          clicks on the card. */}
      <ItemActions onClick={(e) => e.stopPropagation()}>
        {revoked ? (
          <Button size="sm" onClick={onRepair}>
            <RotateCcw />
            {t("workspaces.card.repair")}
          </Button>
        ) : browserOnlyReason ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>{enterButton}</TooltipTrigger>
              <TooltipContent side="top" sideOffset={4} className="whitespace-nowrap" data-testid="browser-only-reason">
                {t(`workspaces.card.browserOnly.${browserOnlyReason}`)}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          enterButton
        )}
        {/* Other ways to open and share it, then managing it, then removing it. */}
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
            <DropdownMenuItem onClick={onCopyUrl}>
              <Copy />
              {t("workspaces.card.copyUrl")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setQrcodeOpen(true)}>
              <QrcodeIcon />
              {t("workspaces.card.qrcode")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
        <WorkspaceQrcodeDialog ws={ws} open={qrcodeOpen} onOpenChange={setQrcodeOpen} />
      </ItemActions>
    </Item>
  )
}
