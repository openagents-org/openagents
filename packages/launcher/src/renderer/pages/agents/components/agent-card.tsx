import React from "react"
import { useTranslation } from "react-i18next"
import {
  AlertTriangle,
  Boxes,
  ExternalLink,
  FolderClosed,
  KeyRound,
  MoreHorizontal,
  Play,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
  Unplug,
} from "lucide-react"

import { Badge } from "@renderer/components/ui/badge"
import { usePairedWorkspaces } from "@renderer/hooks/use-paired-workspaces"
import { Button } from "@renderer/components/ui/button"
import { Card } from "@renderer/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu"
import AgentIcon from "@renderer/components/AgentIcon"
import { relativeTimeAgo } from "@renderer/lib/relative-time"
import { formatHealthLabel } from "../format-health-label"
import type { AgentRow, AgentStatus } from "../use-agents-view"
import { AgentErrorDialog } from "./agent-error-dialog"
import type { AgentActionHandlers } from "./agent-actions"

const RUNNING_STATES = ["online", "running", "idle"]

/** Same status vocabulary — and the same precedence — as the table view. */
const STATUS_VARIANT: Record<AgentStatus, "success" | "danger" | "muted"> = {
  running: "success",
  error: "danger",
  stopped: "muted",
  disconnected: "muted",
}

interface Props extends AgentActionHandlers {
  row: AgentRow
  pending: boolean
}

function Field({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
      <span className="shrink-0 [&>svg]:size-3">{icon}</span>
      <span className="truncate">{children}</span>
    </div>
  )
}

/**
 * The grid tile. Same facts as a table row, stacked: identity on top, how it
 * authenticates and where it lives in the middle, health and age at the
 * bottom, actions last.
 */
export function AgentCard({
  row,
  pending,
  onToggle,
  onOpenTerminal,
  onConfigure,
  onConnect,
  onDisconnect,
  onOpenWorkspace,
  onRemove,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const pairedWorkspaces = usePairedWorkspaces()
  const { agent, providerLabel, model, auth, workspace, status, lastActiveAt } = row
  const running = RUNNING_STATES.includes(agent.state)

  return (
    <Card
      data-testid={`agent-row-${agent.name}`}
      data-state={agent.state}
      data-network={agent.network || ""}
      className="gap-0 overflow-hidden p-0 transition-shadow hover:shadow-md"
    >
      <div className="flex items-start gap-2.5 px-3.5 pt-3.5 pb-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <AgentIcon type={agent.type} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="truncate text-sm font-semibold" title={agent.name}>
              {agent.name}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Badge variant={STATUS_VARIANT[status]} size="sm">
                {t(`agents.list.statuses.${status}`)}
              </Badge>
              {/* Same affordance as the table: the tile has no room for the
                  message either, and both views must know the same facts. */}
              {agent.lastError && (
                <AgentErrorDialog
                  agentName={agent.name}
                  message={agent.lastError}
                />
              )}
            </span>
          </div>
          <div className="mt-1 truncate text-2xs text-muted-foreground">
            {providerLabel}
            {model ? ` · ${model}` : ""}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 px-3.5 pb-3">
        <Field icon={auth === "cli_login" ? <Terminal /> : <KeyRound />}>
          {auth
            ? t(
                auth === "api_key"
                  ? "agents.list.health.apiKey"
                  : "agents.list.health.cliLogin",
              )
            : "—"}
        </Field>
        {/* Labelled, unlike the auth line above it: "ccc" on its own says
            nothing to someone who has never met a workspace, and the same word
            "connected" used to appear here, on the badge and on the button for
            three different facts. */}
        <Field icon={<FolderClosed />}>
          {workspace
            ? t("agents.list.workspaceLine", { name: workspace })
            : t("agents.list.notConnected")}
          {agent.network && !pairedWorkspaces.has(agent.network) && (
            <Badge
              variant="outline"
              size="sm"
              className="ml-1.5 shrink-0"
              title={t("agents.list.legacyHint")}
            >
              {t("agents.list.legacyBadge")}
            </Badge>
          )}
        </Field>
      </div>

      {/* Health and age instead of the mock's success rate: nothing in the
          launcher counts an agent's successes or failures, so the slot carries
          what the health check actually reports. */}
      <div className="grid grid-cols-2 gap-2 border-t px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="text-2xs text-muted-foreground">
            {t("agents.list.readiness")}
          </div>
          <div
            className={
              agent.runtimeMismatch || !agent.health?.ready
                ? "flex items-center gap-1 truncate text-xs font-medium text-warning"
                : "truncate text-xs font-medium text-success"
            }
          >
            {agent.runtimeMismatch ? (
              <>
                <AlertTriangle className="size-3 shrink-0" />
                {t("agents.list.coreUpdateRequired")}
              </>
            ) : agent.health?.ready ? (
              t("agents.list.health.ready")
            ) : (
              <>
                <AlertTriangle className="size-3 shrink-0" />
                {formatHealthLabel(agent.health || null, t)}
              </>
            )}
          </div>
        </div>
        <div className="min-w-0 text-right">
          <div className="text-2xs text-muted-foreground">
            {t("agents.list.columns.lastActive")}
          </div>
          <div className="truncate text-xs font-medium">
            {relativeTimeAgo(t, lastActiveAt) || "—"}
          </div>
        </div>
      </div>

      <div className="mt-auto flex items-center gap-1.5 border-t px-3.5 py-2.5">
        {agent.network ? (
          agent.hasCli && (
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenTerminal(agent)}
            >
              <Terminal />
              {t("agents.list.chat")}
            </Button>
          )
        ) : (
          <Button
            size="sm"
            className="flex-1"
            data-testid={`agent-connect-${agent.name}`}
            onClick={() => onConnect(agent)}
          >
            <Boxes />
            {t("agents.list.connect")}
          </Button>
        )}

        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          data-testid={`agent-configure-${agent.name}`}
          onClick={() => onConfigure(agent)}
        >
          <SlidersHorizontal />
          {t("agents.list.configure")}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("agents.list.more")}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={pending}
              data-testid={`agent-toggle-${agent.name}`}
              onClick={() => onToggle(agent)}
            >
              {running ? <Square /> : <Play />}
              {running ? t("agents.list.stop") : t("agents.list.start")}
            </DropdownMenuItem>
            {agent.network ? (
              <>
                <DropdownMenuItem onClick={() => onOpenWorkspace(agent)}>
                  <ExternalLink />
                  {t("agents.list.openWorkspace")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDisconnect(agent)}>
                  <Unplug />
                  {t("agents.list.disconnect")}
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onRemove(agent)}>
              <Trash2 />
              {t("agents.list.remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  )
}

/** Trailing tile in the grid — the mock's "add an agent" slot. */
export function AddAgentCard({ onClick }: { onClick: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-transparent p-6 text-center transition-colors hover:border-primary hover:bg-accent"
    >
      <span className="flex size-9 items-center justify-center rounded-full bg-muted text-lg leading-none">
        +
      </span>
      <span className="text-xs font-medium">{t("agents.list.newAgent")}</span>
      <span className="text-2xs text-muted-foreground">
        {t("agents.list.addHint")}
      </span>
    </button>
  )
}
