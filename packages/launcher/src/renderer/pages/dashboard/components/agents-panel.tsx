import React, { useMemo, useState } from "react"
import { LayoutGrid, List } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { Card } from "@renderer/components/ui/card"
import { Skeleton } from "@renderer/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@renderer/components/ui/tabs"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
} from "@renderer/components/ui/empty"
import { SearchInput } from "@renderer/components/ui-kit"
import { AgentCard } from "@renderer/components/dashboard/AgentCard"
import { AgentRow } from "@renderer/components/dashboard/AgentRow"
import { QuickActions } from "@renderer/components/dashboard/QuickActions"
import {
  AGENT_FILTERS,
  matchesFilter,
  type AgentFilter,
} from "@renderer/components/dashboard/agent-state"
import { lastActiveOf } from "@renderer/components/dashboard/relative-time"
import { cn } from "@renderer/lib/utils"
import type { Agent } from "@renderer/types"

/** Keep the panel an overview; the rest live one click away on Agents. */
const MAX_VISIBLE_AGENTS = 10

interface Props {
  agents: Agent[]
  loading: boolean
  pendingAgentActions: Set<string>
  todayByAgent: Record<string, number>
  onToggle: (agent: Agent) => void
  onOpenChat: (agent: Agent) => void
  onManage: (agent: Agent) => void
  onStartAll: () => void
  onStopAll: () => void
  onNewWorkspace: () => void
  onAddConnection: () => void
  onViewAll: () => void
  onInstallFirst: () => void
}

export function AgentsPanel({
  agents,
  loading,
  pendingAgentActions,
  todayByAgent,
  onToggle,
  onOpenChat,
  onManage,
  onStartAll,
  onStopAll,
  onNewWorkspace,
  onAddConnection,
  onViewAll,
  onInstallFirst,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<AgentFilter>("all")
  const [view, setView] = useState<"grid" | "list">("grid")

  const counts = useMemo(() => {
    const acc: Record<AgentFilter, number> = {
      all: agents.length,
      running: 0,
      error: 0,
      stopped: 0,
    }
    for (const a of agents) {
      for (const f of AGENT_FILTERS) {
        if (f !== "all" && matchesFilter(a, f)) acc[f] += 1
      }
    }
    return acc
  }, [agents])

  const matched = useMemo(() => {
    const q = search.trim().toLowerCase()
    // Most recently active first — the panel only ever shows the newest few,
    // so recency is what decides which ones are worth the space.
    const activeAt = (a: Agent): number => {
      const ts = new Date(lastActiveOf(a) ?? 0).getTime()
      return Number.isNaN(ts) ? 0 : ts
    }
    return agents
      .filter((a) => {
        if (!matchesFilter(a, filter)) return false
        if (!q) return true
        return (
          a.name.toLowerCase().includes(q) || a.type.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => activeAt(b) - activeAt(a))
  }, [agents, filter, search])

  const visible = matched.slice(0, MAX_VISIBLE_AGENTS)
  const hasRunning = counts.running > 0
  const hasIdle = agents.length > counts.running

  return (
    <Card className="gap-0 p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5">
        <h2 className="text-base font-semibold">
          {t("dashboard.agentsPanel.title")}
        </h2>
        <QuickActions
          hasRunning={hasRunning}
          hasIdle={hasIdle}
          onStartAll={onStartAll}
          onStopAll={onStopAll}
          onNewWorkspace={onNewWorkspace}
          onAddConnection={onAddConnection}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder={t("dashboard.agentsPanel.searchPlaceholder")}
          wrapperClassName="h-8 min-w-50 flex-1"
        />
        <Tabs value={filter} onValueChange={(v) => setFilter(v as AgentFilter)}>
          <TabsList className="h-8">
            {AGENT_FILTERS.map((f) => (
              <TabsTrigger key={f} value={f} className="gap-1.5 px-3 text-xs">
                {t(`dashboard.agentsPanel.filters.${f}`)}
                <span className="text-muted-foreground">{counts[f]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-1">
          {(["grid", "list"] as const).map((v) => (
            <Button
              key={v}
              size="icon-sm"
              variant={view === v ? "secondary" : "ghost"}
              aria-pressed={view === v}
              aria-label={t(`dashboard.agentsPanel.${v}View`)}
              onClick={() => setView(v)}
            >
              {v === "grid" ? <LayoutGrid /> : <List />}
            </Button>
          ))}
        </div>
      </div>

      <div className="border-t px-4 py-4">
        {loading ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : agents.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyDescription>
                {t("dashboard.agentsPanel.empty")}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={onInstallFirst}>
                {t("dashboard.agentsPanel.installFirst")}
              </Button>
            </EmptyContent>
          </Empty>
        ) : visible.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyDescription>
                {t("dashboard.agentsPanel.emptyNoMatch")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div
            className={cn(
              "grid gap-3",
              view === "grid" ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1",
            )}
          >
            {visible.map((agent) => {
              const props = {
                agent,
                isPending: pendingAgentActions.has(agent.name),
                todayMessages: todayByAgent[agent.name],
                onToggle: () => onToggle(agent),
                onOpenChat: () => onOpenChat(agent),
                onManage: () => onManage(agent),
              }
              return view === "grid" ? (
                <AgentCard key={agent.name} {...props} />
              ) : (
                <AgentRow key={agent.name} {...props} />
              )
            })}
          </div>
        )}
      </div>

      {agents.length > 0 && (
        <div className="border-t px-4 py-2.5 text-center">
          <Button variant="link" size="sm" onClick={onViewAll}>
            {t("dashboard.agentsPanel.viewAll")}
          </Button>
        </div>
      )}
    </Card>
  )
}
