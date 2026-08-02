import React from "react"
import { useTranslation } from "react-i18next"

import { Button } from "../shadcn/button"
import { StatusDot, displayState } from "../ui-kit"
import AgentIcon from "../AgentIcon"
import type { Agent } from "../../types"

const RUNNING_STATES = ["online", "running", "idle"]

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

  return (
    <div className="flex items-center gap-2 rounded-sm px-2 py-1.5 transition-colors hover:bg-accent">
      <AgentIcon type={agent.type} size={18} />
      <span className="min-w-0 flex-1 truncate text-xs font-medium">
        {agent.name}
      </span>
      <StatusDot state={agent.state} />
      <span className="text-3xs capitalize text-muted-foreground">
        {displayState(agent.state)}
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-auto px-2 py-0.5 text-3xs"
        onClick={onOpenLogs}
        title={t("workspaces.card.viewLogs")}
      >
        {t("workspaces.card.logs")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-auto px-2 py-0.5 text-3xs"
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
