import React from "react"
import {
  Cpu,
  MoreHorizontal,
  Plus,
  Play,
  SlidersHorizontal,
  Square,
  Terminal,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import AgentIcon from "@renderer/components/AgentIcon"
import { Button } from "@renderer/components/ui/button"
import { Card } from "@renderer/components/ui/card"
import { EmptyState } from "@renderer/components/ui-kit"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu"
import { Skeleton } from "@renderer/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table"
import {
  STATE_TEXT_CLASS,
  stateKeyOf,
  workspaceLabel,
} from "@renderer/lib/agent-state"
import { deriveModel } from "@renderer/lib/agent-model"
import { relativeTimeAgo } from "@renderer/lib/relative-time"
import { cn } from "@renderer/lib/utils"
import type { Agent } from "@renderer/types"

const COLUMNS = [
  "agent",
  "workspace",
  "status",
  "lastActive",
  "actions",
] as const

interface Props {
  /** Already ordered newest-first and cut to the few the dashboard shows. */
  agents: Agent[]
  lastActive: Record<string, string | undefined>
  loading: boolean
  pending: Set<string>
  onToggle: (agent: Agent) => void
  onOpenTerminal: (agent: Agent) => void
  onConnect: (agent: Agent) => void
  onManage: (agent: Agent) => void
  onViewAll: () => void
  onNewAgent: () => void
  /** Agents in total, not just the rows shown — gates "View all". */
  total: number
}

/**
 * The recent-agents table. Deliberately unfiltered: this is a glance at what
 * ran last, and anything that needs searching or paging belongs on Agents.
 */
export function AgentsCard({
  agents,
  lastActive,
  loading,
  pending,
  onToggle,
  onOpenTerminal,
  onConnect,
  onManage,
  onViewAll,
  onNewAgent,
  total,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Card className="gap-0 p-0">
      <div className="flex items-center justify-between gap-2 px-4 py-3.5">
        <h2 className="text-base font-semibold">{t("dashboard.agents.title")}</h2>
        {/* No refresh control: the list re-polls every few seconds on its own,
            so the button only ever raced the poll it was standing next to. */}
        {total > agents.length && (
          <Button variant="link" size="sm" onClick={onViewAll}>
            {t("dashboard.agents.viewAll")}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col gap-2.5 border-t px-4 py-4">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : agents.length === 0 ? (
        <div className="border-t">
          <EmptyState
            icon={<Cpu />}
            title={t("agents.list.emptyTitle")}
            description={t("dashboard.agents.empty")}
            action={{
              label: t("common.actions.newAgent"),
              icon: <Plus />,
              onClick: onNewAgent,
            }}
          />
        </div>
      ) : (
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {COLUMNS.map((c) => (
                  <TableHead
                    key={c}
                    className={c === "actions" ? "text-center" : undefined}
                  >
                    {t(`dashboard.agents.columns.${c}`)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => (
                <AgentTableRow
                  key={agent.name}
                  agent={agent}
                  lastActiveAt={lastActive[agent.name]}
                  busy={pending.has(agent.name)}
                  onToggle={() => onToggle(agent)}
                  onOpenTerminal={() => onOpenTerminal(agent)}
                  onConnect={() => onConnect(agent)}
                  onManage={() => onManage(agent)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  )
}

interface RowProps {
  agent: Agent
  lastActiveAt?: string
  busy: boolean
  onToggle: () => void
  onOpenTerminal: () => void
  onConnect: () => void
  onManage: () => void
}

function AgentTableRow({
  agent,
  lastActiveAt,
  busy,
  onToggle,
  onOpenTerminal,
  onConnect,
  onManage,
}: RowProps): React.JSX.Element {
  const { t } = useTranslation()

  const stateKey = stateKeyOf(agent)
  // Not "what did the core write" — an agent with no workspace has `running`
  // written for it while nothing runs, so starting, stopping and stepping into
  // it are all offers the launcher cannot keep.
  const notConnected = stateKey === "notConnected"
  const running = stateKey === "running" || stateKey === "idle"
  const workspace = workspaceLabel(agent)
  const model = deriveModel(agent) || agent.type

  return (
    <TableRow data-testid={`dashboard-agent-${agent.name}`} className="h-16">
      {/* Absorbs the leftover width so the truncation inside is real — a cell
          left to size itself would widen the table on a long model name. */}
      <TableCell className="w-full max-w-0">
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
            <AgentIcon type={agent.type} size={18} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{agent.name}</div>
            <div className="truncate text-xs text-muted-foreground" title={model}>
              {model}
            </div>
          </div>
        </div>
      </TableCell>

      {/* Same shape as the agents list: the name when there is one, an em
          dash when there is not — never a sentence, which the status column
          next to it is already saying. */}
      <TableCell className="max-w-40 truncate text-sm" title={workspace}>
        {workspace || <span className="text-muted-foreground">—</span>}
      </TableCell>

      <TableCell>
        <span className={cn("text-sm font-medium", STATE_TEXT_CLASS[stateKey])}>
          {t(`dashboard.agents.states.${stateKey}`)}
        </span>
      </TableCell>

      <TableCell className="text-xs text-muted-foreground">
        {relativeTimeAgo(t, lastActiveAt) || "—"}
      </TableCell>

      <TableCell>
        <div className="flex items-center justify-center gap-1.5">
          {/* One inline action, picked by what the agent can do next: start it,
              step into the session it is already running, or — for an agent
              with no CLI to step into — stop it. Whatever the row does not
              show inline is the only thing the menu adds; repeating the inline
              button inside the menu is what made it read as duplicated. */}
          {notConnected ? (
            // The one move that changes anything here, and the same one the
            // agents list offers: give it a workspace to work in. It is dressed
            // the same as there too — primary, unadorned — because the same
            // offer wearing two different buttons reads as two offers.
            <Button size="sm" onClick={onConnect}>
              {t("dashboard.agents.connect")}
            </Button>
          ) : !running ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onToggle}
            >
              <Play />
              {t("dashboard.agents.start")}
            </Button>
          ) : agent.hasCli ? (
            <Button size="sm" variant="outline" onClick={onOpenTerminal}>
              <Terminal />
              {t("dashboard.agents.openTerminal")}
            </Button>
          ) : (
            // Stop is a destructive entry point, and the app dresses every one
            // of those the same way: colour, no frame.
            <Button
              size="sm"
              variant="destructive-ghost"
              disabled={busy}
              onClick={onToggle}
            >
              <Square />
              {t("dashboard.agents.stop")}
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t("dashboard.agents.more")}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!notConnected && running && agent.hasCli && (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={busy}
                  onClick={onToggle}
                >
                  <Square />
                  {t("dashboard.agents.stop")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onManage}>
                <SlidersHorizontal />
                {t("dashboard.agents.manage")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  )
}
