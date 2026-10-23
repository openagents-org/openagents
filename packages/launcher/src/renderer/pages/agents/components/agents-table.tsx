import React from "react"
import { useTranslation } from "react-i18next"
import {
  LogIn,
  MoreHorizontal,
  Pencil,
  Play,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
  Unplug,
} from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu"
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

const COLUMNS = ["agent", "status", "actions"] as const

interface Props extends AgentActionHandlers {
  rows: AgentRow[]
  pending: Set<string>
}

/**
 * This computer's agents, three columns: who it is (name, then type and
 * workspace underneath), what it is doing, and what can be done with it. The
 * model, sign-in method and last activity live in the agent's settings and
 * its logs rather than as columns of their own.
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
        <TableHeader className="sticky top-14 z-5 bg-card">
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((c) => (
              <TableHead
                key={c}
                className={cn(
                  "px-6 text-xs font-normal text-muted-foreground",
                  c === "status" && "w-56",
                  c === "actions" && "w-px text-right whitespace-nowrap",
                )}
              >
                {t(`agents.list.columns.${c}`)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ agent, providerLabel, workspace, status }) => {
            // Read from the status the row is already showing, not a second
            // opinion on the raw state: an agent with no workspace has
            // `running` written for it while nothing drives it.
            const running = status === "running" || status === "idle"
            const connected = status !== "notConnected"
            const busy = pending.has(agent.name)
            return (
              <TableRow
                key={agent.name}
                data-testid={`agent-row-${agent.name}`}
                data-state={agent.state}
                data-network={agent.network || ""}
                className="h-16"
              >
                <TableCell className="px-6">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-card">
                      <AgentIcon type={agent.type} size={22} />
                    </span>
                    <div className="min-w-0">
                      <button onClick={() => onConfigure(agent)} className="block max-w-full truncate text-left text-sm font-medium hover:text-primary hover:underline" title={agentLabel(agent)}>
                        {agentLabel(agent)}
                      </button>
                      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="truncate" title={providerLabel}>{providerLabel}</span>
                        {/* No workspace, nothing after the type: the status
                            column already says "not connected", and saying it
                            twice in one row read as two different facts. */}
                        {workspace && (
                          <>
                            <span aria-hidden>·</span>
                            {/* The workspace name doubles as a way into it,
                                beside the row's own Enter workspace button. */}
                            <button
                              type="button"
                              className="truncate hover:text-primary hover:underline"
                              aria-label={t("agents.list.openWorkspace")}
                              title={workspace}
                              onClick={() => onOpenWorkspace(agent)}
                            >
                              {workspace}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </TableCell>

                {/* One line, always. The error text itself opens in a dialog —
                    printing it here made rows grow past their fixed height. */}
                <TableCell className="px-6 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2 shrink-0 rounded-full", STATE_DOT_CLASS[status])} />
                    <span className={cn("text-sm", STATE_TEXT_CLASS[status])}>
                      {t(`agents.list.statuses.${status}`)}
                    </span>
                    {status === "error" && agent.lastError && (
                      <AgentErrorDialog
                        agentName={agent.name}
                        message={agent.lastError}
                      />
                    )}
                  </div>
                </TableCell>

                <TableCell className="px-6 whitespace-nowrap">
                  {/* The menu only ever adds what the row does not already
                      show: repeating Configure in both read as a duplicate.
                      Right-aligned, so the menu sits in the same place on
                      every row whatever buttons come before it. */}
                  <div className="flex items-center justify-end gap-1.5">
                    {agent.network ? (
                      <>
                        {/* Joining is done once; going there is what the row
                            is for from then on, so it leads the actions. */}
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`agent-enter-workspace-${agent.name}`}
                          onClick={() => onOpenWorkspace(agent)}
                        >
                          <LogIn />
                          {t("agents.list.enterWorkspace")}
                        </Button>
                        {agent.hasCli && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onOpenTerminal(agent)}
                          >
                            <Terminal />
                            {t("agents.list.chat")}
                          </Button>
                        )}
                      </>
                    ) : (
                      <Button
                        size="sm"
                        data-testid={`agent-connect-${agent.name}`}
                        onClick={() => onConnect(agent)}
                      >
                        {t("agents.list.connect")}
                      </Button>
                    )}

                    {/* The inline actions, then the menu. Configure used to sit
                        here too, appearing above 1536px and moving into the
                        menu below it — so the same action had no fixed home and
                        the row width changed with the window. It now lives in
                        the menu at every size. */}
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
                        {/* Grouped by what the action does to the agent:
                            edit it, run it, then destroy it — separated so the
                            last group is never one slip away from the first. */}
                        <DropdownMenuItem onClick={() => onRename(agent)}>
                          <Pencil />
                          {t("agents.list.rename")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onConfigure(agent)}>
                          <SlidersHorizontal />
                          {t("agents.list.configure")}
                        </DropdownMenuItem>
                        {(connected || agent.network) && <DropdownMenuSeparator />}
                        {/* Nothing to start or stop without a workspace —
                            there is no message source and no process, so both
                            are offers the launcher cannot keep. Joining one is
                            the only move, and the row already offers it. */}
                        {connected && (
                          <DropdownMenuItem
                            // Stopping is a destructive entry point and is
                            // coloured like every other one; starting is not.
                            variant={running ? "destructive" : "default"}
                            disabled={busy}
                            data-testid={`agent-toggle-${agent.name}`}
                            onClick={() => onToggle(agent)}
                          >
                            {running ? <Square /> : <Play />}
                            {running
                              ? t("agents.list.stop")
                              : t("agents.list.start")}
                          </DropdownMenuItem>
                        )}
                        {agent.network && (
                          <DropdownMenuItem onClick={() => onDisconnect(agent)}>
                            <Unplug />
                            {t("agents.list.disconnect")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => onRemove(agent)}
                        >
                          <Trash2 />
                          {t("agents.list.remove")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
