import React from "react"
import {
  MoreHorizontal,
  Play,
  Settings2,
  Square,
  Terminal,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "../ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu"
import { StatusDot } from "../ui-kit"
import AgentIcon from "../AgentIcon"
import { cn } from "../../lib/utils"
import type { AgentCardProps } from "./AgentCard"
import {
  RUNNING_STATES,
  STATE_TEXT_CLASS,
  stateKeyOf,
  workspaceLabel,
} from "./agent-state"
import { lastActiveOf } from "./relative-time"
import { relativeTimeAgo } from "@renderer/lib/relative-time"

/** One-line variant of `AgentCard` for the panel's list view. */
export function AgentRow({
  agent,
  isPending,
  onToggle,
  onOpenChat,
  onManage,
}: AgentCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const isRunning = RUNNING_STATES.includes(agent.state)
  const stateKey = stateKeyOf(agent)
  const ws = workspaceLabel(agent)
  const lastActive = relativeTimeAgo(t, lastActiveOf(agent))

  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
      <AgentIcon type={agent.type} size={20} />

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{agent.name}</div>
        <div className="truncate text-2xs text-muted-foreground">
          {`${agent.type} · ${ws || t("dashboard.agentCard.noWorkspace")}`}
        </div>
      </div>

      {lastActive && (
        <span className="hidden shrink-0 text-2xs text-muted-foreground sm:block">
          {lastActive}
        </span>
      )}

      <span
        className={cn(
          "flex w-20 shrink-0 items-center gap-1.5 text-2xs font-medium",
          STATE_TEXT_CLASS[stateKey],
        )}
      >
        <StatusDot state={agent.state} className="size-1.5 ring-0" />
        {t(`dashboard.agentCard.state.${stateKey}`)}
      </span>

      {agent.hasCli && (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("dashboard.agentCard.openChat")}
          onClick={onOpenChat}
        >
          <Terminal />
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("dashboard.agentCard.more")}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onToggle} disabled={isPending}>
            {isRunning ? <Square /> : <Play />}
            {isRunning
              ? t("dashboard.agentCard.stop")
              : t("dashboard.agentCard.start")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onManage}>
            <Settings2 />
            {t("dashboard.agentCard.manage")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
