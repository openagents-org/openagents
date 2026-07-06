import React, { useCallback, useEffect, useMemo, useState } from "react"
import ReactDOM from "react-dom"
import {
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Sparkles,
  KeyRound,
  Layers,
  Rocket,
  Cpu,
  Search,
  AlertTriangle,
  FolderOpen,
  Link2,
  Plus,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "../ui/Button"
import { Input } from "../ui/Input"
import { PasswordInput } from "../ui/PasswordInput"
import AgentIcon from "../AgentIcon"
import { useAgentsStore } from "../../store/agents"
import { useInstallStore } from "../../store/install"
import type { OnboardingAgent, EnvField } from "../../types"
import type { ToastType } from "../../hooks/useToast"
import { cn } from "../../lib/utils"
import { capture, group } from "../../lib/analytics"
import { throwIfInstallFailed } from "../../utils/installErrors"

const ONBOARDING_KEY = "onboarding_completed"
const STEP_KEY = "onboarding_step"
const SELECTED_AGENT_KEY = "last_selected_agent"

type Step = 0 | 1 | 2 | 3 | 4

// Human-readable names for the onboarding steps so the funnel reads clearly in PostHog.
const STEP_NAMES: Record<Step, string> = {
  0: "welcome",
  1: "select_agent",
  2: "configure",
  3: "create_agent",
  4: "connect_workspace",
}

const isWindows =
  typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)

function hasMissingRequired(
  fields: EnvField[],
  values: Record<string, string>,
): boolean {
  return fields.some((f) => f.required && !(values[f.name] || "").trim())
}

export function OnboardingFlow({
  open,
  onClose,
  showToast,
}: {
  open: boolean
  onClose: () => void
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>(() => {
    try {
      const raw = localStorage.getItem(STEP_KEY)
      const n = raw ? Number(raw) : 0
      return ([0, 1, 2, 3, 4].includes(n) ? n : 0) as Step
    } catch {
      return 0
    }
  })
  const [agents, setAgents] = useState<OnboardingAgent[]>([])
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedAgent, setSelectedAgent] = useState<string>(() => {
    try {
      return localStorage.getItem(SELECTED_AGENT_KEY) || ""
    } catch {
      return ""
    }
  })
  const [installing, setInstalling] = useState(false)
  // Live install progress for the selected agent, mirrored from the global
  // install:progress IPC stream by useInstallProgress (mounted at App root).
  // Keyed by agent TYPE, which is exactly selectedAgent.
  const installJob = useInstallStore((s) =>
    selectedAgent ? s.jobs[selectedAgent] || null : null,
  )

  // Step 2 (configure) state.
  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [loggedIn, setLoggedIn] = useState(false)
  const [checkingLogin, setCheckingLogin] = useState(false)
  // CLI install state for login-mode agents (e.g. Claude): true / false /
  // null-unknown. Drives the "is the CLI installed?" hint in the login block.
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<
    null | { ok: boolean; detail?: string }
  >(null)
  const [saving, setSaving] = useState(false)

  // Step 3 (create your first agent): an explicit name + working folder. The
  // name is no longer auto-derived as "<type>-1" — the user names the agent and
  // chooses where it runs.
  const [agentName, setAgentName] = useState("")
  const [agentFolder, setAgentFolder] = useState("")
  // Once the user edits/browses the folder, stop auto-syncing it to the name so
  // we never clobber a deliberate choice.
  const [folderTouched, setFolderTouched] = useState(false)
  const [homeDir, setHomeDir] = useState("")
  const [creatingAgent, setCreatingAgent] = useState(false)

  // Step 4 (connect workspace): default to linking an EXISTING workspace (the
  // common case) with paste-an-invite; creating a new one is the alternative.
  // Both are optional.
  const [wsMode, setWsMode] = useState<"create" | "existing">("existing")
  // No default/i18n name — a new workspace is fully user-named (placeholder only).
  const [workspaceName, setWorkspaceName] = useState("")
  const [wsInvite, setWsInvite] = useState("")
  const [provisioning, setProvisioning] = useState(false)

  const selectedEntry = useMemo(
    () => agents.find((a) => a.name === selectedAgent) || null,
    [agents, selectedAgent],
  )

  // Default the working folder to the user's home directory — a sensible,
  // easy-to-find root the user can then narrow to a specific project.
  const defaultFolderFor = useCallback((): string => homeDir, [homeDir])

  // Whether the user is taking the API-key path (vs the CLI login). In "env"
  // mode the key is the only path, so always. In "login" mode (dual-auth agents
  // like Claude) the key is OPTIONAL — only treat it as in-use once the user
  // types into a secret field. Non-secret fields are pre-seeded with defaults
  // (base URL / model), so they can't be the signal. When this is false, the
  // required-key validation must NOT gate progress — the user signs in instead.
  const usingApiKeyPath = useMemo(() => {
    if (!selectedEntry) return false
    if (selectedEntry.authMode === "env") return true
    return selectedEntry.envFields.some(
      (f) => f.password && (envValues[f.name] || "").trim(),
    )
  }, [selectedEntry, envValues])

  useEffect(() => {
    try {
      localStorage.setItem(STEP_KEY, String(step))
    } catch {}
    // Emit one event per onboarding step so we can see where users drop off.
    capture("onboarding_step_viewed", { step, step_name: STEP_NAMES[step] })
  }, [step])

  // Mark the start of onboarding exactly once when the flow first opens.
  const startedRef = React.useRef(false)
  useEffect(() => {
    if (open && !startedRef.current) {
      startedRef.current = true
      capture("onboarding_started")
    }
  }, [open])

  useEffect(() => {
    if (selectedAgent) {
      try {
        localStorage.setItem(SELECTED_AGENT_KEY, selectedAgent)
      } catch {}
    }
  }, [selectedAgent])

  const loadAgents = useCallback(async (): Promise<OnboardingAgent[]> => {
    setAgentsLoading(true)
    try {
      const list = await window.api.getOnboardingAgents()
      setAgents(list)
      return list
    } catch {
      return []
    } finally {
      setAgentsLoading(false)
    }
  }, [])

  // getOnboardingAgents returns [] until the agent-launcher core finishes
  // installing (common on first launch / slow Windows AV). Poll until the
  // runnable set appears so the picker never strands the user on an empty
  // state. Only runnable agents are returned, so whatever shows up is safe to
  // pick — no more "Agent not found" from choosing an unsupported runtime.
  //
  // This also has to run for the steps AFTER the picker (Configure / Workspace
  // / Launch): a returning user can relaunch straight into a resumed step, and
  // those steps derive `selectedEntry` from `agents`. If we only loaded on the
  // picker step, a resumed Configure step would sit on "Loading configuration…"
  // forever because the agent list was never fetched. Skip once loaded.
  useEffect(() => {
    if (!open || step < 1 || agents.length > 0) return
    let cancelled = false
    let attempt = 0
    const run = async (): Promise<void> => {
      while (!cancelled && attempt < 10) {
        const list = await loadAgents()
        if (cancelled) return
        if (list.length > 0) return
        attempt += 1
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [open, step, agents.length, loadAgents])

  // If a resumed session points at an agent that's no longer runnable (e.g. it
  // was uninstalled, or its persisted name no longer matches the catalog),
  // don't strand the post-picker steps on a perpetual spinner — once the agent
  // list has actually loaded and the saved selection isn't in it, send the user
  // back to the picker to choose again.
  useEffect(() => {
    if (!open || step < 2) return
    if (agentsLoading || agents.length === 0) return
    if (!selectedEntry) setStep(1)
  }, [open, step, agentsLoading, agents.length, selectedEntry])

  // Initialise the configure step from the selected agent's resolved auth info.
  // No network round-trips for the field list — the picker already carries the
  // authoritative env fields / login command, so an agent that needs auth is
  // never silently shown as "no configuration needed".
  useEffect(() => {
    if (!open || step !== 2 || !selectedEntry) return
    let cancelled = false
    setTestResult(null)
    const seed: Record<string, string> = {}
    for (const f of selectedEntry.envFields) {
      seed[f.name] = f.password ? "" : f.default || ""
    }
    setEnvValues(seed)
    setLoggedIn(false)
    setCliInstalled(null)
    if (selectedEntry.authMode === "login") {
      setCheckingLogin(true)
      // refreshLogin forces a fresh CLI `status` probe so an EXISTING sign-in is
      // detected the moment the step opens (healthCheck only reads the cache,
      // which is empty on first entry). Falls back to healthCheck for agents
      // without a login probe.
      window.api
        .refreshLogin(selectedEntry.name)
        .then((h) => {
          if (cancelled) return
          // `logged_in` (dual-auth agents like Claude) distinguishes a CLI
          // sign-in from "has an API key"; fall back to `ready` for pure
          // login agents that don't report it.
          setLoggedIn(h?.logged_in === true || (h?.logged_in == null && !!h?.ready))
          if (typeof h?.installed === "boolean") setCliInstalled(h.installed)
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setCheckingLogin(false)
        })
    }
    return () => {
      cancelled = true
    }
  }, [open, step, selectedEntry])

  // Resolve ~/.openagents once we reach the create-agent step, so the folder
  // field can prefill a sensible default working directory.
  useEffect(() => {
    if (!open || step !== 3 || homeDir) return
    window.api
      .listPaths()
      .then((p) => setHomeDir(p?.home || ""))
      .catch(() => {})
  }, [open, step, homeDir])

  // No default agent name — the user types their own. (Auto-filling "<type>-1"
  // whenever the field was empty made it impossible to clear: the effect
  // re-populated it on the very next render.)

  // Prefill the folder with the default until the user picks/edits their own.
  useEffect(() => {
    if (!open || step !== 3 || folderTouched) return
    const def = defaultFolderFor()
    if (def && def !== agentFolder) setAgentFolder(def)
  }, [open, step, folderTouched, defaultFolderFor, agentFolder])

  // The workspace step binds to the agent created in the previous step. If a
  // resumed session lands here without a known agent name, go back and create
  // one first rather than failing the bind on an empty name.
  useEffect(() => {
    if (!open || step !== 4) return
    if (!agentName.trim()) setStep(3)
  }, [open, step, agentName])

  const close = useCallback(
    (markComplete = false) => {
      if (markComplete) {
        capture("onboarding_completed")
        try {
          localStorage.setItem(ONBOARDING_KEY, "true")
          localStorage.removeItem(STEP_KEY)
        } catch {}
      }
      onClose()
    },
    [onClose],
  )

  const goNext = (): void => setStep((s) => Math.min(s + 1, 4) as Step)
  const goBack = (): void => setStep((s) => Math.max(s - 1, 0) as Step)

  const updateEnvValue = (name: string, value: string): void => {
    setEnvValues((prev) => ({ ...prev, [name]: value }))
    setTestResult(null)
  }

  const installSelectedAgent = async (): Promise<void> => {
    if (!selectedEntry) return
    if (selectedEntry.installed) {
      goNext()
      return
    }
    setInstalling(true)
    const type = selectedEntry.name
    let settled = false
    // First-run installs are slow (npm + sometimes a portable Node download) and
    // can run for several minutes. In rare cases the streaming promise stalls
    // even after npm has finished writing files — leaving the user stuck on a
    // spinner forever (closing/reopening the launcher then shows it installed).
    // Guard against that with a watchdog that polls the real on-disk install
    // state and lets us advance the moment the agent is actually installed. The
    // 30s grace period keeps it from racing a partial install to a false
    // positive during the normal (promise resolves) path.
    const watchdog = new Promise<void>((resolve) => {
      const startedAt = Date.now()
      const poll = async (): Promise<void> => {
        if (settled) return resolve()
        if (Date.now() - startedAt > 30_000) {
          try {
            const r = await window.api.checkAgentType(type)
            if (r?.installed) return resolve()
          } catch {}
        }
        setTimeout(() => void poll(), 5000)
      }
      setTimeout(() => void poll(), 5000)
    })
    try {
      // The install IPC resolves with { success:false, error } on failure (it
      // doesn't reject), so without this check a failed install would fall
      // through to goNext() — advancing into the setup/configure step with an
      // agent whose CLI never installed. The watchdog branch resolves to
      // undefined, which throwIfInstallFailed treats as success.
      const result = await Promise.race([
        window.api.installAgentTypeStreaming(type),
        watchdog,
      ])
      settled = true
      throwIfInstallFailed(result)
      await loadAgents()
      goNext()
    } catch (e) {
      settled = true
      showToast((e as Error).message, "error")
    } finally {
      setInstalling(false)
    }
  }

  const testEnvConnection = async (): Promise<void> => {
    if (!selectedEntry || selectedEntry.envFields.length === 0) return
    if (hasMissingRequired(selectedEntry.envFields, envValues)) {
      showToast(t("onboarding.flow.toast.fillRequiredFields"), "warning")
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const r = await window.api.testLLM(envValues)
      capture("llm_test_run", { success: r.success, model: r.model || null })
      setTestResult(
        r.success
          ? {
              ok: true,
              detail: r.model
                ? t("onboarding.flow.test.modelResponded", { model: r.model })
                : t("onboarding.flow.test.connectionLooksGood"),
            }
          : {
              ok: false,
              detail: r.error || t("onboarding.flow.test.testFailed"),
            },
      )
    } catch (e) {
      setTestResult({ ok: false, detail: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const openLoginTerminal = async (): Promise<void> => {
    if (!selectedEntry?.loginCommand) return
    try {
      await window.api.openTerminal(selectedEntry.loginCommand)
      showToast(t("onboarding.flow.toast.loginTerminalOpened"), "success")
      setCheckingLogin(true)
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 2000))
        try {
          // refreshLogin forces a fresh CLI `status` probe; healthCheck only
          // reads the cached value. Use the explicit `logged_in` flag (dual-auth
          // agents) and fall back to `ready` for pure login agents.
          const h = await window.api.refreshLogin(selectedEntry.name)
          if (typeof h?.installed === "boolean") setCliInstalled(h.installed)
          if (h?.logged_in === true || (h?.logged_in == null && h?.ready)) {
            setLoggedIn(true)
            setCheckingLogin(false)
            return
          }
        } catch {}
      }
      setCheckingLogin(false)
    } catch (e) {
      setCheckingLogin(false)
      showToast((e as Error).message, "error")
    }
  }

  const saveConfigAndContinue = async (): Promise<void> => {
    if (!selectedEntry) return
    // Only enforce/save the API-key fields when the user is actually on the
    // key path. In login mode (dual-auth agents like Claude) the key is
    // optional — a user signing in via the CLI must not be blocked by the
    // required key fields (which carry pre-seeded base-URL/model defaults).
    if (usingApiKeyPath) {
      if (hasMissingRequired(selectedEntry.envFields, envValues)) {
        showToast(t("onboarding.flow.toast.fillRequiredFields"), "warning")
        return
      }
      setSaving(true)
      try {
        await window.api.saveAgentEnv(selectedEntry.name, envValues)
      } catch (e) {
        showToast((e as Error).message, "error")
        setSaving(false)
        return
      }
      setSaving(false)
      goNext()
      return
    }
    // login / none modes (no key entered): never block. If the agent isn't
    // actually authed yet, it'll surface when the agent is started later.
    goNext()
  }

  const refreshAgentsStore = async (): Promise<void> => {
    window.api.signalReload()
    await window.api
      .listAgents()
      .then((a) => useAgentsStore.getState().setAgents(a))
      .catch(() => {})
  }

  const browseFolder = async (): Promise<void> => {
    try {
      const picked = await window.api.selectDirectory(agentFolder || homeDir || undefined)
      if (picked) {
        setFolderTouched(true)
        setAgentFolder(picked)
      }
    } catch (e) {
      showToast((e as Error).message, "error")
    }
  }

  // Step 3 — register the agent with its chosen name + working folder. No
  // workspace yet; that's the next (optional) step. Verified + idempotent in
  // the main process.
  const createAgentAndContinue = async (): Promise<void> => {
    if (!selectedEntry) return
    const name = agentName.trim()
    const folder = agentFolder.trim()
    if (!name) {
      showToast(t("onboarding.flow.toast.enterAgentName"), "warning")
      return
    }
    if (!folder) {
      showToast(t("onboarding.flow.toast.selectFolder"), "warning")
      return
    }
    setCreatingAgent(true)
    try {
      await window.api.provisionFirstAgent({
        agentType: selectedEntry.name,
        agentName: name,
        path: folder,
        workspaceName: null,
      })
      capture("onboarding_agent_created")
      await refreshAgentsStore()
      goNext()
    } catch (e) {
      showToast((e as Error).message, "error")
    } finally {
      setCreatingAgent(false)
    }
  }

  // Step 4 — create a brand new workspace and bind the agent to it. Re-uses
  // provisionFirstAgent (the agent already exists, so add is a no-op) so the
  // create + persist + bind sequence stays atomic in one main-process call.
  const createWorkspaceAndFinish = async (): Promise<void> => {
    if (!selectedEntry) return
    const wsName = workspaceName.trim()
    if (!wsName) {
      showToast(t("onboarding.flow.toast.enterWorkspaceName"), "warning")
      return
    }
    setProvisioning(true)
    try {
      const res = await window.api.provisionFirstAgent({
        agentType: selectedEntry.name,
        agentName: agentName.trim(),
        path: agentFolder.trim() || null,
        workspaceName: wsName,
      })
      if (res.workspaceName) {
        if (res.workspaceSlug) group("workspace", res.workspaceSlug)
        capture("workspace_created", {
          source: "launcher_onboarding",
          workspace_id: res.workspaceSlug,
        })
        showToast(
          t("onboarding.flow.toast.workspaceCreated", { name: res.workspaceName }),
          "success",
        )
      }
      if (res.warning) showToast(res.warning, "warning")
      await refreshAgentsStore()
      close(true)
    } catch (e) {
      showToast((e as Error).message, "error")
    } finally {
      setProvisioning(false)
    }
  }

  // Step 4 — connect to an EXISTING workspace from a pasted invite link/token:
  // register the network locally, then bind the agent to it.
  const connectExistingWorkspaceAndFinish = async (): Promise<void> => {
    const invite = wsInvite.trim()
    if (!invite) {
      showToast(t("onboarding.flow.toast.enterWorkspaceLink"), "warning")
      return
    }
    setProvisioning(true)
    try {
      const isUrl = /^https?:\/\//i.test(invite)
      const ws = await window.api.registerWorkspaceFromToken(
        isUrl ? { url: invite } : { token: invite },
      )
      const slug = ws?.slug
      if (!slug) throw new Error(t("onboarding.flow.toast.workspaceResolveFailed"))
      await window.api.connectWorkspace(agentName.trim(), slug)
      group("workspace", slug)
      capture("workspace_connected", {
        source: "launcher_onboarding",
        workspace_id: slug,
      })
      showToast(
        t("onboarding.flow.toast.workspaceConnected", { name: ws.name || slug }),
        "success",
      )
      await refreshAgentsStore()
      close(true)
    } catch (e) {
      showToast((e as Error).message, "error")
    } finally {
      setProvisioning(false)
    }
  }

  if (!open) return null

  const visibleAgents = (() => {
    const q = search.trim().toLowerCase()
    if (!q) return agents
    return agents.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.label || "").toLowerCase().includes(q) ||
        (c.description || "").toLowerCase().includes(q),
    )
  })()

  const renderBody = (): React.JSX.Element | null => {
    switch (step) {
      case 0:
        return <WelcomeStep />
      case 1:
        return (
          <AgentSelectionStep
            agents={visibleAgents}
            loading={agentsLoading}
            search={search}
            setSearch={setSearch}
            selected={selectedAgent}
            setSelected={setSelectedAgent}
            onRetry={() => void loadAgents()}
            installing={installing}
            installPhase={installJob?.phase ?? null}
            installDetail={installJob?.detail ?? null}
          />
        )
      case 2:
        return (
          <ApiKeyStep
            entry={selectedEntry}
            values={envValues}
            onChangeValue={updateEnvValue}
            onTest={testEnvConnection}
            onLogin={openLoginTerminal}
            testing={testing}
            testResult={testResult}
            loggedIn={loggedIn}
            checkingLogin={checkingLogin}
            cliInstalled={cliInstalled}
          />
        )
      case 3:
        return (
          <CreateAgentStep
            agentLabel={selectedEntry?.label || selectedEntry?.name || ""}
            name={agentName}
            setName={setAgentName}
            folder={agentFolder}
            setFolder={(v) => {
              setFolderTouched(true)
              setAgentFolder(v)
            }}
            onBrowse={browseFolder}
          />
        )
      case 4:
        return (
          <ConnectWorkspaceStep
            mode={wsMode}
            setMode={setWsMode}
            workspaceName={workspaceName}
            setWorkspaceName={setWorkspaceName}
            invite={wsInvite}
            setInvite={setWsInvite}
          />
        )
      default:
        return null
    }
  }

  const renderFooter = (): React.JSX.Element => {
    switch (step) {
      case 0:
        return (
          <FooterShell>
            <span />
            <Button variant="primary" onClick={goNext}>
              {t("onboarding.flow.footer.getStarted")}{" "}
              <ChevronRight className="w-4 h-4" />
            </Button>
          </FooterShell>
        )
      case 1:
        return (
          <FooterShell>
            <Button variant="ghost" onClick={goBack}>
              <ChevronLeft className="w-4 h-4" /> {t("onboarding.flow.footer.back")}
            </Button>
            <Button
              variant="primary"
              onClick={installSelectedAgent}
              disabled={!selectedEntry || installing}
            >
              {installing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />{" "}
                  {t("onboarding.flow.footer.installing")}
                </>
              ) : (
                <>
                  {t("onboarding.flow.footer.continue")}{" "}
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </FooterShell>
        )
      case 2: {
        // Only required ENV fields gate progress. CLI login is NOT a hard gate:
        // the login happens in an external terminal and the launcher's health
        // check is unreliable for some agents (e.g. Gemini exposes no readiness
        // signal), so blocking on it would strand users who are actually logged
        // in. We show detected status, but always let them continue.
        const needsEnv =
          usingApiKeyPath &&
          hasMissingRequired(selectedEntry!.envFields, envValues)
        return (
          <FooterShell>
            <Button variant="ghost" onClick={goBack}>
              <ChevronLeft className="w-4 h-4" /> {t("onboarding.flow.footer.back")}
            </Button>
            <Button
              variant="primary"
              onClick={saveConfigAndContinue}
              disabled={saving || needsEnv}
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />{" "}
                  {t("onboarding.flow.footer.saving")}
                </>
              ) : (
                <>
                  {t("onboarding.flow.footer.saveAndContinue")}{" "}
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </FooterShell>
        )
      }
      case 3:
        // Create the agent (name + folder) or skip straight into the app.
        return (
          <FooterShell>
            <Button variant="ghost" onClick={goBack}>
              <ChevronLeft className="w-4 h-4" /> {t("onboarding.flow.footer.back")}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => close(true)}
                disabled={creatingAgent}
              >
                {t("onboarding.flow.footer.skipToApp")}
              </Button>
              <Button
                variant="primary"
                onClick={createAgentAndContinue}
                disabled={
                  creatingAgent || !agentName.trim() || !agentFolder.trim()
                }
              >
                {creatingAgent ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />{" "}
                    {t("onboarding.flow.footer.creating")}
                  </>
                ) : (
                  <>
                    {t("onboarding.flow.footer.createAndContinue")}{" "}
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
          </FooterShell>
        )
      case 4: {
        // Connect a workspace (new or existing) or skip into the app.
        const wsSubmit =
          wsMode === "create"
            ? createWorkspaceAndFinish
            : connectExistingWorkspaceAndFinish
        const wsDisabled =
          provisioning ||
          (wsMode === "create" ? !workspaceName.trim() : !wsInvite.trim())
        return (
          <FooterShell>
            <Button variant="ghost" onClick={goBack}>
              <ChevronLeft className="w-4 h-4" /> {t("onboarding.flow.footer.back")}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => close(true)}
                disabled={provisioning}
              >
                {t("onboarding.flow.footer.skipToApp")}
              </Button>
              <Button variant="primary" onClick={wsSubmit} disabled={wsDisabled}>
                {provisioning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />{" "}
                    {wsMode === "create"
                      ? t("onboarding.flow.footer.creating")
                      : t("onboarding.flow.footer.connecting")}
                  </>
                ) : (
                  <>
                    {wsMode === "create"
                      ? t("onboarding.flow.footer.createAndFinish")
                      : t("onboarding.flow.footer.connectAndFinish")}{" "}
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
          </FooterShell>
        )
      }
      default:
        return <FooterShell />
    }
  }

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-1500 flex flex-col bg-(--bg-primary)">
      <ProgressBar step={step} />

      {/* flex column + my-auto centers the step vertically when the viewport
          has spare height (large displays), and gracefully falls back to
          top-aligned scrolling when a step's content is taller than the
          viewport — margins collapse to 0, so the top is never clipped. */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        <div className="w-full max-w-180 mx-auto my-auto px-8 py-10 sm:py-12">
          {renderBody()}
        </div>
      </div>

      {renderFooter()}
    </div>,
    document.body,
  )
}

// ─── Layout shells ────────────────────────────────────────────

function ProgressBar({ step }: { step: Step }): React.JSX.Element {
  const { t } = useTranslation()
  const labels = [
    t("onboarding.flow.progress.welcome"),
    t("onboarding.flow.progress.agent"),
    t("onboarding.flow.progress.configure"),
    t("onboarding.flow.progress.createAgent"),
    t("onboarding.flow.progress.connectWorkspace"),
  ]
  return (
    <div className="shrink-0 px-8 pt-6 pb-4 border-b border-(--border) bg-(--bg-card)">
      <div className="flex items-center gap-3 max-w-180 mx-auto">
        {labels.map((label, i) => (
          <React.Fragment key={label}>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center",
                  i < step
                    ? "bg-(--success) text-white"
                    : i === step
                      ? "bg-(--accent) text-white"
                      : "bg-(--bg-input) text-(--text-tertiary)",
                )}
              >
                {i < step ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span
                className={cn(
                  "text-[12px]",
                  i === step
                    ? "text-(--text-primary) font-semibold"
                    : "text-(--text-secondary)",
                )}
              >
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div className="flex-1 h-px bg-(--border)" />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function FooterShell({
  children,
}: {
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="shrink-0 border-t border-(--border) bg-(--bg-card) px-8 py-4">
      <div className="max-w-180 mx-auto flex items-center justify-between gap-3">
        {children}
      </div>
    </div>
  )
}

function StepHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.JSX.Element
  title: string
  subtitle: string
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 mb-8">
      <div className="w-10 h-10 rounded-(--radius-sm) bg-(--accent-bg) text-(--accent) flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold m-0 tracking-[-0.02em]">{title}</h1>
        <p className="mt-1 m-0 text-[13px] text-(--text-secondary)">{subtitle}</p>
      </div>
    </div>
  )
}

// ─── Step bodies ──────────────────────────────────────────────

function WelcomeStep(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <StepHeader
        icon={<Sparkles className="w-5 h-5" />}
        title={t("onboarding.flow.welcome.title")}
        subtitle={t("onboarding.flow.welcome.subtitle")}
      />
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 list-none m-0 p-0">
        {[
          {
            icon: <Cpu className="w-4 h-4" />,
            label: t("onboarding.flow.welcome.benefits.install"),
          },
          {
            icon: <KeyRound className="w-4 h-4" />,
            label: t("onboarding.flow.welcome.benefits.credentials"),
          },
          {
            icon: <Layers className="w-4 h-4" />,
            label: t("onboarding.flow.welcome.benefits.workspaces"),
          },
          {
            icon: <Rocket className="w-4 h-4" />,
            label: t("onboarding.flow.welcome.benefits.connect"),
          },
        ].map((b) => (
          <li
            key={b.label}
            className="flex items-start gap-3 p-3.5 rounded-(--radius-sm) bg-(--bg-card) border border-(--border)"
          >
            <div className="text-(--accent) mt-0.5 shrink-0">{b.icon}</div>
            <span className="text-[12px] text-(--text-primary)">{b.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-[12px] text-(--text-tertiary)">
        {t("onboarding.flow.welcome.footnote")}
      </p>
    </>
  )
}

// Phase ids map to labels in the i18n catalog under
// `onboarding.flow.installPhase.<id>`; translated at render time.
const INSTALL_PHASE_IDS = [
  "preparing",
  "downloading",
  "installing",
  "verifying",
  "done",
  "error",
] as const

function AgentSelectionStep({
  agents,
  loading,
  search,
  setSearch,
  selected,
  setSelected,
  onRetry,
  installing,
  installPhase,
  installDetail,
}: {
  agents: OnboardingAgent[]
  loading: boolean
  search: string
  setSearch: (v: string) => void
  selected: string
  setSelected: (v: string) => void
  onRetry: () => void
  installing: boolean
  installPhase: string | null
  installDetail: string | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const phaseId = INSTALL_PHASE_IDS.includes(
    (installPhase || "preparing") as (typeof INSTALL_PHASE_IDS)[number],
  )
    ? installPhase || "preparing"
    : "installing"
  return (
    <>
      <StepHeader
        icon={<Cpu className="w-5 h-5" />}
        title={t("onboarding.flow.agentSelection.title")}
        subtitle={t("onboarding.flow.agentSelection.subtitle")}
      />
      {installing && (
        <div className="flex items-start gap-2.5 mb-4 px-3.5 py-3 rounded-(--radius-sm) bg-(--accent-bg) border border-(--accent-border)">
          <Loader2 className="w-4 h-4 mt-0.5 shrink-0 animate-spin text-(--accent)" />
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-(--text-primary)">
              {t(`onboarding.flow.installPhase.${phaseId}`)}
            </div>
            <div className="text-[11px] text-(--text-secondary) truncate">
              {installDetail ||
                t("onboarding.flow.agentSelection.installingDetail")}
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-(--radius-sm) bg-(--bg-card) border border-(--border)">
        <Search className="w-3.5 h-3.5 text-(--text-tertiary)" />
        <input
          className="flex-1 bg-transparent border-0 outline-none text-[13px]"
          placeholder={t("onboarding.flow.agentSelection.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 auto-rows-fr gap-2.5 list-none m-0 p-0">
        {loading && agents.length === 0 && (
          <li className="col-span-1 sm:col-span-2 text-center text-[12px] text-(--text-tertiary) py-6 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />{" "}
            {t("onboarding.flow.agentSelection.loadingAgents")}
          </li>
        )}
        {!loading && agents.length === 0 && (
          <li className="col-span-1 sm:col-span-2 text-center text-[12px] text-(--text-tertiary) py-6 flex flex-col items-center gap-3">
            <span>
              {search.trim()
                ? t("onboarding.flow.agentSelection.noMatch")
                : t("onboarding.flow.agentSelection.stillInstalling")}
            </span>
            {!search.trim() && (
              <Button size="sm" variant="ghost" onClick={onRetry}>
                {t("onboarding.flow.agentSelection.retry")}
              </Button>
            )}
          </li>
        )}
        {agents.map((c) => {
          const active = c.name === selected
          return (
            <li key={c.name} className="h-full">
              <button
                type="button"
                onClick={() => setSelected(c.name)}
                disabled={installing}
                className={cn(
                  "w-full h-full text-left p-3 rounded-(--radius-sm) border bg-(--bg-card) transition-colors",
                  // Lock selection while an install is running — switching the
                  // selected agent mid-download would desync the install from
                  // the highlighted card.
                  installing ? "cursor-not-allowed" : "cursor-pointer",
                  active
                    ? "border-(--accent) ring-2 ring-(--accent-border)"
                    : installing
                      ? "border-(--border) opacity-50"
                      : "border-(--border) hover:border-(--border-hover)",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <AgentIcon type={c.name} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-(--text-primary) truncate">
                        {c.label || c.name}
                      </span>
                      {c.featured && (
                        <span className="text-[9px] uppercase px-1 py-0.5 rounded-sm bg-(--accent-bg) text-(--accent) font-bold">
                          {t("onboarding.flow.agentSelection.featured")}
                        </span>
                      )}
                      {c.installed && (
                        <span className="text-[9px] uppercase px-1 py-0.5 rounded-sm bg-(--success-bg) text-(--success-text) font-bold">
                          {t("onboarding.flow.agentSelection.installed")}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] leading-snug text-(--text-secondary) line-clamp-2 mt-1 min-h-[2lh]">
                      {c.description ||
                        t("onboarding.flow.agentSelection.noDescription")}
                    </div>
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function ApiKeyStep({
  entry,
  values,
  onChangeValue,
  onTest,
  onLogin,
  testing,
  testResult,
  loggedIn,
  checkingLogin,
  cliInstalled,
}: {
  entry: OnboardingAgent | null
  values: Record<string, string>
  onChangeValue: (name: string, value: string) => void
  onTest: () => void
  onLogin: () => void
  testing: boolean
  testResult: null | { ok: boolean; detail?: string }
  loggedIn: boolean
  checkingLogin: boolean
  cliInstalled: boolean | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const label =
    entry?.label || entry?.name || t("onboarding.flow.apiKey.thisAgent")
  const mode = entry?.authMode ?? "none"
  const hasLogin = !!entry?.loginCommand
  const hasEnvFields = !!entry && entry.envFields.length > 0
  const subtitle =
    mode === "env"
      ? t("onboarding.flow.apiKey.subtitleEnv", { label })
      : mode === "login"
        ? hasEnvFields
          ? t("onboarding.flow.apiKey.subtitleLoginWithKey", { label })
          : t("onboarding.flow.apiKey.subtitleLogin", { label })
        : t("onboarding.flow.apiKey.subtitleNone", { label })

  // Claude Code refuses to run under cmd.exe on Windows; the launcher opens
  // PowerShell, but if the CLI also needs bash the user must have Git for
  // Windows. Surface that up front instead of a cryptic terminal error.
  const showWindowsShellNote =
    isWindows && hasLogin && /^claude\b/.test(entry?.loginCommand || "")

  // Reusable: the env-field inputs (used as the primary view in "env" mode and
  // as the optional "prefer an API key" section inside "login" mode).
  const envInputs = entry ? (
    <div className="flex flex-col gap-4">
      {entry.envFields.map((f) => {
        const FieldInput = f.password ? PasswordInput : Input
        const value = values[f.name] ?? ""
        return (
          <div key={f.name}>
            <label className="block text-[12px] font-medium mb-1.5">
              {f.description || f.name}
              {f.required && (
                <span className="text-(--danger-text) ml-0.5">*</span>
              )}
              <span className="ml-2 text-[10px] text-(--text-tertiary) font-mono">
                {f.name}
              </span>
            </label>
            <FieldInput
              value={value}
              onChange={(e) => onChangeValue(f.name, e.target.value)}
              placeholder={
                f.placeholder ||
                f.default ||
                t("onboarding.flow.apiKey.fieldPlaceholder", { name: f.name })
              }
            />
          </div>
        )
      })}
    </div>
  ) : null

  const testRow = (
    <div className="flex items-center gap-3 mt-4 flex-wrap">
      <Button size="sm" onClick={onTest} disabled={testing}>
        {testing ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />{" "}
            {t("onboarding.flow.apiKey.testing")}
          </>
        ) : (
          t("onboarding.flow.apiKey.testConnection")
        )}
      </Button>
      {entry?.docsUrl && (
        <a
          href={entry.docsUrl}
          onClick={(e) => {
            e.preventDefault()
            if (entry?.docsUrl) window.api.openExternal(entry.docsUrl)
          }}
          className="text-[12px] text-(--accent) hover:underline"
        >
          {t("onboarding.flow.apiKey.whereKey")}
        </a>
      )}
    </div>
  )

  const loginBlock = entry ? (
    <div className="p-4 rounded-(--radius-sm) bg-(--bg-card) border border-(--border)">
      {loggedIn ? (
        <div className="flex items-center gap-2 text-[13px] mb-3 text-(--success-text)">
          <span>✓</span>
          <strong>{t("onboarding.flow.apiKey.detectedLogin")}</strong>
        </div>
      ) : cliInstalled === false ? (
        // Login can't succeed until the CLI exists. Onboarding installs the
        // agent before this step, but surface it explicitly so a missing/failed
        // install doesn't read as a silent login failure.
        <div className="flex items-center gap-2 text-[13px] mb-3 text-(--warning-text)">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>
            <strong>
              {t("onboarding.flow.apiKey.notInstalledYet", { label })}
            </strong>
            {t("onboarding.flow.apiKey.notInstalledHint")}
          </span>
        </div>
      ) : cliInstalled === true ? (
        <div className="flex items-center gap-2 text-[13px] mb-3 text-(--text-secondary)">
          <span>✓</span>
          <span>
            {t("onboarding.flow.apiKey.installedNotSignedIn", { label })}
          </span>
        </div>
      ) : null}
      <p className="text-[12px] text-(--text-secondary) m-0 mb-3">
        {t("onboarding.flow.apiKey.loginInstructionsPrefix", { label })}
        <code className="inline-code">{entry.loginCommand}</code>
        {t("onboarding.flow.apiKey.loginInstructionsMid")}
        <strong>{t("onboarding.flow.apiKey.saveAndContinue")}</strong>
        {t("onboarding.flow.apiKey.loginInstructionsSuffix")}
      </p>
      {showWindowsShellNote && (
        <div className="flex items-start gap-2 text-[11px] text-(--text-secondary) mb-3 p-2.5 rounded-sm bg-(--bg-input)">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-(--warning-text)" />
          <span>
            {t("onboarding.flow.apiKey.windowsShellNotePrefix")}
            <a
              href="https://git-scm.com/downloads/win"
              onClick={(e) => {
                e.preventDefault()
                window.api.openExternal("https://git-scm.com/downloads/win")
              }}
              className="text-(--accent) hover:underline"
            >
              {t("onboarding.flow.apiKey.gitForWindows")}
            </a>
            {t("onboarding.flow.apiKey.windowsShellNoteOr")}
            <a
              href="https://aka.ms/powershell"
              onClick={(e) => {
                e.preventDefault()
                window.api.openExternal("https://aka.ms/powershell")
              }}
              className="text-(--accent) hover:underline"
            >
              {t("onboarding.flow.apiKey.powershell7")}
            </a>
            {t("onboarding.flow.apiKey.windowsShellNoteSuffix")}
          </span>
        </div>
      )}
      <Button
        size="sm"
        variant="primary"
        onClick={onLogin}
        disabled={checkingLogin}
      >
        {checkingLogin ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />{" "}
            {t("onboarding.flow.apiKey.waitingForLogin")}
          </>
        ) : loggedIn ? (
          t("onboarding.flow.apiKey.reopenLoginTerminal")
        ) : (
          t("onboarding.flow.apiKey.openLoginTerminal")
        )}
      </Button>
      <p className="mt-3 text-[11px] text-(--text-tertiary) m-0">
        {t("onboarding.flow.apiKey.detectionNote")}
      </p>
      {hasEnvFields && (
        <div className="mt-4 pt-4 border-t border-(--border)">
          <p className="text-[12px] font-medium m-0 mb-3">
            {t("onboarding.flow.apiKey.preferApiKey")}
          </p>
          {envInputs}
          {testRow}
        </div>
      )}
    </div>
  ) : null

  return (
    <>
      <StepHeader
        icon={<KeyRound className="w-5 h-5" />}
        title={t("onboarding.flow.apiKey.title")}
        subtitle={subtitle}
      />

      {!entry ? (
        <div className="flex items-center gap-2 text-[12px] text-(--text-tertiary) py-6">
          <Loader2 className="w-4 h-4 animate-spin" />{" "}
          {t("onboarding.flow.apiKey.loadingConfiguration")}
        </div>
      ) : mode === "env" ? (
        <>
          {envInputs}
          <div className="flex items-center gap-3 mt-4 flex-wrap">
            <Button size="sm" onClick={onTest} disabled={testing}>
              {testing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />{" "}
                  {t("onboarding.flow.apiKey.testing")}
                </>
              ) : (
                t("onboarding.flow.apiKey.testConnection")
              )}
            </Button>
            {hasLogin && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onLogin}
                disabled={checkingLogin}
              >
                {checkingLogin
                  ? t("onboarding.flow.apiKey.waitingForLogin")
                  : loggedIn
                    ? t("onboarding.flow.apiKey.reloginViaCli")
                    : t("onboarding.flow.apiKey.orLoginViaCli")}
              </Button>
            )}
            {entry.docsUrl && (
              <a
                href={entry.docsUrl}
                onClick={(e) => {
                  e.preventDefault()
                  if (entry.docsUrl) window.api.openExternal(entry.docsUrl)
                }}
                className="text-[12px] text-(--accent) hover:underline"
              >
                {t("onboarding.flow.apiKey.whereKey")}
              </a>
            )}
          </div>
        </>
      ) : mode === "login" ? (
        loginBlock
      ) : (
        <div className="p-4 rounded-(--radius-sm) bg-(--success-bg) text-(--success-text) text-[12px]">
          {t("onboarding.flow.apiKey.noConfigNeededPrefix")}
          <strong>{t("onboarding.flow.apiKey.saveAndContinue")}</strong>
          {t("onboarding.flow.apiKey.noConfigNeededSuffix")}
        </div>
      )}

      {testResult && (
        <div
          className={cn(
            "mt-4 px-3 py-2 rounded-sm text-[12px]",
            testResult.ok
              ? "bg-(--success-bg) text-(--success-text)"
              : "bg-(--danger-bg) text-(--danger-text)",
          )}
        >
          {testResult.ok
            ? t("onboarding.flow.apiKey.connected")
            : t("onboarding.flow.apiKey.failed")}
          {testResult.detail && (
            <span className="ml-1.5 opacity-80">— {testResult.detail}</span>
          )}
        </div>
      )}
    </>
  )
}

function CreateAgentStep({
  agentLabel,
  name,
  setName,
  folder,
  setFolder,
  onBrowse,
}: {
  agentLabel: string
  name: string
  setName: (v: string) => void
  folder: string
  setFolder: (v: string) => void
  onBrowse: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <StepHeader
        icon={<Cpu className="w-5 h-5" />}
        title={t("onboarding.flow.createAgent.title")}
        subtitle={t("onboarding.flow.createAgent.subtitle", {
          label: agentLabel || t("onboarding.flow.apiKey.thisAgent"),
        })}
      />
      <label className="block text-[12px] font-medium mb-1.5">
        {t("onboarding.flow.createAgent.nameLabel")}
      </label>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("onboarding.flow.createAgent.namePlaceholder")}
      />
      <p className="mt-1.5 text-[11px] text-(--text-tertiary)">
        {t("onboarding.flow.createAgent.nameHint")}
      </p>

      <label className="block text-[12px] font-medium mb-1.5 mt-5">
        {t("onboarding.flow.createAgent.folderLabel")}
      </label>
      <div className="flex items-center gap-2">
        <Input
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder={t("onboarding.flow.createAgent.folderPlaceholder")}
          className="flex-1"
        />
        <Button size="sm" variant="ghost" onClick={onBrowse}>
          <FolderOpen className="w-3.5 h-3.5" />{" "}
          {t("onboarding.flow.createAgent.browse")}
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-(--text-tertiary)">
        {t("onboarding.flow.createAgent.folderHint")}
      </p>
    </>
  )
}

function ConnectWorkspaceStep({
  mode,
  setMode,
  workspaceName,
  setWorkspaceName,
  invite,
  setInvite,
}: {
  mode: "create" | "existing"
  setMode: (m: "create" | "existing") => void
  workspaceName: string
  setWorkspaceName: (v: string) => void
  invite: string
  setInvite: (v: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const options: Array<{
    id: "create" | "existing"
    icon: React.JSX.Element
    title: string
    desc: string
  }> = [
    {
      id: "existing",
      icon: <Link2 className="w-4 h-4" />,
      title: t("onboarding.flow.connectWorkspace.existingTitle"),
      desc: t("onboarding.flow.connectWorkspace.existingDesc"),
    },
    {
      id: "create",
      icon: <Plus className="w-4 h-4" />,
      title: t("onboarding.flow.connectWorkspace.createTitle"),
      desc: t("onboarding.flow.connectWorkspace.createDesc"),
    },
  ]
  return (
    <>
      <StepHeader
        icon={<Layers className="w-5 h-5" />}
        title={t("onboarding.flow.connectWorkspace.title")}
        subtitle={t("onboarding.flow.connectWorkspace.subtitle")}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5">
        {options.map((o) => {
          const active = o.id === mode
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setMode(o.id)}
              className={cn(
                "text-left p-3 rounded-(--radius-sm) border bg-(--bg-card) cursor-pointer transition-colors",
                active
                  ? "border-(--accent) ring-2 ring-(--accent-border)"
                  : "border-(--border) hover:border-(--border-hover)",
              )}
            >
              <div className="flex items-center gap-2 text-[13px] font-semibold text-(--text-primary)">
                <span className="text-(--accent)">{o.icon}</span>
                {o.title}
              </div>
              <div className="mt-1 text-[11px] leading-snug text-(--text-secondary)">
                {o.desc}
              </div>
            </button>
          )
        })}
      </div>

      {mode === "create" ? (
        <>
          <label className="block text-[12px] font-medium mb-1.5">
            {t("onboarding.flow.workspace.nameLabel")}
          </label>
          <Input
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            placeholder={t("onboarding.flow.workspace.namePlaceholder")}
          />
          <p className="mt-3 text-[11px] text-(--text-tertiary)">
            {t("onboarding.flow.workspace.hintPrefix")}
            <code className="inline-code">workspace.openagents.org</code>
            {t("onboarding.flow.connectWorkspace.createInputHint")}
          </p>
        </>
      ) : (
        <>
          <label className="block text-[12px] font-medium mb-1.5">
            {t("onboarding.flow.connectWorkspace.inviteLabel")}
          </label>
          <Input
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            placeholder={t("onboarding.flow.connectWorkspace.invitePlaceholder")}
          />
          <p className="mt-3 text-[11px] text-(--text-tertiary)">
            {t("onboarding.flow.connectWorkspace.inviteHint")}
          </p>
        </>
      )}
    </>
  )
}

export function shouldShowOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) !== "true"
  } catch {
    return false
  }
}
