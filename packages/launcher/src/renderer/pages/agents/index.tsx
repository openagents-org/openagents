import React, { useEffect, useRef, useCallback, useState } from "react"
import { useAgentsStore } from "../../store/agents"
import { useUiStore } from "../../store/ui"
import { useShallow } from "zustand/react/shallow"
import { Trans, useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import AgentIcon from "../../components/AgentIcon"
import StatusDot, { displayState } from "../../components/ui/StatusDot"
import {
  Plus,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  KeyRound,
  Terminal,
  FolderOpen,
} from "lucide-react"
import { Button } from "../../components/ui/Button"
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "../../components/ui/Modal"
import { PasswordInput } from "../../components/ui/PasswordInput"
import { TopBar } from "../../components/TopBar"
import type { Agent, CatalogEntry, EnvField, HealthCheck } from "../../types"
import type { ToastType } from "../../hooks/useToast"
import { cn } from "../../lib/utils"
import { capture } from "../../lib/analytics"
import { workspaceWebBaseUrl } from "../../lib/workspace-urls"
import { randomAgentName } from "../../utils/randomName"

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
  "flex flex-col gap-3 px-[18px] py-4 mb-2.5 bg-(--bg-card) border border-(--border) rounded-(--radius) shadow-sm transition-all duration-200 hover:shadow-md hover:border-(--border-hover)"

function SkeletonListItem(): React.JSX.Element {
  return (
    <div className={LIST_ITEM}>
      <div className="skeleton-shimmer rounded-full h-2.5 w-[62%] mb-2.5" />
      <div className="skeleton-shimmer rounded-full h-2.5 w-[42%]" />
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
      <TopBar
        title={t("agents.list.title")}
        subtitle={t("agents.list.subtitle")}
        actions={
          <Button variant="primary" data-testid="new-agent-open" onClick={() => setNewAgentOpen(true)}>
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
                      <span className="block text-[11px] text-(--text-tertiary)">
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
                        <span className="block text-[11px] text-(--danger-text)">
                          {agent.lastError}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <div className="flex items-center gap-1.5">
                        <StatusDot state={agent.state} />
                        <span className="text-[13px] font-semibold">
                          {displayState(agent.state)}
                        </span>
                      </div>
                      {wsDisplay ? (
                        <span className="text-[11px] text-(--text-secondary)">
                          {wsDisplay}
                        </span>
                      ) : (
                        <span className="text-[11px] text-(--text-tertiary)">
                          {t("agents.list.notConnected")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between items-center pt-2.5 border-t border-(--border)">
                    <div className="flex gap-1.5 flex-wrap">
                      <Button
                        size="sm"
                        variant={isRunning ? "default" : "primary"}
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
                        <Button
                          size="sm"
                          onClick={() => void openAgentChat(agent)}
                        >
                          <Terminal className="w-3.5 h-3.5" />{" "}
                          {t("agents.list.chat")}
                        </Button>
                      )}
                      <Button
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
                          <Button
                            size="sm"
                            onClick={() => disconnectAgent(agent.name)}
                          >
                            {t("agents.list.disconnect")}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => openWorkspace(agent)}
                          >
                            {t("agents.list.openWorkspace")}
                          </Button>
                        </>
                      ) : (
                        <Button
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

      <Modal open={!!removeTarget} onClose={() => setRemoveTarget(null)}>
        <div className="flex flex-col items-center py-2">
          <AgentIcon
            type={agents.find((a) => a.name === removeTarget)?.type || ""}
            size={40}
          />
          <ModalTitle className="mt-3 text-center">
            {t("agents.list.removeTitle", { name: removeTarget })}
          </ModalTitle>
          <p className="hint mt-3 mb-5 text-center">
            <Trans
              i18nKey="agents.list.removeBody"
              values={{ name: removeTarget }}
              components={{ 1: <strong /> }}
            />
          </p>
          <div className="form-actions justify-center mt-0">
            <Button
              variant="destructive"
              onClick={() => {
                if (removeTarget) removeAgent(removeTarget)
              }}
            >
              {t("agents.list.remove")}
            </Button>
            <Button onClick={() => setRemoveTarget(null)}>
              {t("agents.list.cancel")}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  )
}

function NewAgentDialog({
  open,
  onClose,
  showToast,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  showToast: (msg: string, type?: ToastType) => void
  onCreated: (name: string, type: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [supportedTypes, setSupportedTypes] = useState<string[]>([])
  const [selectedType, setSelectedType] = useState("")
  const [agentName, setAgentName] = useState("")
  const [agentPath, setAgentPath] = useState("")
  // Once the user browses/edits the folder, stop auto-syncing it to the name.
  const [folderTouched, setFolderTouched] = useState(false)
  const [homeDir, setHomeDir] = useState("")
  const [loading, setLoading] = useState(false)
  const setCurrentTab = useUiStore.getState().setCurrentTab

  // Default the working folder to the user's home directory — a sensible,
  // easy-to-find root the user can then narrow to a specific project.
  const defaultFolderFor = useCallback((): string => homeDir, [homeDir])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    window.api
      .listPaths()
      .then((p) => setHomeDir(p?.home || ""))
      .catch(() => {})
    Promise.all([window.api.getCatalog(), window.api.getSupportedAgentTypes()])
      .then(([cat, types]) => {
        setCatalog(cat)
        setSupportedTypes(types || [])
        const supportedSet = new Set(types || [])
        const installed = cat.filter(
          (c) => c.installed && supportedSet.has(c.name),
        )
        if (installed.length > 0) setSelectedType(installed[0].name)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [open])

  // Seed a friendly random name once when the dialog opens. We deliberately
  // do NOT regenerate on every type change — that would clobber a name the
  // user has already edited. The name is independent of the agent type.
  useEffect(() => {
    if (open) setAgentName(randomAgentName())
  }, [open])

  // Prefill the folder with the default until the user picks/edits their own.
  useEffect(() => {
    if (folderTouched) return
    const def = defaultFolderFor()
    if (def && def !== agentPath) setAgentPath(def)
  }, [folderTouched, defaultFolderFor, agentPath])

  const browseFolder = async (): Promise<void> => {
    try {
      const picked = await window.api.selectDirectory(
        agentPath || homeDir || undefined,
      )
      if (picked) {
        setFolderTouched(true)
        setAgentPath(picked)
      }
    } catch (err: unknown) {
      showToast((err as Error).message, "error")
    }
  }

  const supportedSet = new Set(supportedTypes)
  const supportedInstalled = catalog.filter(
    (c) => c.installed && supportedSet.has(c.name),
  )

  const doCreate = async (): Promise<void> => {
    const name = agentName.trim() || randomAgentName()
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      showToast(t("agents.newDialog.toast.invalidName"), "warning")
      return
    }
    if (!agentPath.trim()) {
      showToast(t("agents.newDialog.toast.selectFolder"), "warning")
      return
    }
    try {
      await window.api.addAgent({
        name,
        type: selectedType,
        path: agentPath.trim(),
      })
      showToast(t("agents.newDialog.toast.created", { name }), "success")
      onCreated(name, selectedType)
    } catch (err: unknown) {
      showToast(
        t("agents.newDialog.toast.error", { message: (err as Error).message }),
        "error",
      )
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalTitle>{t("agents.newDialog.title")}</ModalTitle>
      {loading ? (
        <p className="loading-text">{t("agents.newDialog.loadingTypes")}</p>
      ) : supportedInstalled.length === 0 ? (
        <>
          <p className="hint">{t("agents.newDialog.noRuntimes")}</p>
          <div className="form-actions">
            <Button
              variant="primary"
              onClick={() => {
                onClose()
                setCurrentTab("install")
              }}
            >
              {t("agents.newDialog.goToInstall")}
            </Button>
            <Button onClick={onClose}>{t("agents.newDialog.cancel")}</Button>
          </div>
        </>
      ) : (
        <>
          <div className="form-group">
            <label htmlFor="agent-type">
              {t("agents.newDialog.agentType")}
            </label>
            <select
              id="agent-type"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
            >
              {supportedInstalled.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.label || c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="agent-name">
              {t("agents.newDialog.agentName")}
            </label>
            <input
              id="agent-name"
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="swift-lynx-37"
            />
          </div>
          <div className="form-group">
            <label htmlFor="agent-working-directory">
              {t("agents.newDialog.workingDirectory")}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="agent-working-directory"
                type="text"
                className="flex-1"
                value={agentPath}
                onChange={(e) => {
                  setFolderTouched(true)
                  setAgentPath(e.target.value)
                }}
                placeholder={t("agents.newDialog.workingDirectoryPlaceholder")}
              />
              <Button onClick={() => void browseFolder()}>
                {t("agents.newDialog.browse")}
              </Button>
            </div>
          </div>
          <div className="form-actions">
            <Button variant="primary" data-testid="new-agent-create" onClick={doCreate}>
              {t("agents.newDialog.create")}
            </Button>
            <Button onClick={onClose}>{t("agents.newDialog.cancel")}</Button>
          </div>
        </>
      )}
    </Modal>
  )
}

function ConfigureDialog({
  open,
  agentName,
  agentType,
  onClose,
  showToast,
  onSaved,
}: {
  open: boolean
  agentName: string
  agentType: string
  onClose: () => void
  showToast: (msg: string, type?: ToastType) => void
  onSaved: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [fields, setFields] = useState<EnvField[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [loginCmd, setLoginCmd] = useState<string | null>(null)
  // Real sign-in state from an actual status probe: true / false / null (not yet
  // checked). Never an optimistic guess — the badge only shows what we verified.
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  // Drives the manual login flow: idle (show status + Login) → awaiting (terminal
  // opened, ask the user to confirm) → checking (re-reading status after confirm).
  const [loginPhase, setLoginPhase] = useState<
    "idle" | "awaiting" | "checking"
  >("idle")
  const [noConfig, setNoConfig] = useState(false)
  // Auth readiness for agents whose sign-in the core can probe (e.g. Gemini's
  // OAuth creds file). Drives an opt-in banner that distinguishes a Google
  // account sign-in from an API key, or shows login guidance when neither is
  // present — so Gemini is never demanded an API key it doesn't need.
  const [authInfo, setAuthInfo] = useState<{
    ready: boolean
    authMode: string | null
    message: string | null
  } | null>(null)
  // Registry-supplied, non-sensitive labels per auth_mode
  // (check_ready.auth_detected_labels). Presence is the opt-in gate: the banner
  // only renders for agents that declare these (today: Gemini).
  const [authLabels, setAuthLabels] = useState<Record<string, string> | null>(
    null,
  )
  const [loading, setLoading] = useState(true)
  // Only tracks the in-flight state so the button can show "Testing…"; the
  // actual result is surfaced via a toast, not inline in the dialog.
  const [testStatus, setTestStatus] = useState<"idle" | "loading">("idle")
  // Working directory (spawn cwd) of this agent instance. Only meaningful for
  // an existing agent (agentName set); the type-level config has no cwd.
  const [workDir, setWorkDir] = useState("")
  const [workDirInitial, setWorkDirInitial] = useState("")
  const [workDirSaving, setWorkDirSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setTestStatus("idle")
    setNoConfig(false)
    setLoginCmd(null)
    setLoggedIn(null)
    setLoginPhase("idle")
    setAuthInfo(null)
    setAuthLabels(null)
    // Reset fields/values too: the dialog stays mounted across agents, and
    // getEnvFields returns [] for login-only agents (Cursor/Hermes) so the
    // `if (hasFields)` branch below never calls setFields for them. Without
    // this reset they'd inherit the previously-configured agent's key fields
    // (e.g. Claude's ANTHROPIC_API_KEY), making the render condition
    // `loginCmd && fields.length === 0` false and wrongly showing an API-key
    // form for an agent that only signs in via its CLI.
    setFields([])
    setValues({})
    Promise.all([
      window.api.getEnvFields(agentType),
      window.api.getAgentEnv(agentType),
      agentName
        ? window.api.getAgentInstanceEnv(agentName)
        : Promise.resolve({} as Record<string, string>),
    ])
      .then(([f, typeEnv, instanceEnv]) => {
        const hasFields = !!f && f.length > 0
        if (hasFields) {
          setFields(f)
          const merged = { ...(typeEnv || {}), ...(instanceEnv || {}) }
          const initial: Record<string, string> = {}
          f.forEach((field) => {
            initial[field.name] = merged[field.name] || field.default || ""
          })
          setValues(initial)
        }
        // Always resolve a CLI login command. Hosted agents (Cursor/Hermes) have
        // ONLY a login; dual-auth agents (Claude) have BOTH env fields AND a
        // login — so this must run regardless of whether env fields exist, or
        // Claude's Configure dialog would only ever show the API-key form.
        window.api.getCatalog().then((catalog) => {
          const entry = catalog.find((c) => c.name === agentType)
          const cmd = entry?.check_ready?.login_command || null
          // Opt-in auth banner: only agents that declare per-mode labels
          // (e.g. Gemini) get the "Google account sign-in detected" / "API key
          // detected" / login-guidance banner. Others are untouched.
          const labels = entry?.check_ready?.auth_detected_labels || null
          setAuthLabels(labels && Object.keys(labels).length ? labels : null)
          if (cmd) {
            setLoginCmd(cmd)
            // Read the REAL sign-in state once on open (a fresh probe), so the
            // badge reflects reality instead of an optimistic guess.
            window.api
              .refreshLogin(agentType)
              .then((h) => {
                // For dual-auth agents `logged_in` reflects the CLI sign-in
                // specifically (`ready` can be true from an API key alone), so
                // prefer it; fall back to `ready` for pure login agents.
                const ok = h?.logged_in ?? h?.ready ?? false
                setLoggedIn(ok)
                setAuthInfo({
                  ready: !!h?.ready,
                  authMode: (h?.auth_mode as string) ?? null,
                  message: (h?.message as string) ?? null,
                })
                // Already signed in via the browser session? Then any saved
                // CURSOR_API_KEY/MODEL is stale leftover that conflicts with
                // the login (and was breaking the workspace chat). Drop it
                // once — clearLoginKey is a no-op when nothing's set, and a
                // no-op for Claude/Gemini (they declare no keys to clear, so the
                // API key is never wiped).
                if (ok)
                  window.api.clearLoginKey(agentType, agentName || undefined)
              })
              .catch(() => {
                setLoggedIn(false)
                setAuthInfo(null)
              })
          } else if (!hasFields) {
            setNoConfig(true)
          }
        })
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [open, agentName, agentType])

  // User-confirmed login check. The browser/terminal login has no completion
  // callback, so rather than guess, we ask the user to confirm they finished —
  // THEN read the real status. For Cursor we also clear any stale API key first,
  // because the CLI prefers an explicit (here: invalid) key over its login
  // session, which is what made the workspace chat fail with "API key invalid".
  const confirmLogin = async (): Promise<void> => {
    setLoginPhase("checking")
    try {
      await window.api.clearLoginKey(agentType, agentName || undefined)
      const h = await window.api.refreshLogin(agentType)
      const ok = !!h?.ready
      setLoggedIn(ok)
      setAuthInfo({
        ready: ok,
        authMode: (h?.auth_mode as string) ?? null,
        message: (h?.message as string) ?? null,
      })
      onSaved()
      showToast(
        ok
          ? t("agents.configureDialog.toast.signedInReady")
          : t("agents.configureDialog.toast.couldntConfirm"),
        ok ? "success" : "warning",
      )
    } catch {
      setLoggedIn(false)
      showToast(t("agents.configureDialog.toast.couldntReadStatus"), "error")
    } finally {
      setLoginPhase("idle")
    }
  }

  // Load the agent's current working directory whenever the dialog opens for
  // an existing instance. listAgents carries the per-agent `path` straight
  // from daemon.yaml, so no extra IPC is needed.
  useEffect(() => {
    if (!open || !agentName) {
      setWorkDir("")
      setWorkDirInitial("")
      return
    }
    let cancelled = false
    window.api
      .listAgents()
      .then((list) => {
        if (cancelled) return
        const a = list.find((x) => x.name === agentName)
        const p = a?.path || ""
        setWorkDir(p)
        setWorkDirInitial(p)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, agentName])

  const browseWorkDir = async (): Promise<void> => {
    try {
      const picked = await window.api.selectDirectory(workDir || undefined)
      if (picked) setWorkDir(picked)
    } catch (err: unknown) {
      showToast((err as Error).message, "error")
    }
  }

  const saveWorkDir = async (): Promise<void> => {
    const p = workDir.trim()
    if (!p) {
      showToast(t("agents.configureDialog.workdir.toast.required"), "warning")
      return
    }
    setWorkDirSaving(true)
    try {
      await window.api.setAgentWorkingDir(agentName, p)
      setWorkDirInitial(p)
      showToast(
        t("agents.configureDialog.workdir.toast.saved", { path: p }),
        "success",
      )
      onSaved()
    } catch (err: unknown) {
      showToast(
        t("agents.configureDialog.workdir.toast.error", {
          message: (err as Error).message,
        }),
        "error",
      )
    } finally {
      setWorkDirSaving(false)
    }
  }

  const save = async (): Promise<void> => {
    const missing = fields.find(
      (f) => f.required && !(values[f.name] || "").trim(),
    )
    if (missing) {
      showToast(
        t("agents.configureDialog.fieldRequired", {
          field: missing.description || missing.name,
        }),
        "warning",
      )
      return
    }
    try {
      if (agentName) {
        await window.api.saveAgentInstanceEnv(agentName, values)
      } else {
        await window.api.saveAgentEnv(agentType, values)
      }
      showToast(t("agents.configureDialog.toast.configurationSaved"), "success")
      onSaved()
      onClose()
    } catch (err: unknown) {
      showToast(
        t("agents.configureDialog.toast.errorSaving", {
          message: (err as Error).message,
        }),
        "error",
      )
    }
  }

  const testConnection = async (): Promise<void> => {
    setTestStatus("loading")
    try {
      const result = await window.api.testLLM(values)
      capture("llm_test_run", {
        success: result.success,
        model: result.model || null,
      })
      if (result.success) {
        showToast(
          t("agents.configureDialog.test.okResult", {
            model: result.model,
            response: result.response,
          }),
          "success",
        )
      } else {
        showToast(
          result.error || t("agents.configureDialog.test.unknownError"),
          "error",
        )
      }
    } catch (err: unknown) {
      showToast((err as Error).message, "error")
    } finally {
      setTestStatus("idle")
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      layout="panel"
      className="min-w-140! max-w-170!"
    >
      <ModalHeader className="pt-3 pb-1">
        <ModalTitle className="mb-1.5">
          {t("agents.configureDialog.title", { name: agentName || agentType })}
        </ModalTitle>
        {!loading && !noConfig && loginCmd && fields.length === 0 && (
          <p className="hint m-0">
            {t("agents.configureDialog.hintLoginOnly")} <code>{loginCmd}</code>
            {t("agents.configureDialog.hintLoginOnlySuffix")}
          </p>
        )}
        {!loading && !noConfig && !(loginCmd && fields.length === 0) && (
          <p className="hint m-0">
            {agentName
              ? t("agents.configureDialog.hintInstance")
              : t("agents.configureDialog.hintType")}
          </p>
        )}
        {!loading && noConfig && (
          <p className="hint m-0">{t("agents.configureDialog.hintNoConfig")}</p>
        )}
      </ModalHeader>

      <ModalBody>
        {!loading && agentName && (
          <div className="form-group mb-0!">
            <label
              htmlFor="agent-config-workdir"
              className="flex items-center gap-1.5"
            >
              {t("agents.configureDialog.workdir.label")}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="agent-config-workdir"
                type="text"
                className="flex-1"
                value={workDir}
                onChange={(e) => setWorkDir(e.target.value)}
                placeholder={t("agents.configureDialog.workdir.placeholder")}
              />
              <Button onClick={() => void browseWorkDir()}>
                {t("agents.configureDialog.workdir.browse")}
              </Button>
              <Button
                variant="primary"
                disabled={
                  workDirSaving ||
                  !workDir.trim() ||
                  workDir.trim() === workDirInitial
                }
                onClick={() => void saveWorkDir()}
              >
                {workDirSaving
                  ? t("agents.configureDialog.workdir.saving")
                  : t("agents.configureDialog.workdir.save")}
              </Button>
            </div>
            <p className="hint mt-1 mb-0">
              {t("agents.configureDialog.workdir.hint")}
            </p>
          </div>
        )}
        {loading ? (
          <p className="loading-text m-0">
            {t("agents.configureDialog.loadingConfig")}
          </p>
        ) : noConfig ? null : loginCmd && fields.length === 0 ? (
          <>
            <AuthStatusBanner authInfo={authInfo} authLabels={authLabels} />
            <LoginStatusCard loginPhase={loginPhase} loggedIn={loggedIn} />
            {loginPhase === "awaiting" && (
              <p className="hint m-0">
                {t("agents.configureDialog.awaitingTerminalPrefix")}{" "}
                <code>{loginCmd}</code>
                {t("agents.configureDialog.awaitingTerminalSuffix")}
              </p>
            )}
          </>
        ) : (
          <>
            <AuthStatusBanner authInfo={authInfo} authLabels={authLabels} />
            {loginCmd && (
              <>
                <CliLoginBlock
                  loginCmd={loginCmd}
                  loginPhase={loginPhase}
                  loggedIn={loggedIn}
                  onOpenTerminal={async () => {
                    try {
                      await window.api.openTerminal(loginCmd)
                      setLoginPhase("awaiting")
                    } catch (err: unknown) {
                      showToast(
                        t("agents.configureDialog.toast.failedOpenTerminal", {
                          message: (err as Error).message,
                        }),
                        "error",
                      )
                    }
                  }}
                  onConfirmLogin={confirmLogin}
                  onCancelAwaiting={() => setLoginPhase("idle")}
                />
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-(--text-tertiary)">
                  <span className="h-px flex-1 bg-(--border)" />
                  <KeyRound className="h-3 w-3" />
                  <span>{t("agents.configureDialog.orUseApiKey")}</span>
                  <span className="h-px flex-1 bg-(--border)" />
                </div>
              </>
            )}
            <div>
              {fields.map((f) => (
                <div key={f.name} className="form-group mb-0">
                  <label htmlFor={`agent-config-${f.name}`}>
                    {f.description}
                    {f.required && <span className="required"> *</span>}
                  </label>
                  {f.password ? (
                    <PasswordInput
                      id={`agent-config-${f.name}`}
                      value={values[f.name] || ""}
                      onChange={(e) =>
                        setValues((prev) => ({
                          ...prev,
                          [f.name]: e.target.value,
                        }))
                      }
                      placeholder={
                        f.placeholder ||
                        t("agents.configureDialog.enterField", { name: f.name })
                      }
                    />
                  ) : (
                    <input
                      id={`agent-config-${f.name}`}
                      type="text"
                      value={values[f.name] || ""}
                      onChange={(e) =>
                        setValues((prev) => ({
                          ...prev,
                          [f.name]: e.target.value,
                        }))
                      }
                      placeholder={
                        f.placeholder ||
                        t("agents.configureDialog.enterField", { name: f.name })
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </ModalBody>

      {!loading && (
        <ModalFooter>
          {noConfig ? (
            <div className="form-actions mt-0">
              <Button onClick={onClose}>
                {t("agents.configureDialog.close")}
              </Button>
            </div>
          ) : loginCmd && fields.length === 0 ? (
            loginPhase === "awaiting" ? (
              <div className="form-actions mt-0">
                <Button variant="primary" onClick={confirmLogin}>
                  {t("agents.configureDialog.finishedSigningIn")}
                </Button>
                <Button onClick={() => setLoginPhase("idle")}>
                  {t("agents.configureDialog.notYet")}
                </Button>
              </div>
            ) : (
              <div className="form-actions mt-0">
                <Button
                  variant="primary"
                  disabled={loginPhase === "checking"}
                  onClick={async () => {
                    try {
                      await window.api.openTerminal(loginCmd)
                      setLoginPhase("awaiting")
                    } catch (err: unknown) {
                      showToast(
                        t("agents.configureDialog.toast.failedOpenTerminal", {
                          message: (err as Error).message,
                        }),
                        "error",
                      )
                    }
                  }}
                >
                  {loggedIn
                    ? t("agents.configureDialog.reLogin")
                    : t("agents.configureDialog.login")}
                </Button>
                <Button onClick={onClose}>
                  {t("agents.configureDialog.close")}
                </Button>
              </div>
            )
          ) : (
            <div className="form-actions mt-0">
              <Button variant="primary" data-testid="cfg-save" onClick={save}>
                {t("agents.configureDialog.save")}
              </Button>
              <Button
                onClick={testConnection}
                disabled={testStatus === "loading"}
              >
                {testStatus === "loading"
                  ? t("agents.configureDialog.testing")
                  : t("agents.configureDialog.testConnection")}
              </Button>
              <Button onClick={onClose}>
                {t("agents.configureDialog.cancel")}
              </Button>
            </div>
          )}
        </ModalFooter>
      )}
    </Modal>
  )
}

/**
 * Opt-in auth-readiness banner for agents whose sign-in the core can probe
 * (today: Gemini). Renders ONLY when the agent declares per-mode labels in
 * check_ready.auth_detected_labels — so no other agent's Configure dialog is
 * affected. When ready it names the detected method (Google account sign-in vs
 * API key) so a logged-in user is never asked for a key; when not ready it
 * surfaces the core's non-sensitive guidance message. Never shows a token,
 * email, or path.
 */
function AuthStatusBanner({
  authInfo,
  authLabels,
}: {
  authInfo: {
    ready: boolean
    authMode: string | null
    message: string | null
  } | null
  authLabels: Record<string, string> | null
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!authLabels || !authInfo) return null
  if (authInfo.ready) {
    const detected =
      (authInfo.authMode && authLabels[authInfo.authMode]) ||
      t("agents.configureDialog.authReadyGeneric")
    return (
      <div className="flex items-center gap-2 p-3 rounded-(--radius) bg-(--bg-input) text-[13px] text-(--success-text)">
        <CheckCircle2 className="w-4 h-4 shrink-0" strokeWidth={2} />
        <span>
          {t("agents.configureDialog.authReadyPrefix")} {detected}
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2 p-3 rounded-(--radius) bg-(--bg-input) text-[13px] text-(--warning-text)">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={2} />
      <span>
        {authInfo.message || t("agents.configureDialog.authNotReadyGeneric")}
      </span>
    </div>
  )
}

function LoginStatusRow({
  loginPhase,
  loggedIn,
}: {
  loginPhase: "idle" | "awaiting" | "checking"
  loggedIn: boolean | null
}): React.JSX.Element {
  const { t } = useTranslation()
  if (loginPhase === "checking" || loggedIn === null) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-(--text-secondary)">
        <Loader2 className="w-4 h-4 shrink-0 animate-spin" strokeWidth={2} />
        <span>{t("agents.loginStatus.checking")}</span>
      </div>
    )
  }
  if (loggedIn) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-(--success-text)">
        <CheckCircle2 className="w-4 h-4 shrink-0" strokeWidth={2} />
        <span>{t("agents.loginStatus.signedIn")}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 text-[13px] text-(--warning-text)">
      <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={2} />
      <span>{t("agents.loginStatus.notSignedIn")}</span>
    </div>
  )
}

function LoginStatusCard({
  loginPhase,
  loggedIn,
}: {
  loginPhase: "idle" | "awaiting" | "checking"
  loggedIn: boolean | null
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 p-3 rounded-(--radius) bg-(--bg-input)">
      {loginPhase === "checking" || loggedIn === null ? (
        <>
          <Loader2
            className="w-5 h-5 shrink-0 text-(--text-tertiary) animate-spin"
            strokeWidth={2}
          />
          <strong className="text-[13px]">
            {t("agents.loginStatus.checking")}
          </strong>
        </>
      ) : loggedIn ? (
        <>
          <CheckCircle2
            className="w-5 h-5 shrink-0 text-(--success-text)"
            strokeWidth={2}
          />
          <strong className="text-[13px]">
            {t("agents.loginStatus.signedIn")}
          </strong>
        </>
      ) : (
        <>
          <AlertTriangle
            className="w-5 h-5 shrink-0 text-(--warning-text)"
            strokeWidth={2}
          />
          <strong className="text-[13px]">
            {t("agents.loginStatus.notSignedIn")}
          </strong>
        </>
      )}
    </div>
  )
}

function CliLoginBlock({
  loginCmd,
  loginPhase,
  loggedIn,
  onOpenTerminal,
  onConfirmLogin,
  onCancelAwaiting,
}: {
  loginCmd: string
  loginPhase: "idle" | "awaiting" | "checking"
  loggedIn: boolean | null
  onOpenTerminal: () => void | Promise<void>
  onConfirmLogin: () => void | Promise<void>
  onCancelAwaiting: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="rounded-sm border border-(--accent)/35 bg-(--accent-bg)/60 px-3.5 py-3">
      <div className="flex items-start gap-2.5 mb-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--accent)/15 text-(--accent)">
          <Terminal className="h-4 w-4" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[13px] font-semibold text-(--text-primary)">
            {t("agents.loginStatus.signInWithCli")}
          </p>
          <p className="hint m-0 mt-1 mb-0 leading-snug">
            {t("agents.loginStatus.opensTerminalPrefix")}{" "}
            <code>{loginCmd}</code>{" "}
            {t("agents.loginStatus.opensTerminalSuffix")}
          </p>
        </div>
      </div>
      <div className="mb-3">
        <LoginStatusRow loginPhase={loginPhase} loggedIn={loggedIn} />
      </div>
      {loginPhase === "awaiting" ? (
        <>
          <p className="hint m-0 mb-3">
            {t("agents.loginStatus.finishThenConfirm")}
          </p>
          <div className="form-actions mt-0 flex-wrap">
            <Button variant="primary" onClick={onConfirmLogin}>
              {t("agents.loginStatus.finishedSigningIn")}
            </Button>
            <Button onClick={onCancelAwaiting}>
              {t("agents.loginStatus.notYet")}
            </Button>
          </div>
        </>
      ) : (
        <div className="form-actions mt-0">
          <Button
            variant="primary"
            disabled={loginPhase === "checking"}
            onClick={onOpenTerminal}
          >
            {loggedIn
              ? t("agents.loginStatus.reLogin")
              : t("agents.loginStatus.signIn")}
          </Button>
        </div>
      )}
    </div>
  )
}

function ConnectWorkspaceDialog({
  open,
  agentName,
  onClose,
  showToast,
  onConnected,
}: {
  open: boolean
  agentName: string
  onClose: () => void
  showToast: (msg: string, type?: ToastType) => void
  onConnected: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [workspaces, setWorkspaces] = useState<
    Array<{
      id: string
      slug: string
      name?: string
      endpoint?: string
      token?: string
    }>
  >([])
  const [view, setView] = useState<"list" | "create" | "token">("list")
  const [newWsName, setNewWsName] = useState("")
  const [token, setToken] = useState("")

  const parseWorkspaceUrl = (raw: string): URL | null => {
    try {
      return new URL(raw.trim())
    } catch {
      return null
    }
  }

  useEffect(() => {
    if (!open) return
    setView("list")
    setNewWsName("")
    setToken("")
    window.api
      .listWorkspaces()
      .then(setWorkspaces)
      .catch(() => {})
  }, [open])

  const doConnect = async (slug: string): Promise<void> => {
    try {
      showToast(
        t("agents.connectDialog.toast.connecting", { name: agentName }),
        "info",
      )
      await window.api.connectWorkspace(agentName, slug)
      capture("workspace_connected", { agent_name: agentName })
      window.api.signalReload()
      showToast(
        t("agents.connectDialog.toast.connectedTo", { slug }),
        "success",
      )
      onConnected()
      onClose()
    } catch (err: unknown) {
      showToast(
        t("agents.connectDialog.toast.error", {
          message: (err as Error).message,
        }),
        "error",
      )
    }
  }

  const doCreate = async (): Promise<void> => {
    const name = newWsName.trim()
    if (!name) {
      showToast(
        t("agents.connectDialog.toast.workspaceNameRequired"),
        "warning",
      )
      return
    }
    try {
      showToast(
        t("agents.connectDialog.toast.creatingWorkspace", { name }),
        "info",
      )
      const result = await window.api.createWorkspace(name)
      capture("workspace_created", { source: "agents_page" })
      showToast(
        t("agents.connectDialog.toast.workspaceCreated", { name }),
        "success",
      )
      if (result && result.token && agentName) {
        await window.api.connectWorkspace(agentName, result.token)
        window.api.signalReload()
        showToast(
          t("agents.connectDialog.toast.connectedToName", {
            name: agentName,
            workspace: name,
          }),
          "success",
        )
      }
      onConnected()
      onClose()
    } catch (err: unknown) {
      showToast(
        t("agents.connectDialog.toast.error", {
          message: (err as Error).message,
        }),
        "error",
      )
    }
  }

  const doJoinToken = async (): Promise<void> => {
    const trimmedToken = token.trim()
    if (!trimmedToken) {
      showToast(t("agents.connectDialog.toast.urlOrTokenRequired"), "warning")
      return
    }
    try {
      showToast(t("agents.connectDialog.toast.joining"), "info")
      const parsedUrl = parseWorkspaceUrl(trimmedToken)
      if (parsedUrl && parsedUrl.hostname !== "workspace.openagents.org") {
        const ws = await window.api.registerWorkspaceFromToken({
          url: trimmedToken,
        })
        const workspaceKey = ws.slug || ws.id
        if (!workspaceKey) throw new Error("Could not register workspace URL")
        await window.api.connectWorkspace(agentName, workspaceKey)
      } else {
        await window.api.connectWorkspace(agentName, trimmedToken)
      }
      window.api.signalReload()
      showToast(t("agents.connectDialog.toast.joined"), "success")
      onConnected()
      onClose()
    } catch (err: unknown) {
      showToast(
        t("agents.connectDialog.toast.error", {
          message: (err as Error).message,
        }),
        "error",
      )
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalTitle>
        {t("agents.connectDialog.title", { name: agentName })}
      </ModalTitle>
      {view === "list" && (
        <>
          {/* Existing workspaces: their own scroll region so a long list never
              pushes the create/join/cancel actions off-screen. Each row shows
              the name prominently with just the short slug (the full URL is
              redundant — same host for all — and lives in the hover title). */}
          {workspaces.length > 0 && (
            <div className="flex flex-col gap-1 mb-3 max-h-[42vh] overflow-y-auto scrollbar-hide">
              {workspaces.map((ws) => {
                const display = ws.name || ws.slug || ws.id
                const shortId = ws.slug || ws.id
                return (
                  <button
                    key={ws.id}
                    type="button"
                    title={`${workspaceWebBaseUrl(ws.endpoint)}/${shortId}`}
                    className="flex items-center justify-between gap-3 text-left px-3 py-2 text-[13px] w-full rounded-sm bg-(--bg-card) border border-(--border) cursor-pointer transition-all duration-150 hover:bg-(--accent-bg) hover:border-(--accent-border)"
                    onClick={() => doConnect(ws.slug || ws.id)}
                  >
                    <span className="font-medium truncate">{display}</span>
                    <span className="shrink-0 font-mono text-[11px] text-(--text-tertiary)">
                      {shortId}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          {/* Actions are visually distinct from workspace rows (dashed border)
              so they don't read as "just another workspace". */}
          <div className="flex flex-col gap-1">
            <button
              type="button"
              className="text-left px-3 py-2 text-[13px] w-full rounded-sm border border-dashed border-(--border) text-(--accent) font-medium cursor-pointer transition-all duration-150 hover:bg-(--accent-bg) hover:border-(--accent-border)"
              onClick={() => setView("create")}
            >
              {t("agents.connectDialog.createNew")}
            </button>
            <button
              type="button"
              data-testid="ws-join-toggle"
              className="text-left px-3 py-2 text-[13px] w-full rounded-sm border border-dashed border-(--border) text-(--text-secondary) cursor-pointer transition-all duration-150 hover:bg-(--accent-bg) hover:border-(--accent-border)"
              onClick={() => setView("token")}
            >
              {t("agents.connectDialog.joinWithToken")}
            </button>
          </div>
          <Button onClick={onClose} className="w-full mt-3">
            {t("agents.connectDialog.cancel")}
          </Button>
        </>
      )}
      {view === "create" && (
        <>
          <div className="form-group">
            <label htmlFor="new-workspace-name">
              {t("agents.connectDialog.workspaceName")}
            </label>
            <input
              id="new-workspace-name"
              type="text"
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
              placeholder={t("agents.connectDialog.workspaceNamePlaceholder")}
            />
          </div>
          <div className="form-actions">
            <Button variant="primary" onClick={doCreate}>
              {t("agents.connectDialog.create")}
            </Button>
            <Button onClick={onClose}>
              {t("agents.connectDialog.cancel")}
            </Button>
          </div>
        </>
      )}
      {view === "token" && (
        <>
          <div className="form-group">
            <label htmlFor="workspace-url-or-token">
              {t("agents.connectDialog.pasteUrlOrToken")}
            </label>
            <input
              id="workspace-url-or-token"
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t("agents.connectDialog.pasteUrlPlaceholder")}
            />
          </div>
          <div className="form-actions">
            <Button variant="primary" data-testid="ws-join" onClick={doJoinToken}>
              {t("agents.connectDialog.join")}
            </Button>
            <Button onClick={onClose}>
              {t("agents.connectDialog.cancel")}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
