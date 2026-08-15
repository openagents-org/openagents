import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import { useAgentsStore } from "@renderer/store/agents"
import type { Agent } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

const RUNNING_STATES = ["online", "running", "idle"]

/**
 * Backoff schedules for confirming a state change. The daemon reports the new
 * state asynchronously, so we re-check on a widening interval and stop as soon
 * as it settles rather than waiting a fixed time.
 */
const STOP_WAITS_MS = [400, 800, 1500, 2500, 3000, 3000]
const START_WAITS_MS = [500, 1000, 1500, 2500, 3000, 3000, 3000, 3000, 3000, 3000]

interface AgentActions {
  toggle: (agent: Agent) => Promise<void>
  openTerminal: (agent: Agent) => void
}

export function useAgentActions(
  refresh: () => void,
  showToast: (msg: string, type?: ToastType) => void,
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

  const reportError = (err: unknown): void =>
    showToast(
      t("dashboard.agentToggle.error", { message: (err as Error).message }),
      "error",
    )

  /** Polls agent status until `settled` reports the transition finished. */
  const awaitState = async (
    name: string,
    waits: number[],
    settled: (state: string | undefined) => boolean,
    doneMessage: string,
  ): Promise<void> => {
    for (const wait of waits) {
      await new Promise((r) => setTimeout(r, wait))
      const status = await window.api.agentStatus()
      if (settled(status[name]?.state)) {
        showToast(doneMessage, "success")
        return
      }
      refresh()
    }
  }

  const toggle = async (agent: Agent): Promise<void> => {
    if (pendingAgentActions.has(agent.name)) return
    addPendingAction(agent.name)
    refresh()
    try {
      if (RUNNING_STATES.includes(agent.state)) {
        await window.api.stopAgent(agent.name)
        showToast(t("dashboard.agentToggle.stopping", { name: agent.name }), "info")
        await awaitState(
          agent.name,
          STOP_WAITS_MS,
          (state) => !state || state === "stopped",
          t("dashboard.agentToggle.stopped", { name: agent.name }),
        )
      } else {
        await window.api.startAgent(agent.name)
        showToast(t("dashboard.agentToggle.starting", { name: agent.name }), "info")
        await awaitState(
          agent.name,
          START_WAITS_MS,
          (state) => !!state && ["running", "online"].includes(state),
          t("dashboard.agentToggle.running", { name: agent.name }),
        )
      }
    } catch (err) {
      reportError(err)
    } finally {
      removePendingAction(agent.name)
      refresh()
    }
  }

  return {
    toggle,
    // The in-app chat view is gone — "chat" now means an interactive CLI
    // session in the agent's working folder.
    openTerminal: (agent) => {
      void window.api.openAgentTerminal(agent.name).catch(reportError)
    },
  }
}
