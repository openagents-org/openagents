import React from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import { StatusDot, statusClass } from "../ui-kit"
import AgentIcon from "../AgentIcon"
import type { Agent } from "../../types"

const RUNNING_STATES = ["online", "running", "idle"]

/** Same chip vocabulary the workspace health badge uses, one tone down. */
const TONE_VARIANT = {
  online: "success",
  starting: "warning",
  offline: "muted",
} as const

interface Props {
  agent: Agent
  pending: boolean
  onToggle: () => void
  onOpenLogs: () => void
}

export function WorkspaceAgentRow({
  agent,
  pending,
  onToggle,
  onOpenLogs,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const running = RUNNING_STATES.includes(agent.state)
  const tone = statusClass(agent.state)

  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5 transition-colors not-last:border-b hover:bg-muted">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-background">
        <AgentIcon type={agent.type} size={14} />
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium">
        {agent.name}
      </span>
      <Badge variant={TONE_VARIANT[tone]} className="gap-1.5 px-2 py-0 text-2xs">
        <StatusDot state={agent.state} className="size-1.5 ring-0" />
        {t(`workspaces.card.state.${tone}`)}
      </Badge>
      <Button
        size="sm"
        variant="ghost"
        className="h-auto px-2 py-1 text-2xs"
        onClick={onOpenLogs}
        title={t("workspaces.card.viewLogs")}
      >
        {t("workspaces.card.logs")}
      </Button>
      {/* Stopping is the one action here that interrupts something already
          running, so it carries the destructive tone; starting stays neutral. */}
      <Button
        size="sm"
        variant="ghost"
        className={
          running
            ? "h-auto px-2 py-1 text-2xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            : "h-auto px-2 py-1 text-2xs"
        }
        onClick={onToggle}
        disabled={pending}
      >
        {pending
          ? t("workspaces.card.pending")
          : running
            ? t("workspaces.card.stop")
            : t("workspaces.card.start")}
      </Button>
    </div>
  )
}
