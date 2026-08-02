import React from "react"
import { MessageSquare } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "../shadcn/badge"
import { Button } from "../shadcn/button"
import { Card } from "../shadcn/card"
import AgentIcon from "../AgentIcon"
import { cn } from "../../lib/utils"
import type { Agent } from "../../types"

type StateKey = "running" | "idle" | "starting" | "error" | "offline"
type Tone = "success" | "warning" | "danger" | "secondary"

const RUNNING_STATES = ["online", "running", "idle"]

function stateMeta(state: string): { labelKey: StateKey; tone: Tone } {
  if (["online", "running"].includes(state)) return { labelKey: "running", tone: "success" }
  if (state === "idle") return { labelKey: "idle", tone: "warning" }
  if (state === "starting" || state === "reconnecting")
    return { labelKey: "starting", tone: "warning" }
  if (state === "error") return { labelKey: "error", tone: "danger" }
  return { labelKey: "offline", tone: "secondary" }
}

type TFn = (key: string, opts?: Record<string, unknown>) => string

function lastActiveLabel(agent: Agent, t: TFn): string {
  const candidates = [
    (agent as unknown as { lastActiveAt?: string }).lastActiveAt,
    (agent as unknown as { last_active?: string }).last_active,
    (agent as unknown as { startedAt?: string }).startedAt,
  ].filter((v): v is string => typeof v === "string")
  if (candidates.length === 0) return ""
  const ts = new Date(candidates[0]).getTime()
  if (Number.isNaN(ts)) return ""

  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5) return t("dashboard.agentCard.justNow")
  if (s < 60) return t("dashboard.agentCard.secondsAgo", { count: s })
  if (s < 3600) return t("dashboard.agentCard.minutesAgo", { count: Math.floor(s / 60) })
  if (s < 86400) return t("dashboard.agentCard.hoursAgo", { count: Math.floor(s / 3600) })
  return t("dashboard.agentCard.daysAgo", { count: Math.floor(s / 86400) })
}

interface Props {
  agent: Agent
  isPending: boolean
  todayMessages?: number
  onToggle: () => void
  onOpenChat: () => void
}

export function AgentCard({
  agent,
  isPending,
  todayMessages,
  onToggle,
  onOpenChat,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const isRunning = RUNNING_STATES.includes(agent.state)
  const meta = stateMeta(agent.state)
  const isConnected = !!agent.network
  const wsName =
    (agent.networkName && agent.networkName !== agent.network
      ? agent.networkName
      : agent.network) || ""
  const lastActive = lastActiveLabel(agent, t)

  return (
    <Card className="h-full gap-0 p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        <AgentIcon type={agent.type} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-base font-semibold">{agent.name}</span>
            <Badge variant={meta.tone} className="shrink-0 text-3xs font-semibold">
              {t(`dashboard.agentCard.state.${meta.labelKey}`)}
            </Badge>
          </div>
          <div className="mt-0.5 truncate text-2xs text-muted-foreground">
            {agent.type}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-xs">
        <span
          className={cn(
            "inline-block size-1.5 shrink-0 rounded-full",
            isConnected ? "bg-success" : "bg-muted-foreground",
          )}
        />
        {isConnected ? (
          <span className="truncate text-muted-foreground">
            {t("dashboard.agentCard.connectedTo")}{" "}
            <span className="font-medium text-foreground">{wsName}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">
            {t("dashboard.agentCard.noWorkspace")}
          </span>
        )}
      </div>

      {agent.lastError && (
        <div className="mt-2 rounded-sm bg-(--danger-bg) px-2 py-1.5 text-2xs text-(--danger-text)">
          {agent.lastError}
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-2xs text-muted-foreground">
        {lastActive && (
          <span>{t("dashboard.agentCard.lastActive", { time: lastActive })}</span>
        )}
        {lastActive && todayMessages !== undefined && <span>·</span>}
        {todayMessages !== undefined && (
          <span className="flex items-center gap-1">
            <MessageSquare className="size-3" />
            {t("dashboard.agentCard.messagesToday", { count: todayMessages })}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 border-t pt-3">
        <Button
          size="sm"
          variant={isRunning ? "outline" : "default"}
          onClick={onToggle}
          disabled={isPending}
        >
          {isRunning
            ? isPending
              ? t("dashboard.agentCard.stopping")
              : t("dashboard.agentCard.stop")
            : isPending
              ? t("dashboard.agentCard.starting")
              : t("dashboard.agentCard.start")}
        </Button>
        {agent.hasCli && (
          <Button size="sm" onClick={onOpenChat}>
            {t("dashboard.agentCard.openChat")}
          </Button>
        )}
      </div>
    </Card>
  )
}
