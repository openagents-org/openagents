import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"

import { useAccountStore } from "@renderer/store/account"
import { useAgentsStore } from "@renderer/store/agents"
import { useLocalConnectorStore } from "@renderer/store/local-connector"
import { capture } from "@renderer/lib/analytics"
import { inAppBlocker, opensInApp, workspacePageUrl, workspaceWebBaseUrl } from "@renderer/lib/workspace-urls"
import type { Agent, Workspace } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

type ShowToast = (msg: string, type?: ToastType) => void

export interface AgentActions {
  toggleAgent: (agent: Agent) => Promise<void>
  removeAgent: (
    name: string,
    opts?: { fromWorkspace?: boolean },
  ) => Promise<void>
  renameAgent: (name: string, displayName: string) => Promise<void>
  disconnectAgent: (name: string) => Promise<void>
  /** `importSessions`: once there, offer bringing in its tool's past sessions. */
  openWorkspace: (agent: Agent, opts?: { importSessions?: boolean }) => Promise<void>
  openWorkspaceInBrowser: (agent: Agent) => Promise<void>
  openAgentChat: (agent: Agent) => Promise<void>
}

/**
 * Start/stop, remove, connect and terminal actions for the agents list. Split
 * out of the page so the view stays readable — the start/stop paths carry the
 * bulk of the code here (they poll the daemon until the state actually flips
 * rather than trusting the command's return).
 */
/**
 * An agent's workspace page for the browser, tokenless: on the deployment its
 * record names, else the configured one (self-hosting), and by the name the
 * agent was bound with when this device has no record of the workspace.
 */
function agentWorkspacePage(network: string, ws: Workspace | undefined, configured: string | undefined, importAgent?: string): string {
  const page = ws ? workspacePageUrl(ws, configured) : `${workspaceWebBaseUrl(configured)}/${network}`
  if (!importAgent) return page
  // The workspace opens "Import past sessions" for it (ImportSessionsHost).
  try {
    const url = new URL(page)
    url.searchParams.set("import", importAgent)
    return url.toString()
  } catch {
    return page
  }
}

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
        // Fast initial polls — the daemon picks commands up within ~200ms and
        // writes the stopped state straight away, so a tight first second
        // catches the flip; the tail covers an adapter slow to let go.
        const stopWaits = [250, 250, 300, 400, 500, 750, 1000, 1500, 2000, 3000]
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
        // Off, the connector is asked for first: turning it on starts them all.
        if (!(await useLocalConnectorStore.getState().ensureOn())) return
        capture("agent_started", {
          agent_name: agent.name,
          agent_type: agent.type,
        })
        await window.api.startAgent(agent.name)
        showToast(
          t("agents.list.toast.startingAgent", { name: agent.name }),
          "info",
        )
        // Same shape as stop: most agents report running within a second or
        // two, and the old 500/1000/1500 steps alone added up to 3s of waiting
        // on top of that.
        const startWaits = [
          300, 300, 400, 500, 500, 750, 1000, 1000, 1500, 2000, 3000, 3000,
          3000, 3000, 3000,
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

  const removeAgent = async (
    name: string,
    opts?: { fromWorkspace?: boolean },
  ): Promise<void> => {
    onRemoved?.()
    try {
      await window.api.removeAgent(name, opts)
      showToast(
        t(
          opts?.fromWorkspace
            ? "agents.list.toast.removedEverywhere"
            : "agents.list.toast.removed",
          { name },
        ),
        "success",
      )
      refresh()
    } catch (err: unknown) {
      showToast(
        t("agents.list.toast.error", { message: (err as Error).message }),
        "error",
      )
      // The workspace half runs first and the agent is still here when it
      // fails, so the list has to come back rather than stay as the dialog
      // left it.
      refresh()
    }
  }

  /**
   * Rename = set a display label. The agent's `name` is its identity and never
   * changes, so nothing that addresses it (sessions, working dir, workspace
   * membership) is disturbed.
   */
  const renameAgent = async (
    name: string,
    displayName: string,
  ): Promise<void> => {
    try {
      await window.api.renameAgent(name, displayName)
      showToast(t("agents.list.toast.renamed"), "success")
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

  const openWorkspace = async (agent: Agent, opts?: { importSessions?: boolean }): Promise<void> => {
    const importAgent = opts?.importSessions ? agent.name : undefined
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
          if (!(await useLocalConnectorStore.getState().ensureOn())) return
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
      const signedIn = !!useAccountStore.getState().account
      const [workspaces, endpoint, memberOf] = await Promise.all([
        window.api.listWorkspaces(),
        window.api.getSetting("workspaceEndpoint").catch(() => undefined),
        // Only a workspace the account already belongs to opens in the app —
        // see opensInApp. A failed lookup opens the browser instead.
        signedIn ? window.api.listAccountWorkspaces().catch(() => null) : Promise.resolve(null),
      ])
      const ws = workspaces.find(
        (w) => w.slug === agent.network || w.id === agent.network,
      )
      const slug = (ws && ws.slug) || agent.network
      // Signed in, and the workspace is on the deployment the app's own
      // Workspace talks to: open it there, as Connected Workspaces does,
      // instead of sending the user out to a browser tab.
      const configured = typeof endpoint === "string" && endpoint ? endpoint : undefined
      if (ws && opensInApp(ws, configured, signedIn, memberOf)) {
        useAccountStore.getState().openWorkspace({ slug, name: ws.name, token: ws.token ?? null, importAgent: importAgent ?? null })
        return
      }
      // Signed in, yet sent to the browser: say why, or it looks like the
      // in-app open simply broke for this one workspace.
      if (ws && inAppBlocker(ws, configured, signedIn, memberOf) === "notMember") {
        showToast(
          t("agents.list.toast.openedInBrowserNotMember", {
            workspace: agent.networkName || ws.name || slug,
          }),
          "info",
        )
      }
      window.api.openExternal(agentWorkspacePage(agent.network, ws, configured, importAgent))
    } catch (err: unknown) {
      showToast(
        t("agents.list.toast.error", { message: (err as Error).message }),
        "error",
      )
    }
  }

  // The same workspace in the system browser, whatever the app would do: on
  // the deployment the agent is bound to, signed in by the browser's session.
  const openWorkspaceInBrowser = async (agent: Agent): Promise<void> => {
    if (!agent.network) {
      showToast(
        t("agents.list.toast.notConnectedYet", { name: agent.name }),
        "warning",
      )
      return
    }
    try {
      const [workspaces, endpoint] = await Promise.all([
        window.api.listWorkspaces(),
        window.api.getSetting("workspaceEndpoint").catch(() => undefined),
      ])
      const ws = workspaces.find(
        (w) => w.slug === agent.network || w.id === agent.network,
      )
      const configured = typeof endpoint === "string" && endpoint ? endpoint : undefined
      window.api.openExternal(agentWorkspacePage(agent.network, ws, configured))
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

  return {
    toggleAgent,
    removeAgent,
    renameAgent,
    disconnectAgent,
    openWorkspace,
    openWorkspaceInBrowser,
    openAgentChat,
  }
}
