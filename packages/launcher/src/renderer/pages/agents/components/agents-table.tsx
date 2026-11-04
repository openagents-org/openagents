import React from "react"
import { useTranslation } from "react-i18next"
import { Layers, LogIn } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table"
import AgentIcon from "@renderer/components/AgentIcon"
import { STATE_DOT_CLASS, STATE_TEXT_CLASS } from "@renderer/lib/agent-state"
import { cn } from "@renderer/lib/utils"
import type { AgentRow } from "../use-agents-view"
import { AgentErrorDialog } from "./agent-error-dialog"
import { agentLabel, type AgentActionHandlers } from "./agent-actions"
import { AgentRowMenu } from "./agent-row-menu"

const COLUMNS = ["agent", "workspace", "model", "status", "actions"] as const

/**
 * Each column's share of the width. Every column but the agent's used to
 * shrink to its content, which handed all the slack to the first one: the
 * names sat at the left, the rest crowded at the right, and a gap between.
 * Shares spread the slack across all of them; the actions keep their content
 * width. The text cells carry `max-w-0` so a long name or model truncates
 * inside its share instead of widening the column.
 */
const WIDTH: Record<(typeof COLUMNS)[number], string> = {
  agent: "w-1/3",
  workspace: "w-1/6",
  model: "w-1/4",
  status: "w-1/6",
  actions: "w-px",
}

interface Props extends AgentActionHandlers {
  rows: AgentRow[]
  pending: Set<string>
}

/** Clicks inside it do their own thing, not the row's. */
const own = (e: React.MouseEvent): void => e.stopPropagation()

/**
 * This computer's agents as a table whose columns each answer something a
 * user checks: which agent, in which workspace, on which model, doing what.
 * A bare list of names and states left most of the width empty.
 *
 * A row opens the agent's settings, as Configure in its menu does; the hover
 * says so. The row itself keeps one action, the way into its workspace —
 * everything else is in the menu.
 */
export function AgentsTable({
  rows,
  pending,
  onToggle,
  onOpenTerminal,
  onConfigure,
  onRename,
  onConnect,
  onDisconnect,
  onOpenWorkspace,
  onRemove,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    // Clipped, not overflow-hidden: neither box may become a scroll container,
    // or the header would stick to it rather than under the page's toolbar.
    <div className="overflow-clip rounded-lg border bg-card">
        <Table containerClassName="overflow-x-clip">
          <TableHeader className="sticky top-12 z-5 bg-card">
            <TableRow className="hover:bg-transparent">
              {COLUMNS.map((c) => (
                <TableHead
                  key={c}
                  className={cn(
                    "px-4 text-xs font-normal whitespace-nowrap text-muted-foreground first:pl-6",
                    WIDTH[c],
                    c === "actions" && "pr-6 text-right",
                  )}
                >
                  {t(`agents.list.columns.${c}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ agent, providerLabel, workspace, model, auth, status }) => {
              // Read from the status the row is already showing, not a second
              // opinion on the raw state: an agent with no workspace has
              // `running` written for it while nothing drives it.
              const running = status === "running" || status === "idle"
              const connected = status !== "notConnected"
              return (
                <TableRow
                  key={agent.name}
                  data-testid={`agent-row-${agent.name}`}
                  data-state={agent.state}
                  data-network={agent.network || ""}
                  className="group h-16 cursor-pointer"
                  onClick={() => onConfigure(agent)}
                >
                  <TableCell className="max-w-0 pr-4 pl-6">
                    <div className="flex min-w-0 items-center gap-3">
                      <AgentIcon type={agent.type} size={32} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium group-hover:underline" title={agentLabel(agent)}>
                          {agentLabel(agent)}
                        </div>
                        <div className="truncate text-xs text-muted-foreground" title={providerLabel}>{providerLabel}</div>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="max-w-0 px-4">
                    {workspace ? (
                      // The name doubles as a way into it.
                      <button type="button" onClick={(e) => { own(e); onOpenWorkspace(agent) }}
                        className="flex max-w-full items-center gap-1.5 text-sm hover:underline"
                        aria-label={t("agents.list.openWorkspace")} title={workspace}>
                        <Layers className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{workspace}</span>
                      </button>
                    ) : (
                      <span className="text-sm text-muted-foreground">{t("agents.list.noWorkspace")}</span>
                    )}
                  </TableCell>

                  <TableCell className="max-w-0 px-4">
                    <div className="truncate font-mono text-xs" title={model || undefined}>
                      {model || <span className="font-sans text-muted-foreground">{t("agents.list.defaultModel")}</span>}
                    </div>
                    {auth && (
                      <div className="text-xs text-muted-foreground">
                        {t(auth === "cli_login" ? "agents.list.health.cliLogin" : "agents.list.health.apiKey")}
                      </div>
                    )}
                  </TableCell>

                  {/* One line, always. The error text itself opens in a dialog. */}
                  <TableCell className="px-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className={cn("size-2 shrink-0 rounded-full", STATE_DOT_CLASS[status])} />
                      <span className={cn("text-sm", STATE_TEXT_CLASS[status])}>{t(`agents.list.statuses.${status}`)}</span>
                      {status === "error" && agent.lastError && (
                        <span onClick={own}><AgentErrorDialog agentName={agent.name} message={agent.lastError} /></span>
                      )}
                    </div>
                  </TableCell>

                  <TableCell className="pr-6 pl-4 whitespace-nowrap" onClick={own}>
                    <div className="flex items-center justify-end gap-1.5">
                      {agent.network ? (
                        <>
                          {/* Joining is done once; going there is what the row
                              is for from then on, so it leads the actions. */}
                          <Button size="sm" variant="outline" data-testid={`agent-enter-workspace-${agent.name}`}
                            onClick={() => onOpenWorkspace(agent)}>
                            <LogIn />
                            {t("agents.list.enterWorkspace")}
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" data-testid={`agent-connect-${agent.name}`} onClick={() => onConnect(agent)}>
                          {t("agents.list.connect")}
                        </Button>
                      )}
                      <AgentRowMenu agent={agent} running={running} connected={connected} busy={pending.has(agent.name)}
                        onRename={onRename} onConfigure={onConfigure} onOpenTerminal={onOpenTerminal} onToggle={onToggle}
                        onDisconnect={onDisconnect} onRemove={onRemove} />
                    </div>
                  </TableCell>

                </TableRow>
              )
            })}
          </TableBody>
        </Table>
    </div>
  )
}
