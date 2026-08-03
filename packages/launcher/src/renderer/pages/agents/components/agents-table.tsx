import React from "react"
import { useTranslation } from "react-i18next"
import {
  KeyRound,
  MoreHorizontal,
  Play,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
  Unplug,
  Boxes,
} from "lucide-react"

import { Badge } from "@renderer/components/ui/badge"
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
import type { AgentRow, AgentStatus } from "../use-agents-view"
import type { AgentActionHandlers } from "./agent-actions"

const STATUS_VARIANT: Record<AgentStatus, "success" | "danger" | "muted"> = {
  running: "success",
  error: "danger",
  stopped: "muted",
  disconnected: "muted",
}

const RUNNING_STATES = ["online", "running", "idle"]

const COLUMNS = [
  "agent",
  "provider",
  "auth",
  "workspace",
  "status",
  "lastActive",
  "actions",
] as const

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
  onConnect,
  onDisconnect,
  onOpenWorkspace,
  onRemove,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((c) => (
              <TableHead
                key={c}
                className={c === "actions" ? "text-right" : undefined}
              >
                {t(`agents.list.columns.${c}`)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ agent, providerLabel, model, auth, workspace, status, lastActiveAt }) => {
            const running = RUNNING_STATES.includes(agent.state)
            const busy = pending.has(agent.name)
            return (
              <TableRow
                key={agent.name}
                data-testid={`agent-row-${agent.name}`}
                data-state={agent.state}
                data-network={agent.network || ""}
              >
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
                      <AgentIcon type={agent.type} size={16} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium">
                        {agent.name}
                      </div>
                      <div className="truncate font-mono text-2xs text-muted-foreground">
                        {agent.type}
                      </div>
                    </div>
                  </div>
                </TableCell>

                <TableCell>
                  <div className="truncate text-xs">{providerLabel}</div>
                  <div className="truncate text-2xs text-muted-foreground">
                    {model || "—"}
                  </div>
                </TableCell>

                <TableCell>
                  {auth ? (
                    <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                      {auth === "api_key" ? (
                        <KeyRound className="size-3" />
                      ) : (
                        <Terminal className="size-3" />
                      )}
                      {t(
                        auth === "api_key"
                          ? "agents.list.health.apiKey"
                          : "agents.list.health.cliLogin",
                      )}
                    </span>
                  ) : (
                    <span className="text-2xs text-muted-foreground">—</span>
                  )}
                </TableCell>

                <TableCell>
                  {workspace ? (
                    // The workspace name doubles as the way into it — there is
                    // no other row-level affordance for "take me there".
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto max-w-40 justify-start px-0 text-xs"
                      aria-label={t("agents.list.openWorkspace")}
                      title={t("agents.list.openWorkspace")}
                      onClick={() => onOpenWorkspace(agent)}
                    >
                      <span className="truncate">{workspace}</span>
                    </Button>
                  ) : (
                    <span className="text-2xs text-muted-foreground">—</span>
                  )}
                </TableCell>

                <TableCell>
                  <Badge variant={STATUS_VARIANT[status]} size="sm">
                    {t(`agents.list.statuses.${status}`)}
                  </Badge>
                  {agent.lastError && (
                    <div
                      className="mt-1 max-w-40 truncate text-3xs text-destructive"
                      title={agent.lastError}
                    >
                      {agent.lastError}
                    </div>
                  )}
                </TableCell>

                <TableCell className="text-2xs text-muted-foreground">
                  {relativeTimeAgo(t, lastActiveAt) || "—"}
                </TableCell>

                <TableCell>
                  <div className="flex items-center justify-end gap-1.5">
                    {agent.network ? (
                      agent.hasCli && (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => onOpenTerminal(agent)}
                        >
                          <Terminal />
                          {t("agents.list.chat")}
                        </Button>
                      )
                    ) : (
                      <Button
                        size="xs"
                        data-testid={`agent-connect-${agent.name}`}
                        onClick={() => onConnect(agent)}
                      >
                        {t("agents.list.connect")}
                      </Button>
                    )}

                    <Button
                      size="xs"
                      variant="outline"
                      data-testid={`agent-configure-${agent.name}`}
                      onClick={() => onConfigure(agent)}
                    >
                      {t("agents.list.configure")}
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={t("agents.list.more")}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={busy}
                          data-testid={`agent-toggle-${agent.name}`}
                          onClick={() => onToggle(agent)}
                        >
                          {running ? <Square /> : <Play />}
                          {running
                            ? t("agents.list.stop")
                            : t("agents.list.start")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onConfigure(agent)}>
                          <SlidersHorizontal />
                          {t("agents.list.configure")}
                        </DropdownMenuItem>
                        {agent.network ? (
                          <DropdownMenuItem onClick={() => onDisconnect(agent)}>
                            <Unplug />
                            {t("agents.list.disconnect")}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => onConnect(agent)}>
                            <Boxes />
                            {t("agents.list.connect")}
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
