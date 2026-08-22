import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import { useAgentsStore } from "@renderer/store/agents"
import { capture } from "@renderer/lib/analytics"
import { workspaceWebBaseUrl } from "@renderer/lib/workspace-urls"
import type { Agent } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

type ShowToast = (msg: string, type?: ToastType) => void

export interface AgentActions {
  toggleAgent: (agent: Agent) => Promise<void>
  removeAgent: (name: string) => Promise<void>
  disconnectAgent: (name: string) => Promise<void>
  openWorkspace: (agent: Agent) => Promise<void>
  openAgentChat: (agent: Agent) => Promise<void>
}

/**
 * Start/stop, remove, connect and terminal actions for the agents list. Split
 * out of the page so the view stays readable — the start/stop paths carry the
 * bulk of the code here (they poll the daemon until the state actually flips
 * rather than trusting the command's return).
 */
export function useAgentActions(
  refresh: () => void,
  showToast: ShowToast,
  onRemoved?: () => void,
): AgentActions {
  const { t } = useTranslation()
  const { pendingAgentActions, addPendingAction, removePendingAction } =
    useAgentsStore(
      useShallow((s) => ({
        pendingAgentActions: s.pendingAgentActions,
        addPendingAction: s.addPendingAction,
        removePendingAction: s.removePendingAction,
      })),
    )

  const toggleAgent = async (agent: Agent): Promise<void> => {
    if (pendingAgentActions.has(agent.name)) return
    addPendingAction(agent.name)
    refresh()
    try {
      const isRunning = ["online", "running", "idle"].includes(agent.state)
      if (isRunning) {
        capture("agent_stopped", {
          agent_name: agent.name,
          agent_type: agent.type,
        })
        await window.api.stopAgent(agent.name)
        showToast(
          t("agents.list.toast.stoppingAgent", { name: agent.name }),
          "info",
        )
        // Fast initial polls — the daemon now processes stop commands within
        // ~200ms, so checking quickly catches the state flip without making
        // the user stare at a "Stopping…" toast for 3+ seconds.
        const stopWaits = [400, 800, 1500, 2500, 3000, 3000]
        for (const w of stopWaits) {
          await new Promise((r) => setTimeout(r, w))
          const status = await window.api.agentStatus()
          if (!status[agent.name] || status[agent.name].state === "stopped") {
            showToast(
              t("agents.list.toast.stoppedAgent", { name: agent.name }),
              "success",
            )
            break
          }
          refresh()
        }
      } else {
        capture("agent_started", {
          agent_name: agent.name,
          agent_type: agent.type,
        })
        await window.api.startAgent(agent.name)
        showToast(
          t("agents.list.toast.startingAgent", { name: agent.name }),
          "info",
        )
        const startWaits = [
          500, 1000, 1500, 2500, 3000, 3000, 3000, 3000, 3000, 3000,
        ]
        for (const w of startWaits) {
          await new Promise((r) => setTimeout(r, w))
          const status = await window.api.agentStatus()
          const s = status[agent.name]
          if (s && ["running", "online"].includes(s.state)) {
            showToast(
              t("agents.list.toast.nowRunning", { name: agent.name }),
              "success",
            )
            break
          }
          refresh()
        }
      }
    } catch (err: unknown) {
      showToast(
        t("agents.list.toast.error", { message: (err as Error).message }),
        "error",
      )
    } finally {
      removePendingAction(agent.name)
      refresh()
    }
  }

  const removeAgent = async (name: string): Promise<void> => {
    onRemoved?.()
    try {
      await window.api.removeAgent(name)
      showToast(t("agents.list.toast.removed", { name }), "success")
      refresh()
    } catch (err: unknown) {
      showToast(
        t("agents.list.toast.error", { message: (err as Error).message }),
        "error",
      )
    }
  }

  const disconnectAgent = async (name: string): Promise<void> => {
    try {
      await window.api.disconnectWorkspace(name)
      showToast(t("agents.list.toast.disconnected", { name }), "success")
      window.api.signalReload()
      refresh()
    } catch (err: unknown) {
      showToast(
        t("agents.list.toast.error", { message: (err as Error).message }),
        "error",
      )
    }
  }

  const openWorkspace = async (agent: Agent): Promise<void> => {
    // An agent that isn't bound to a workspace runs "local only" in the daemon
    // and never joins the workspace channel — so it can't ever answer messages
    // sent from the web chat. Catch that here instead of opening a chat that
    // silently goes nowhere.
    if (!agent.network) {
      showToast(
        t("agents.list.toast.notConnectedYet", { name: agent.name }),
        "warning",
      )
      return
    }
    try {
      // The agent must be running to reply in the workspace. Opening the web
      // chat against a stopped agent is the #1 "agent never responds" trap —
      // start it first and wait briefly for it to come online so the chat the
      // user lands on is actually live.
      const isRunning = ["online", "running", "idle"].includes(agent.state)
      if (!isRunning) {
        showToast(
          t("agents.list.toast.startingEllipsis", { name: agent.name }),
          "info",
        )
        try {
          await window.api.startAgent(agent.name)
          for (let i = 0; i < 5; i++) {
            await new Promise((r) => setTimeout(r, 1200))
            const status = await window.api.agentStatus()
            const st = status[agent.name]?.state
            if (st && ["online", "running", "idle"].includes(st)) break
          }
        } catch (e: unknown) {
          showToast(
            t("agents.list.toast.couldntStart", {
              name: agent.name,
              message: (e as Error).message,
            }),
            "error",
          )
          return
        }
      }
      const workspaces = await window.api.listWorkspaces()
      const ws = workspaces.find(
        (w) => w.slug === agent.network || w.id === agent.network,
      )
      const slug = (ws && ws.slug) || agent.network
      // Deliberately no ?token= here: the address bar leaks into history and
      // screen shares, and the browser session handles access on its own.
      window.api.openExternal(`${workspaceWebBaseUrl(ws?.endpoint)}/${slug}`)
    } catch (err: unknown) {
      showToast(
        t("agents.list.toast.error", { message: (err as Error).message }),
        "error",
      )
    }
  }

  // Open a terminal in the agent's working folder, launching its CLI so the
  // user can interact with the agent directly on the command line.
  const openAgentChat = async (agent: Agent): Promise<void> => {
    try {
      capture("agent_chat_opened", { type: agent.type })
      await window.api.openAgentTerminal(agent.name)
    } catch (err: unknown) {
      showToast(
        t("agents.list.toast.error", { message: (err as Error).message }),
        "error",
      )
    }
  }

  return { toggleAgent, removeAgent, disconnectAgent, openWorkspace, openAgentChat }
}
