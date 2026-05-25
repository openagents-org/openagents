import React, { useEffect, useRef, useCallback, useState } from "react"
import { useAgentsStore } from "../../store/agents"
import { useUiStore } from "../../store/ui"
import { useShallow } from "zustand/react/shallow"
import AgentIcon from "../../components/AgentIcon"
import StatusDot, { displayState } from "../../components/ui/StatusDot"
import { Plus } from "lucide-react"
import { Button } from "../../components/ui/Button"
import { Modal, ModalTitle } from "../../components/ui/Modal"
import { PasswordInput } from "../../components/ui/PasswordInput"
import { TopBar } from "../../components/TopBar"
import type { Agent, CatalogEntry, EnvField, HealthCheck } from "../../types"
import type { ToastType } from "../../hooks/useToast"
import { cn } from "../../lib/utils"
import { workspaceWebBaseUrl } from "../../lib/workspace-urls"

function formatHealthLabel(health: HealthCheck | null): string {
  if (!health) return "Not configured"
  if (!health.ready) return health.message || "Not configured"
  const parts = ["Ready"]
  if (health.auth_mode === "api_key") parts.push("API key")
  else if (health.auth_mode === "cli_login") parts.push("CLI login")
  if (health.execution_mode && health.execution_mode !== "unavailable")
    parts.push(health.execution_mode)
  return parts.join(" · ")
}

interface AgentsProps {
  showToast: (msg: string, type?: ToastType) => void
}

const LIST_ITEM = "flex flex-col gap-3 px-[18px] py-4 mb-2.5 bg-(--bg-card) border border-(--border) rounded-(--radius) shadow-sm transition-all duration-200 hover:shadow-md hover:border-(--border-hover)"

function SkeletonListItem(): React.JSX.Element {
  return (
    <div className={LIST_ITEM}>
      <div className="skeleton-shimmer rounded-full h-2.5 w-[62%] mb-2.5" />
      <div className="skeleton-shimmer rounded-full h-2.5 w-[42%]" />
    </div>
  )
}

export default function Agents({ showToast }: AgentsProps): React.JSX.Element {
  const { agents, setAgents, pendingAgentActions, addPendingAction, removePendingAction } =
    useAgentsStore(useShallow((s) => ({
      agents: s.agents, setAgents: s.setAgents,
      pendingAgentActions: s.pendingAgentActions,
      addPendingAction: s.addPendingAction, removePendingAction: s.removePendingAction,
    })))
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
        await window.api.stopAgent(agent.name)
        showToast(`Stopping ${agent.name}...`, "info")
        // Fast initial polls — the daemon now processes stop commands within
        // ~200ms, so checking quickly catches the state flip without making
        // the user stare at a "Stopping…" toast for 3+ seconds.
        const stopWaits = [400, 800, 1500, 2500, 3000, 3000]
        for (const w of stopWaits) {
          await new Promise((r) => setTimeout(r, w))
          const status = await window.api.agentStatus()
          if (!status[agent.name] || status[agent.name].state === "stopped") {
            showToast(`${agent.name} stopped`, "success")
            break
          }
          refresh()
        }
      } else {
        await window.api.startAgent(agent.name)
        showToast(`Starting ${agent.name}...`, "info")
        const startWaits = [
          500, 1000, 1500, 2500, 3000, 3000, 3000, 3000, 3000, 3000,
        ]
        for (const w of startWaits) {
          await new Promise((r) => setTimeout(r, w))
          const status = await window.api.agentStatus()
          const s = status[agent.name]
          if (s && ["running", "online"].includes(s.state)) {
            showToast(`${agent.name} is now running`, "success")
            break
          }
          refresh()
        }
      }
    } catch (err: unknown) {
      showToast(`Error: ${(err as Error).message}`, "error")
    } finally {
      removePendingAction(agent.name)
      refresh()
    }
  }

  const removeAgent = async (name: string): Promise<void> => {
    setRemoveTarget(null)
    try {
      await window.api.removeAgent(name)
      showToast(`Agent '${name}' removed`, "success")
      refresh()
    } catch (err: unknown) {
      showToast(`Error: ${(err as Error).message}`, "error")
    }
  }

  const disconnectAgent = async (name: string): Promise<void> => {
    try {
      await window.api.disconnectWorkspace(name)
      showToast(`Disconnected ${name} from workspace`, "success")
      window.api.signalReload()
      refresh()
    } catch (err: unknown) {
      showToast(`Error: ${(err as Error).message}`, "error")
    }
  }

  const openWorkspace = async (agent: Agent): Promise<void> => {
    try {
      const workspaces = await window.api.listWorkspaces()
      const ws = workspaces.find(
        (w) => w.slug === agent.network || w.id === agent.network,
      )
      const slug = (ws && ws.slug) || agent.network
      let url = `${workspaceWebBaseUrl(ws?.endpoint)}/${slug}`
      if (ws && ws.token) url += `?token=${encodeURIComponent(ws.token)}`
      window.api.openExternal(url)
    } catch (err: unknown) {
      showToast(`Error: ${(err as Error).message}`, "error")
    }
  }

  return (
    <section className="flex flex-col h-full">
      <TopBar
        title="My Agents"
        subtitle="— Manage installed agent instances"
        actions={
          <Button variant="primary" onClick={() => setNewAgentOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            New Agent
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
        <p className="hint py-5">
          No agents configured. Click &quot;+ New Agent&quot; to get started.
        </p>
      ) : (
        <div>
          {agents.map((agent) => {
            const isRunning = ["online", "running", "idle"].includes(
              agent.state,
            )
            const isPending = pendingAgentActions.has(agent.name)
            const health = agent.health || null
            const readyLabel = formatHealthLabel(health)
            const wsDisplay = agent.network
              ? agent.networkName && agent.networkName !== agent.network
                ? `${agent.network} (${agent.networkName})`
                : agent.network
              : ""
            const envDisplay: string[] = []
            if (agent.env?.LLM_BASE_URL || agent.env?.OPENAI_BASE_URL)
              envDisplay.push(
                `API: ${agent.env.LLM_BASE_URL || agent.env.OPENAI_BASE_URL}`,
              )
            if (agent.env?.LLM_MODEL || agent.env?.OPENCLAW_MODEL)
              envDisplay.push(
                `Model: ${agent.env.LLM_MODEL || agent.env.OPENCLAW_MODEL}`,
              )

            return (
              <div key={agent.name} className={LIST_ITEM}>
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 mb-1">
                      <AgentIcon type={agent.type} size={28} />
                      <h4 className="text-sm font-semibold m-0">{agent.name}</h4>
                    </div>
                    <span className="block text-xs text-(--text-secondary) mb-0.5">{agent.type}</span>
                    <span className="block text-[11px] text-(--text-tertiary)">
                      {agent.runtimeMismatch ? (
                        <span className="text-(--danger-text)">
                          Launcher core update required
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
                      <span className="block text-[11px] text-(--danger-text)">{agent.lastError}</span>
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
                      <span className="text-[11px] text-(--text-secondary)">{wsDisplay}</span>
                    ) : (
                      <span className="text-[11px] text-(--text-tertiary)">
                        Not connected
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between items-center pt-2.5 border-t border-(--border)">
                  <div className="flex gap-1.5 flex-wrap">
                    <Button
                      size="sm"
                      variant={isRunning ? "default" : "primary"}
                      onClick={() => toggleAgent(agent)}
                      disabled={isPending}
                    >
                      {isPending
                        ? isRunning
                          ? "Stopping..."
                          : "Starting..."
                        : isRunning
                          ? "Stop"
                          : "Start"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setConfigureAgent({
                          name: agent.name,
                          type: agent.type,
                        })
                        setConfigureOpen(true)
                      }}
                    >
                      Configure
                    </Button>
                    {agent.network ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => disconnectAgent(agent.name)}
                        >
                          Disconnect
                        </Button>
                        <Button size="sm" onClick={() => openWorkspace(agent)}>
                          Open Workspace
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => {
                          setConnectWsAgent(agent.name)
                          setConnectWsOpen(true)
                        }}
                      >
                        Connect
                      </Button>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setRemoveTarget(agent.name)}
                  >
                    Remove
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
        }}
      />

      {configureAgent && (
        <ConfigureDialog
          open={configureOpen}
          agentName={configureAgent.name}
          agentType={configureAgent.type}
          onClose={() => setConfigureOpen(false)}
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
          <AgentIcon type={agents.find((a) => a.name === removeTarget)?.type || ""} size={40} />
          <ModalTitle className="mt-3 text-center">
            Remove {removeTarget}?
          </ModalTitle>
          <p className="hint mt-3 mb-5 text-center">
            This will stop and remove <strong>{removeTarget}</strong>.
          </p>
          <div className="form-actions justify-center mt-0">
            <Button variant="destructive" onClick={() => { if (removeTarget) removeAgent(removeTarget) }}>
              Remove
            </Button>
            <Button onClick={() => setRemoveTarget(null)}>Cancel</Button>
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
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [supportedTypes, setSupportedTypes] = useState<string[]>([])
  const [selectedType, setSelectedType] = useState("")
  const [agentName, setAgentName] = useState("")
  const [agentPath, setAgentPath] = useState("")
  const [loading, setLoading] = useState(false)
  const setCurrentTab = useUiStore.getState().setCurrentTab

  useEffect(() => {
    if (!open) return
    setLoading(true)
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

  useEffect(() => {
    if (selectedType) {
      const suffix = Math.random().toString(36).slice(2, 6)
      setAgentName(`${selectedType}-${suffix}`)
    }
  }, [selectedType])

  const supportedSet = new Set(supportedTypes)
  const supportedInstalled = catalog.filter(
    (c) => c.installed && supportedSet.has(c.name),
  )

  const doCreate = async (): Promise<void> => {
    const name =
      agentName.trim() ||
      `${selectedType}-${Math.random().toString(36).slice(2, 6)}`
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      showToast(
        "Agent name can only contain letters, numbers, hyphens, and underscores",
        "warning",
      )
      return
    }
    try {
      await window.api.addAgent({
        name,
        type: selectedType,
        path: agentPath.trim() || undefined,
      })
      showToast(`Agent '${name}' created`, "success")
      onCreated(name, selectedType)
    } catch (err: unknown) {
      showToast(`Error: ${(err as Error).message}`, "error")
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalTitle>New Agent</ModalTitle>
        {loading ? (
          <p className="loading-text">Loading installed types...</p>
        ) : supportedInstalled.length === 0 ? (
          <>
            <p className="hint">
              No Launcher-supported agent runtimes installed. Install one first.
            </p>
            <div className="form-actions">
              <Button
                variant="primary"
                onClick={() => {
                  onClose()
                  setCurrentTab("install")
                }}
              >
                Go to Install
              </Button>
              <Button onClick={onClose}>Cancel</Button>
            </div>
          </>
        ) : (
          <>
            <div className="form-group">
              <label htmlFor="agent-type">Agent type</label>
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
              <label htmlFor="agent-name">Agent name</label>
              <input
                id="agent-name"
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder={`${selectedType}-xxxx`}
              />
            </div>
            <div className="form-group">
              <label htmlFor="agent-working-directory">Working directory (optional)</label>
              <input
                id="agent-working-directory"
                type="text"
                value={agentPath}
                onChange={(e) => setAgentPath(e.target.value)}
                placeholder="/path/to/project"
              />
            </div>
            <div className="form-actions">
              <Button variant="primary" onClick={doCreate}>
                Create
              </Button>
              <Button onClick={onClose}>Cancel</Button>
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
  const [fields, setFields] = useState<EnvField[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [loginCmd, setLoginCmd] = useState<string | null>(null)
  const [loggedIn, setLoggedIn] = useState(false)
  const [noConfig, setNoConfig] = useState(false)
  const [loading, setLoading] = useState(true)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<
    "idle" | "loading" | "ok" | "error"
  >("idle")

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setTestResult(null)
    setTestStatus("idle")
    setNoConfig(false)
    setLoginCmd(null)
    Promise.all([
      window.api.getEnvFields(agentType),
      window.api.getAgentEnv(agentType),
      agentName
        ? window.api.getAgentInstanceEnv(agentName)
        : Promise.resolve({} as Record<string, string>),
    ])
      .then(([f, typeEnv, instanceEnv]) => {
        if (f && f.length > 0) {
          setFields(f)
          const merged = { ...(typeEnv || {}), ...(instanceEnv || {}) }
          const initial: Record<string, string> = {}
          f.forEach((field) => {
            initial[field.name] = merged[field.name] || field.default || ""
          })
          setValues(initial)
        } else {
          window.api.getCatalog().then((catalog) => {
            const entry = catalog.find((c) => c.name === agentType)
            const cmd = entry?.check_ready?.login_command || null
            if (cmd) {
              setLoginCmd(cmd)
              window.api
                .healthCheck(agentType)
                .then((h) => setLoggedIn(h?.ready || false))
                .catch(() => {})
            } else {
              setNoConfig(true)
            }
          })
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [open, agentName, agentType])

  const save = async (): Promise<void> => {
    try {
      if (agentName) {
        await window.api.saveAgentInstanceEnv(agentName, values)
      } else {
        await window.api.saveAgentEnv(agentType, values)
      }
      showToast("Configuration saved", "success")
      onSaved()
      onClose()
    } catch (err: unknown) {
      showToast(`Error saving: ${(err as Error).message}`, "error")
    }
  }

  const testConnection = async (): Promise<void> => {
    setTestStatus("loading")
    setTestResult(null)
    try {
      const result = await window.api.testLLM(values)
      if (result.success) {
        setTestStatus("ok")
        setTestResult(
          `OK — model: ${result.model}, response: "${result.response}"`,
        )
      } else {
        setTestStatus("error")
        setTestResult(result.error || "Unknown error")
      }
    } catch (err: unknown) {
      setTestStatus("error")
      setTestResult((err as Error).message)
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalTitle>Configure {agentName || agentType}</ModalTitle>
        {loading ? (
          <p className="loading-text">Loading configuration...</p>
        ) : noConfig ? (
          <>
            <p className="hint">No configuration required for this agent type.</p>
            <Button onClick={onClose}>Close</Button>
          </>
        ) : loginCmd ? (
          <>
            <p className="hint">This agent uses login-based authentication.</p>
            <div className="flex items-center gap-2 mb-4 p-3 rounded-(--radius) bg-(--bg-input)">
              <span className="text-lg">{loggedIn ? "✅" : "⚠️"}</span>
              <strong className="text-[13px]">
                {loggedIn ? "Logged in" : "Not logged in"}
              </strong>
            </div>
            <div className="form-actions">
              <Button
                variant="primary"
                onClick={async () => {
                  showToast(`Opening terminal for ${loginCmd}...`, "info")
                  try {
                    await window.api.openTerminal(loginCmd)
                    showToast(
                      "Login terminal opened. Complete login there.",
                      "success",
                    )
                  } catch (err: unknown) {
                    showToast(
                      `Failed to open terminal: ${(err as Error).message}`,
                      "error",
                    )
                  }
                }}
              >
                {loggedIn ? "Re-login" : "Login"}
              </Button>
              <Button onClick={onClose}>Close</Button>
            </div>
          </>
        ) : (
          <>
            <p className="hint">
              {agentName
                ? "Settings saved for this agent. Type defaults remain available as fallbacks."
                : "Settings saved to ~/.openagents/env/"}
            </p>
            <div>
              {fields.map((f) => (
                <div key={f.name} className="form-group">
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
                      placeholder={f.placeholder || `Enter ${f.name}...`}
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
                      placeholder={f.placeholder || `Enter ${f.name}...`}
                    />
                  )}
                </div>
              ))}
            </div>
            {testResult && (
              <div
                className={cn(
                  "text-xs mb-2.5",
                  testStatus === "ok"
                    ? "test-success"
                    : testStatus === "error"
                      ? "test-error"
                      : "test-loading",
                )}
              >
                {testResult}
              </div>
            )}
            <div className="form-actions">
              <Button variant="primary" onClick={save}>
                Save
              </Button>
              <Button
                onClick={testConnection}
                disabled={testStatus === "loading"}
              >
                {testStatus === "loading" ? "Testing..." : "Test Connection"}
              </Button>
              <Button onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
    </Modal>
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
      showToast(`Connecting ${agentName} to workspace...`, "info")
      await window.api.connectWorkspace(agentName, slug)
      window.api.signalReload()
      showToast(`Connected to ${slug}`, "success")
      onConnected()
      onClose()
    } catch (err: unknown) {
      showToast(`Error: ${(err as Error).message}`, "error")
    }
  }

  const doCreate = async (): Promise<void> => {
    const name = newWsName.trim()
    if (!name) {
      showToast("Workspace name is required", "warning")
      return
    }
    try {
      showToast(`Creating workspace '${name}'...`, "info")
      const result = await window.api.createWorkspace(name)
      showToast(`Workspace '${name}' created`, "success")
      if (result && result.token && agentName) {
        await window.api.connectWorkspace(agentName, result.token)
        window.api.signalReload()
        showToast(`Connected ${agentName} to ${name}`, "success")
      }
      onConnected()
      onClose()
    } catch (err: unknown) {
      showToast(`Error: ${(err as Error).message}`, "error")
    }
  }

  const doJoinToken = async (): Promise<void> => {
    const t = token.trim()
    if (!t) {
      showToast("Workspace URL or token is required", "warning")
      return
    }
    try {
      showToast("Joining workspace...", "info")
      const parsedUrl = parseWorkspaceUrl(t)
      if (parsedUrl && parsedUrl.hostname !== "workspace.openagents.org") {
        const ws = await window.api.registerWorkspaceFromToken({ url: t })
        const workspaceKey = ws.slug || ws.id
        if (!workspaceKey) throw new Error("Could not register workspace URL")
        await window.api.connectWorkspace(agentName, workspaceKey)
      } else {
        await window.api.connectWorkspace(agentName, t)
      }
      window.api.signalReload()
      showToast("Joined workspace", "success")
      onConnected()
      onClose()
    } catch (err: unknown) {
      showToast(`Error: ${(err as Error).message}`, "error")
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <ModalTitle>Connect &apos;{agentName}&apos; to Workspace</ModalTitle>
        {view === "list" && (
          <>
            <div className="flex flex-col gap-1 mb-3.5">
              {workspaces.map((ws) => {
                const display = ws.name || ws.slug || ws.id
                const url = `${workspaceWebBaseUrl(ws.endpoint)}/${ws.slug || ws.id}`
                return (
                  <button
                    key={ws.id}
                    type="button"
                    className="text-left px-4 py-[11px] text-[13px] w-full rounded-sm bg-[var(--bg-card)] border border-[color:var(--border)] cursor-pointer transition-all duration-150 hover:bg-[var(--accent-bg)] hover:border-[color:var(--accent-border)]"
                    onClick={() => doConnect(ws.slug || ws.id)}
                  >
                    {display} — {url}
                  </button>
                )
              })}
              <button
                type="button"
                className="text-left px-4 py-[11px] text-[13px] w-full rounded-sm bg-[var(--bg-card)] border border-[color:var(--border)] cursor-pointer transition-all duration-150 hover:bg-[var(--accent-bg)] hover:border-[color:var(--accent-border)]"
                onClick={() => setView("create")}
              >
                + Create New Workspace
              </button>
              <button
                type="button"
                className="text-left px-4 py-[11px] text-[13px] w-full rounded-sm bg-[var(--bg-card)] border border-[color:var(--border)] cursor-pointer transition-all duration-150 hover:bg-[var(--accent-bg)] hover:border-[color:var(--accent-border)]"
                onClick={() => setView("token")}
              >
                Join with URL or Token
              </button>
            </div>
            <Button onClick={onClose} className="w-full">
              Cancel
            </Button>
          </>
        )}
        {view === "create" && (
          <>
            <div className="form-group">
              <label htmlFor="new-workspace-name">Workspace name</label>
              <input
                id="new-workspace-name"
                type="text"
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                placeholder="my-workspace"
              />
            </div>
            <div className="form-actions">
              <Button variant="primary" onClick={doCreate}>
                Create
              </Button>
              <Button onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
        {view === "token" && (
          <>
            <div className="form-group">
              <label htmlFor="workspace-url-or-token">Paste workspace URL or token</label>
              <input
                id="workspace-url-or-token"
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="https://workspace.openagents.org/team?token=… or http://localhost:8000/team?token=…"
              />
            </div>
            <div className="form-actions">
              <Button variant="primary" onClick={doJoinToken}>
                Join
              </Button>
              <Button onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
    </Modal>
  )
}
