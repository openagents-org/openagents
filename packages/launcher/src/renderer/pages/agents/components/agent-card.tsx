import React from "react"
import { useTranslation } from "react-i18next"
import {
  AlertTriangle,
  Boxes,
  ExternalLink,
  KeyRound,
  Play,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
  Unplug,
} from "lucide-react"

import { Badge } from "@renderer/components/ui/badge"
import { Button } from "@renderer/components/ui/button"
import { StatusDot, statusClass } from "@renderer/components/ui-kit"
import AgentIcon from "@renderer/components/AgentIcon"
import type { Agent } from "@renderer/types"
import { formatHealthLabel } from "../format-health-label"

const RUNNING_STATES = ["online", "running", "idle"]

/** Same chip vocabulary the workspace cards use. */
const TONE_VARIANT = {
  online: "success",
  starting: "warning",
  offline: "muted",
} as const

interface Props {
  agent: Agent
  pending: boolean
  onToggle: () => void
  onOpenTerminal: () => void
  onConfigure: () => void
  onConnect: () => void
  onDisconnect: () => void
  onOpenWorkspace: () => void
  onRemove: () => void
}

/** `type` chip · auth method · execution mode — or the problem, if any. */
function MetaRow({ agent }: { agent: Agent }): React.JSX.Element {
  const { t } = useTranslation()
  const health = agent.health || null
  const execMode =
    health?.execution_mode && health.execution_mode !== "unavailable"
      ? health.execution_mode
      : null
  const authLabel =
    health?.auth_mode === "api_key"
      ? t("agents.list.health.apiKey")
      : health?.auth_mode === "cli_login"
        ? t("agents.list.health.cliLogin")
        : null

  const env: string[] = []
  if (agent.env?.LLM_BASE_URL || agent.env?.OPENAI_BASE_URL)
    env.push(
      t("agents.list.apiPrefix", {
        value: agent.env.LLM_BASE_URL || agent.env.OPENAI_BASE_URL,
      }),
    )
  if (agent.env?.LLM_MODEL || agent.env?.OPENCLAW_MODEL)
    env.push(
      t("agents.list.modelPrefix", {
        value: agent.env.LLM_MODEL || agent.env.OPENCLAW_MODEL,
      }),
    )

  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
      <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono">
        {agent.type}
      </code>

      {agent.runtimeMismatch ? (
        <span className="flex items-center gap-1 text-destructive">
          <AlertTriangle className="size-3" />
          {t("agents.list.coreUpdateRequired")}
        </span>
      ) : health?.ready ? (
        <>
          {authLabel && (
            <span className="flex items-center gap-1">
              <KeyRound className="size-3" />
              {authLabel}
            </span>
          )}
          {execMode && <span className="font-mono">{execMode}</span>}
        </>
      ) : (
        <span className="flex items-center gap-1 text-warning">
          <AlertTriangle className="size-3" />
          {formatHealthLabel(health, t)}
        </span>
      )}

      {env.map((e) => (
        <span key={e} className="truncate">
          {e}
        </span>
      ))}
    </div>
  )
}

export function AgentCard({
  agent,
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
  const running = RUNNING_STATES.includes(agent.state)
  const tone = statusClass(agent.state)
  const wsDisplay = agent.network
    ? agent.networkName && agent.networkName !== agent.network
      ? `${agent.network} (${agent.networkName})`
      : agent.network
    : ""

  return (
    <div
      data-testid={`agent-row-${agent.name}`}
      data-state={agent.state}
      data-network={agent.network || ""}
      className="rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-4 px-4 py-3.5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <AgentIcon type={agent.type} size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{agent.name}</div>
            <MetaRow agent={agent} />
            {agent.lastError && (
              <div className="mt-1 text-2xs text-destructive">
                {agent.lastError}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge
            variant={TONE_VARIANT[tone]}
            className="gap-1.5 px-2 py-0 text-2xs"
          >
            <StatusDot state={agent.state} className="size-1.5 ring-0" />
            {t(`agents.list.state.${tone}`)}
          </Badge>
          {wsDisplay ? (
            <span className="flex items-center gap-1 text-2xs text-muted-foreground">
              <Boxes className="size-3" />
              {wsDisplay}
            </span>
          ) : (
            <span className="text-2xs text-muted-foreground">
              {t("agents.list.notConnected")}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Stopping interrupts a live process, so it carries the destructive
              tone. Ghost rather than outline: the red already carries the
              weight, and an outline put that red inside a neutral grey box. */}
          <Button
            size="sm"
            variant={running ? "ghost" : "outline"}
            data-testid={`agent-toggle-${agent.name}`}
            onClick={onToggle}
            disabled={pending}
            className={
              running
                ? "text-destructive hover:bg-destructive/10 hover:text-destructive"
                : undefined
            }
          >
            {running ? <Square /> : <Play />}
            {pending
              ? running
                ? t("agents.list.stopping")
                : t("agents.list.starting")
              : running
                ? t("agents.list.stop")
                : t("agents.list.start")}
          </Button>

          {agent.hasCli && (
            <Button size="sm" variant="outline" onClick={onOpenTerminal}>
              <Terminal />
              {t("agents.list.chat")}
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            data-testid={`agent-configure-${agent.name}`}
            onClick={onConfigure}
          >
            <SlidersHorizontal />
            {t("agents.list.configure")}
          </Button>

          {agent.network ? (
            <>
              {/* Undoable, so it stays neutral at rest and only turns red on
                  hover — unlike Stop, which acts on something live. */}
              <Button
                size="sm"
                variant="ghost"
                onClick={onDisconnect}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Unplug />
                {t("agents.list.disconnect")}
              </Button>
              <Button size="sm" variant="link" onClick={onOpenWorkspace}>
                <ExternalLink />
                {t("agents.list.openWorkspace")}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              data-testid={`agent-connect-${agent.name}`}
              onClick={onConnect}
            >
              <Boxes />
              {t("agents.list.connect")}
            </Button>
          )}
        </div>

        {/* Irreversible — but it opens a confirm dialog, so it warns on hover
            rather than shouting from the resting state. */}
        <Button
          size="sm"
          variant="ghost"
          onClick={onRemove}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 />
          {t("agents.list.remove")}
        </Button>
      </div>
    </div>
  )
}
