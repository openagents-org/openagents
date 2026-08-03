import React from "react"
import { MoreHorizontal, Play, Settings2, Square, Terminal } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "../ui/button"
import { Card } from "../ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu"
import { StatusDot } from "../ui-kit"
import AgentIcon from "../AgentIcon"
import { cn } from "../../lib/utils"
import type { Agent } from "../../types"
import {
  RUNNING_STATES,
  STATE_TEXT_CLASS,
  stateKeyOf,
  workspaceLabel,
} from "./agent-state"
import { lastActiveOf } from "./relative-time"
import { relativeTimeAgo } from "@renderer/lib/relative-time"

export interface AgentCardProps {
  agent: Agent
  isPending: boolean
  todayMessages?: number
  onToggle: () => void
  onOpenChat: () => void
  /** Jumps to the Agents page, where configuration lives. */
  onManage: () => void
}

export function AgentCard({
  agent,
  isPending,
  todayMessages,
  onToggle,
  onOpenChat,
  onManage,
}: AgentCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const isRunning = RUNNING_STATES.includes(agent.state)
  const stateKey = stateKeyOf(agent)
  const ws = workspaceLabel(agent)
  const lastActive = relativeTimeAgo(t, lastActiveOf(agent))
  const meta = [
    agent.type,
    ws || t("dashboard.agentCard.noWorkspace"),
    lastActive,
    todayMessages ? t("dashboard.agentCard.messages", { count: todayMessages }) : "",
  ].filter(Boolean)

  return (
    <Card className="h-full gap-0 px-4 py-3.5 transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <AgentIcon type={agent.type} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-base font-semibold">{agent.name}</span>
            <span
              className={cn(
                "flex shrink-0 items-center gap-1.5 text-2xs font-medium",
                STATE_TEXT_CLASS[stateKey],
              )}
            >
              <StatusDot state={agent.state} className="size-1.5 ring-0" />
              {t(`dashboard.agentCard.state.${stateKey}`)}
            </span>
          </div>
          {/* One dot-separated line: with no workspace, no history and no
              messages the card would otherwise be mostly empty rows. */}
          <div className="truncate text-2xs text-muted-foreground">
            {meta.join(" · ")}
          </div>
        </div>
      </div>

      {agent.lastError && (
        <div className="mt-2 truncate rounded-sm bg-(--danger-bg) px-2 py-1.5 text-2xs text-(--danger-text)">
          {agent.lastError}
        </div>
      )}

      {/* The card shows one action; the menu holds only what the card does not
          already offer, so nothing is presented twice. */}
      <div className="mt-auto flex items-center gap-2 pt-3">
        {agent.hasCli ? (
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={onOpenChat}
          >
            <Terminal />
            {t("dashboard.agentCard.openChat")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant={isRunning ? "destructive-ghost" : "outline"}
            className="flex-1"
            onClick={onToggle}
            disabled={isPending}
          >
            {isRunning ? <Square /> : <Play />}
            {isRunning
              ? isPending
                ? t("dashboard.agentCard.stopping")
                : t("dashboard.agentCard.stop")
              : isPending
                ? t("dashboard.agentCard.starting")
                : t("dashboard.agentCard.start")}
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
            {agent.hasCli && (
              <DropdownMenuItem onClick={onToggle} disabled={isPending}>
                {isRunning ? <Square /> : <Play />}
                {isRunning
                  ? isPending
                    ? t("dashboard.agentCard.stopping")
                    : t("dashboard.agentCard.stop")
                  : isPending
                    ? t("dashboard.agentCard.starting")
                    : t("dashboard.agentCard.start")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onManage}>
              <Settings2 />
              {t("dashboard.agentCard.manage")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  )
}
