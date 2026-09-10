import React from "react"
import { useTranslation } from "react-i18next"
import {
  KeyRound,
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
import { relativeTimeAgo } from "@renderer/lib/relative-time"
import { STATE_TEXT_CLASS } from "@renderer/lib/agent-state"
import { cn } from "@renderer/lib/utils"
import type { AgentRow } from "../use-agents-view"
import { AgentErrorDialog } from "./agent-error-dialog"
import { agentLabel, type AgentActionHandlers } from "./agent-actions"

const COLUMNS = [
  "agent",
  "provider",
  "auth",
  "workspace",
  "status",
  "lastActive",
  "actions",
] as const

/**
 * Columns that render something of a known, fixed size — an icon, a status
 * word, a relative timestamp, a pair of buttons. They are collapsed onto their
 * content so the remaining width goes to `agent` / `provider` / `workspace`,
 * which truncate. The alternative is what this table used to do: share the
 * width evenly, overflow the viewport at the 1200px minimum, and let the
 * container clip the actions column out of sight.
 */
const SHRINK_COLUMNS = new Set<string>([
  "auth",
  "status",
  "lastActive",
  "actions",
])

interface Props extends AgentActionHandlers {
  rows: AgentRow[]
  pending: Set<string>
}

/**
 * The dense view. Everything the cards show is here as a column, so the two
 * views differ in shape only — never in what they know.
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
    <div className="overflow-hidden rounded-xl border bg-card">
      {/* Tighter gutters than the shared default: seven columns at the 1200px
          minimum window leave ~860px of content, and px-4 on every cell alone
          spent a quarter of it on whitespace. */}
      <Table className="[&_td]:px-3 [&_th]:px-3">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((c) => (
              <TableHead
                key={c}
                className={cn(
                  c === "actions" && "text-center",
                  c === "auth" && "text-center",
                  // Columns whose content is a fixed size take only what they
                  // need (`w-px` collapses a table column onto its content),
                  // so every pixel of pressure lands on the three that can
                  // truncate instead of on the buttons. Without this the
                  // actions column was the one that got cut off the screen.
                  SHRINK_COLUMNS.has(c) && "w-px whitespace-nowrap",
                )}
              >
                {t(`agents.list.columns.${c}`)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ agent, providerLabel, model, auth, workspace, status, lastActiveAt }) => {
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
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                      <AgentIcon type={agent.type} size={18} />
                    </span>
                    {/* Widths step up with the window instead of being fixed
                        at the roomy value. Seven columns at the 1200px minimum
                        only fit if the three truncating ones give way there;
                        holding max-w-36/40 at every size is what pushed the
                        row past the viewport and cut the actions column off. */}
                    <div className="min-w-0 max-w-28 xl:max-w-32 2xl:max-w-36">
                      <div
                        className="truncate text-sm font-medium"
                        title={agentLabel(agent)}
                      >
                        {agentLabel(agent)}
                      </div>
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {agent.type}
                      </div>
                    </div>
                  </div>
                </TableCell>

                <TableCell>
                  <div
                    className="max-w-28 truncate text-sm xl:max-w-36 2xl:max-w-40"
                    title={providerLabel}
                  >
                    {providerLabel}
                  </div>
                  <div
                    className="max-w-28 truncate text-xs text-muted-foreground xl:max-w-36 2xl:max-w-40"
                    title={model || undefined}
                  >
                    {model || "—"}
                  </div>
                </TableCell>

                <TableCell className="whitespace-nowrap text-center">
                  {/* Icon only, with the wording on hover: spelled out, this
                      column cost more width than the fact is worth. */}
                  {auth ? (
                    <span
                      title={t(
                        auth === "api_key"
                          ? "agents.list.health.apiKey"
                          : "agents.list.health.cliLogin",
                      )}
                    >
                      {auth === "api_key" ? (
                        <KeyRound className="inline size-4 text-muted-foreground" />
                      ) : (
                        <Terminal className="inline size-4 text-muted-foreground" />
                      )}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>

                <TableCell>
                  {workspace ? (
                    // The workspace name doubles as the way into it — there is
                    // no other row-level affordance for "take me there".
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto max-w-28 justify-start px-0 text-sm xl:max-w-36 2xl:max-w-40"
                      aria-label={t("agents.list.openWorkspace")}
                      title={workspace}
                      onClick={() => onOpenWorkspace(agent)}
                    >
                      <span className="truncate">{workspace}</span>
                    </Button>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>

                {/* One line, always. The error text itself opens in a dialog —
                    printing it here made rows grow past their fixed height and
                    widened the column at every other column's expense. */}
                <TableCell className="whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <span
                      className={cn(
                        "text-sm font-medium",
                        STATE_TEXT_CLASS[status],
                      )}
                    >
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

                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {relativeTimeAgo(t, lastActiveAt) || "—"}
                </TableCell>

                <TableCell className="whitespace-nowrap">
                  {/* The menu only ever adds what the row does not already
                      show: repeating Configure in both read as a duplicate. */}
                  <div className="flex items-center justify-center gap-1.5">
                    {agent.network ? (
                      agent.hasCli && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onOpenTerminal(agent)}
                        >
                          <Terminal />
                          {t("agents.list.chat")}
                        </Button>
                      )
                    ) : (
                      <Button
                        size="sm"
                        data-testid={`agent-connect-${agent.name}`}
                        onClick={() => onConnect(agent)}
                      >
                        {t("agents.list.connect")}
                      </Button>
                    )}

                    {/* One inline action, then the menu. Configure used to sit
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
