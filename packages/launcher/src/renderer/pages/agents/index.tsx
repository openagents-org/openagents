import React, { useEffect, useRef, useCallback, useState } from "react"
import { useAgentsStore } from "../../store/agents"
import { useUiStore } from "../../store/ui"
import { useShallow } from "zustand/react/shallow"
import { Trans, useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import AgentIcon from "../../components/AgentIcon"
import { ConfirmDialog, StatusDot, displayState } from "../../components/ui-kit"
import {
  Plus,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  KeyRound,
  Terminal,
  FolderOpen,
} from "lucide-react"
import { Button } from "../../components/shadcn/button"
import { Skeleton } from "../../components/shadcn/skeleton"
import { PageHeader } from "../../components/layout/page-header"
import type { Agent, CatalogEntry, EnvField, HealthCheck } from "../../types"
import type { ToastType } from "../../hooks/useToast"
import { cn } from "../../lib/utils"
import { capture } from "../../lib/analytics"
import { workspaceWebBaseUrl } from "../../lib/workspace-urls"
import { randomAgentName } from "../../utils/randomName"
import { NewAgentDialog } from "./components/new-agent-dialog"
import { ConfigureDialog } from "./components/configure-dialog"
import { ConnectWorkspaceDialog } from "./components/connect-workspace-dialog"

export function formatHealthLabel(
  health: HealthCheck | null,
  t: TFunction,
): string {
  if (!health) return t("agents.list.health.notConfigured")
  if (!health.ready) {
    // "Not installed" is reserved for a genuinely missing executable. Decide
    // from the structured reason / installed flag, NOT the free-text message —
    // an installed-but-signed-out agent must read "Login required", never
    // "Not installed" (the bug this guard removes). Stale messages that still
    // say "not installed" on a resolved binary are suppressed defensively.
    const notInstalled =
      health.reason === "not_installed" || health.installed === false
    if (notInstalled) return t("agents.list.health.notInstalled")
    const msg = health.message
    if (msg && !/not\s+installed/i.test(msg)) return msg
    return t("agents.list.health.loginRequired")
  }
  const parts = [t("agents.list.health.ready")]
  if (health.auth_mode === "api_key") parts.push(t("agents.list.health.apiKey"))
  else if (health.auth_mode === "cli_login")
    parts.push(t("agents.list.health.cliLogin"))
  if (health.execution_mode && health.execution_mode !== "unavailable")
    parts.push(health.execution_mode)
  return parts.join(" · ")
}

interface AgentsProps {
  showToast: (msg: string, type?: ToastType) => void
}

const LIST_ITEM =
  "flex flex-col gap-3 px-4 py-4 mb-2.5 bg-(--bg-card) border border-(--border) rounded-(--radius) shadow-sm transition-all duration-200 hover:shadow-md hover:border-(--border-hover)"

function SkeletonListItem(): React.JSX.Element {
  return (
    <div className={LIST_ITEM}>
      <Skeleton className="w-3/5 mb-2.5" />
      <Skeleton className="w-2/5" />
    </div>
  )
}

export default function Agents({ showToast }: AgentsProps): React.JSX.Element {
  const { t } = useTranslation()
  const {
    agents,
    setAgents,
    pendingAgentActions,
    addPendingAction,
    removePendingAction,
  } = useAgentsStore(
    useShallow((s) => ({
      agents: s.agents,
      setAgents: s.setAgents,
      pendingAgentActions: s.pendingAgentActions,
      addPendingAction: s.addPendingAction,
      removePendingAction: s.removePendingAction,
    })),
  )
  const [loading, setLoading] = useState(agents.length === 0)
  const inFlight = useRef(false)
  const queued = useRef(false)
  const mounted = useRef(true)

  const [newAgentOpen, setNewAgentOpen] = useState(false)
  const [configureOpen, setConfigureOpen] = useState(false)
  const [configureAgent, setConfigureAgent] = useState<{
    name: string
    type: string
  } | null>(null)
  const [connectWsOpen, setConnectWsOpen] = useState(false)
  const [connectWsAgent, setConnectWsAgent] = useState<string>("")
  // When a brand-new agent is created we walk the user from Configure straight
  // into Connect Workspace. This flag distinguishes that flow from configuring
  // an existing agent (where closing Configure should not prompt to connect).
  const [connectAfterConfigure, setConnectAfterConfigure] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true
      return
    }
    inFlight.current = true
    try {
      const data = await window.api.listAgents()
      if (!mounted.current) return
      setAgents(data)
      setLoading(false)
    } catch {
    } finally {
      inFlight.current = false
      if (queued.current) {
        queued.current = false
        refresh()
      }
    }
  }, [setAgents])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [refresh])

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
    setRemoveTarget(null)
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
      let url = `${workspaceWebBaseUrl(ws?.endpoint)}/${slug}`
      if (ws && ws.token) url += `?token=${encodeURIComponent(ws.token)}`
      window.api.openExternal(url)
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

  return (
    <section className="flex flex-col h-full">
      <PageHeader
        title={t("agents.list.title")}
        subtitle={t("agents.list.subtitle")}
        actions={
          <Button variant="default" data-testid="new-agent-open" onClick={() => setNewAgentOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            {t("agents.list.newAgent")}
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto px-9 py-6">
        {loading ? (
          <div className="flex flex-col gap-2.5">
            <SkeletonListItem />
            <SkeletonListItem />
            <SkeletonListItem />
          </div>
        ) : agents.length === 0 ? (
          <p className="hint py-5">{t("agents.list.empty")}</p>
        ) : (
          <div>
            {agents.map((agent) => {
              const isRunning = ["online", "running", "idle"].includes(
                agent.state,
              )
              const isPending = pendingAgentActions.has(agent.name)
              const health = agent.health || null
              const readyLabel = formatHealthLabel(health, t)
              const wsDisplay = agent.network
                ? agent.networkName && agent.networkName !== agent.network
                  ? `${agent.network} (${agent.networkName})`
                  : agent.network
                : ""
              const envDisplay: string[] = []
              if (agent.env?.LLM_BASE_URL || agent.env?.OPENAI_BASE_URL)
                envDisplay.push(
                  t("agents.list.apiPrefix", {
                    value: agent.env.LLM_BASE_URL || agent.env.OPENAI_BASE_URL,
                  }),
                )
              if (agent.env?.LLM_MODEL || agent.env?.OPENCLAW_MODEL)
                envDisplay.push(
                  t("agents.list.modelPrefix", {
                    value: agent.env.LLM_MODEL || agent.env.OPENCLAW_MODEL,
                  }),
                )

              return (
                <div
                  key={agent.name}
                  className={LIST_ITEM}
                  data-testid={`agent-row-${agent.name}`}
                  data-state={agent.state}
                  data-network={agent.network || ""}
                >
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 mb-1">
                        <AgentIcon type={agent.type} size={28} />
                        <h4 className="text-sm font-semibold m-0">
                          {agent.name}
                        </h4>
                      </div>
                      <span className="block text-xs text-(--text-secondary) mb-0.5">
                        {agent.type}
                      </span>
                      <span className="block text-2xs text-(--text-tertiary)">
                        {agent.runtimeMismatch ? (
                          <span className="text-(--danger-text)">
                            {t("agents.list.coreUpdateRequired")}
                          </span>
                        ) : health?.ready ? (
                          <>🔑 {readyLabel}</>
                        ) : (
                          <span className="text-(--warning-text)">
                            ⚠ {readyLabel}
                          </span>
                        )}
                        {envDisplay.length > 0 &&
                          " · " + envDisplay.join(" · ")}
                      </span>
                      {agent.lastError && (
                        <span className="block text-2xs text-(--danger-text)">
                          {agent.lastError}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <div className="flex items-center gap-1.5">
                        <StatusDot state={agent.state} />
                        <span className="text-sm font-semibold">
                          {displayState(agent.state)}
                        </span>
                      </div>
                      {wsDisplay ? (
                        <span className="text-2xs text-(--text-secondary)">
                          {wsDisplay}
                        </span>
                      ) : (
                        <span className="text-2xs text-(--text-tertiary)">
                          {t("agents.list.notConnected")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between items-center pt-2.5 border-t border-(--border)">
                    <div className="flex gap-1.5 flex-wrap">
                      <Button
                        size="sm"
                        variant={isRunning ? "outline" : "default"}
                        data-testid={`agent-toggle-${agent.name}`}
                        onClick={() => toggleAgent(agent)}
                        disabled={isPending}
                      >
                        {isPending
                          ? isRunning
                            ? t("agents.list.stopping")
                            : t("agents.list.starting")
                          : isRunning
                            ? t("agents.list.stop")
                            : t("agents.list.start")}
                      </Button>
                      {agent.hasCli && (
                        <Button variant="outline"
                          size="sm"
                          onClick={() => void openAgentChat(agent)}
                        >
                          <Terminal className="w-3.5 h-3.5" />{" "}
                          {t("agents.list.chat")}
                        </Button>
                      )}
                      <Button variant="outline"
                        size="sm"
                        data-testid={`agent-configure-${agent.name}`}
                        onClick={() => {
                          setConfigureAgent({
                            name: agent.name,
                            type: agent.type,
                          })
                          setConfigureOpen(true)
                        }}
                      >
                        {t("agents.list.configure")}
                      </Button>
                      {agent.network ? (
                        <>
                          <Button variant="outline"
                            size="sm"
                            onClick={() => disconnectAgent(agent.name)}
                          >
                            {t("agents.list.disconnect")}
                          </Button>
                          <Button variant="outline"
                            size="sm"
                            onClick={() => openWorkspace(agent)}
                          >
                            {t("agents.list.openWorkspace")}
                          </Button>
                        </>
                      ) : (
                        <Button variant="outline"
                          size="sm"
                          data-testid={`agent-connect-${agent.name}`}
                          onClick={() => {
                            setConnectWsAgent(agent.name)
                            setConnectWsOpen(true)
                          }}
                        >
                          {t("agents.list.connect")}
                        </Button>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setRemoveTarget(agent.name)}
                    >
                      {t("agents.list.remove")}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <NewAgentDialog
        open={newAgentOpen}
        onClose={() => setNewAgentOpen(false)}
        showToast={showToast}
        onCreated={(name, type) => {
          setNewAgentOpen(false)
          refresh()
          setConfigureAgent({ name, type })
          setConfigureOpen(true)
          setConnectAfterConfigure(true)
        }}
      />

      {configureAgent && (
        <ConfigureDialog
          open={configureOpen}
          agentName={configureAgent.name}
          agentType={configureAgent.type}
          onClose={() => {
            setConfigureOpen(false)
            // For a freshly created agent, guide the user to connect it to a
            // workspace. This step is skippable (Cancel) so local-only usage
            // still works.
            if (connectAfterConfigure) {
              setConnectAfterConfigure(false)
              setConnectWsAgent(configureAgent.name)
              setConnectWsOpen(true)
            }
          }}
          showToast={showToast}
          onSaved={refresh}
        />
      )}

      <ConnectWorkspaceDialog
        open={connectWsOpen}
        agentName={connectWsAgent}
        onClose={() => setConnectWsOpen(false)}
        showToast={showToast}
        onConnected={refresh}
      />

      <ConfirmDialog
        open={!!removeTarget}
        icon={
          <AgentIcon
            type={agents.find((a) => a.name === removeTarget)?.type || ""}
            size={40}
          />
        }
        title={t("agents.list.removeTitle", { name: removeTarget })}
        description={
          <Trans
            i18nKey="agents.list.removeBody"
            values={{ name: removeTarget }}
            components={{ 1: <strong className="text-foreground" /> }}
          />
        }
        confirmLabel={t("agents.list.remove")}
        cancelLabel={t("agents.list.cancel")}
        onConfirm={() => {
          if (removeTarget) removeAgent(removeTarget)
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </section>
  )
}
