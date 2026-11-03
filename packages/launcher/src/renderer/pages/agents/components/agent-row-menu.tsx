import React from "react"
import { useTranslation } from "react-i18next"
import {
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
import type { Agent } from "@renderer/types"
import type { AgentActionHandlers } from "./agent-actions"

/**
 * Everything a row does not show itself, grouped by what it does to the
 * agent: edit it, run it, then destroy it — separated so the last group is
 * never one slip away from the first.
 */
export function AgentRowMenu({
  agent,
  running,
  connected,
  busy,
  onRename,
  onConfigure,
  onOpenTerminal,
  onToggle,
  onDisconnect,
  onRemove,
}: {
  agent: Agent
  running: boolean
  connected: boolean
  busy: boolean
} & Pick<AgentActionHandlers, "onRename" | "onConfigure" | "onOpenTerminal" | "onToggle" | "onDisconnect" | "onRemove">): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={t("agents.list.more")}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onRename(agent)}>
          <Pencil />
          {t("agents.list.rename")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onConfigure(agent)}>
          <SlidersHorizontal />
          {t("agents.list.configure")}
        </DropdownMenuItem>
        {(connected || agent.network) && <DropdownMenuSeparator />}
        {/* Its CLI in a terminal — for a sign-in or a look at what it is doing;
            not often enough to be a button on every row. */}
        {agent.network && agent.hasCli && (
          <DropdownMenuItem onClick={() => onOpenTerminal(agent)}>
            <Terminal />
            {t("agents.list.chat")}
          </DropdownMenuItem>
        )}
        {/* Nothing to start or stop without a workspace — there is no message
            source and no process, so both are offers the launcher cannot keep.
            Joining one is the only move, and the row already offers it. */}
        {connected && (
          <DropdownMenuItem
            // Stopping is a destructive entry point and is coloured like every
            // other one; starting is not.
            variant={running ? "destructive" : "default"}
            disabled={busy}
            data-testid={`agent-toggle-${agent.name}`}
            onClick={() => onToggle(agent)}
          >
            {running ? <Square /> : <Play />}
            {running ? t("agents.list.stop") : t("agents.list.start")}
          </DropdownMenuItem>
        )}
        {agent.network && (
          <DropdownMenuItem onClick={() => onDisconnect(agent)}>
            <Unplug />
            {t("agents.list.disconnect")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onRemove(agent)}>
          <Trash2 />
          {t("agents.list.remove")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
