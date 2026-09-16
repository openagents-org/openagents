import React, { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { AlertCircle, CheckCircle2, Info, Loader2, ShieldCheck } from "lucide-react"
import { AgentSetup, type AgentSetupApi } from "@/components/agents/agent-setup"
import { I18nProvider } from "@/lib/i18n"
import type { AgentCatalogEntry, WorkspaceNode } from "@/lib/types"
import { AgentEnvFields } from "@renderer/components/agent-env-fields"
import { Tabs, TabsList, TabsTrigger } from "@renderer/components/ui/tabs"
import { AuthStatusBanner, CliLoginBlock } from "@renderer/components/agent-auth/auth-status"
import { useCliLogin } from "@renderer/components/agent-auth/use-cli-login"
import { Button } from "@renderer/components/ui/button"
import { Spinner } from "@renderer/components/ui/spinner"
import { hasModelPicker } from "@renderer/lib/model-fields"
import { isCliLoginDetected, preferredAuthTab } from "@renderer/lib/agent-auth"
import type { Agent, CatalogEntry, EnvField, HealthCheck } from "@renderer/types"
import { throwIfInstallFailed } from "@renderer/utils/installErrors"
import { createLocalSetupApi, type LocalConfiguration } from "./local-setup-api"
import { agentCredentials, credentialErrors, isUnprobeable } from "../../../shared/agent-credentials"

export function LocalAgentSetup({ agent, onBack, onCreated, onChanged, onManage }: {
  agent?: Agent
  onBack: () => void
  onCreated: (name: string) => void
  onManage: (agent: { name: string; type: string }) => void
  onChanged: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [data, setData] = useState<{ node: WorkspaceNode; catalog: AgentCatalogEntry[]; raw: CatalogEntry[] } | null>(null)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [authBusy, setAuthBusy] = useState(false)
  const [configReady, setConfigReady] = useState(false)
  const config = useRef<LocalConfiguration | null>(null)
  const locale = i18n.language.startsWith("zh") ? "zh-CN" : "en-US"

  const mounted = useRef(true)
  const loadVersion = useRef(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; loadVersion.current++ } }, [])
  const refresh = async (): Promise<void> => {
    const version = ++loadVersion.current
    const [raw, supported, status, agents] = await bounded(Promise.all([
      window.api.getCatalog(), window.api.getSupportedAgentTypes(), window.api.getNodeStatus(), window.api.listAgents(),
    ]))
    if (!mounted.current || version !== loadVersion.current) return
    const supportedSet = new Set(supported)
    const available = raw.filter((entry) => !entry.comingSoon && supportedSet.has(entry.name))
    setData({ raw, catalog: available.map(toCatalogEntry), node: {
      nodeId: "this-computer", name: t("agents.shared.thisComputer"), hostname: status.hostname,
      deviceType: status.deviceType, os: window.api.platform, launcherVersion: null, status: "online",
      agents: agents.map((a) => ({ name: a.name, displayName: a.displayName ?? null, type: a.type, status: a.state, workingDir: a.path })),
      runtimes: [], lastHeartbeatAt: null, createdAt: null,
    } })
    const runtimes = await Promise.all(available.map(async (entry) => {
      const health = await bounded(window.api.healthCheck(entry.name), 8000).catch(() => null)
      return health ? { type: entry.name, installed: health.installed ?? entry.installed, ready: !!health.ready,
        version: health.version ?? null, reason: health.reason ?? null, message: health.message ?? null } : null
    }))
    if (mounted.current && version === loadVersion.current) setData((previous) => previous ? { ...previous, node: { ...previous.node, runtimes: runtimes.filter((runtime) => runtime !== null) } } : null)
  }
  useEffect(() => { let active = true; setError(""); void refresh().catch((err) => { if (active) setError(String(err)) }); return () => { active = false } }, [attempt])

  const api = useMemo<AgentSetupApi>(() => createLocalSetupApi(window.api, () => config.current), [])
  const current = agent && data?.node.agents.find((a) => a.name === agent.name)
  const loadError = error || (data && agent && !current ? t("agents.shared.agentUnavailable") : "")
  return <section className="h-full overflow-y-auto">
    {loadError ? <div className="p-8 space-y-4"><p role="alert">{loadError}</p><Button onClick={() => setAttempt((n) => n + 1)}>{t("common.retry")}</Button><Button variant="ghost" onClick={onBack}>{t("common.back")}</Button></div>
      : !data ? <div className="p-12 flex justify-center"><Spinner /></div>
      : <I18nProvider key={locale} initialLocale={locale} hasStoredLocale>
        <AgentSetup key={agent?.name || "new"} onManageAgent={onManage} api={api} node={data.node} catalog={data.catalog} editAgent={current}
          contextLabel={<>{t("agents.shared.runsHere")}{agent?.networkName || agent?.network ? ` · ${agent.networkName || agent.network}` : ` · ${t("agents.shared.localOnly")}`}</>}
          onBack={onBack} onChanged={() => { void refresh().catch((err) => { if (mounted.current) setError(String(err)) }); onChanged() }}
          onQueued={({ name }) => onCreated(name)}
          extensions={{ local: true, workingDirectoryHint: t("agents.shared.folderHint"), workingDirectoryPlaceholder: t("agents.shared.homeFolder"), disabled: !configReady || authBusy,
            browseFolder: (path) => window.api.selectDirectory(path || undefined),
            // The same rename This Computer's list offers: a label, pushed to the agent's workspace.
            renameAgent: async (agentName, label) => { await window.api.renameAgent(agentName, label) },
            configuration: ({ type, name, onChanged: changed }) => <LocalConfigurationFields key={`${type}:${name || ""}`} type={type} name={name}
              catalog={data.raw} onChanged={changed} onBusy={setAuthBusy}
              onChange={(next) => { config.current = next; setConfigReady(!!next) }} />,
          }} />
      </I18nProvider>}
  </section>
}

export function toCatalogEntry(entry: CatalogEntry): AgentCatalogEntry {
  return { ...entry, label: entry.label || entry.name, description: entry.description || "", install_command: "",
    homepage: entry.homepage || "", tags: entry.tags || [], builtin: !!entry.builtin }
}

export function LocalConfigurationFields({ type, name, catalog, onChange, onChanged, onBusy }: {
  type: string; name?: string; catalog: CatalogEntry[]; onChange: (config: LocalConfiguration | null) => void; onChanged: () => void; onBusy: (busy: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [fields, setFields] = useState<EnvField[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const initial = useRef<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [health, setHealth] = useState<HealthCheck | null>(null)
  const [installing, setInstalling] = useState(false)
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [authTab, setAuthTab] = useState<"cli" | "key">("cli")
  const [loginPhase, setLoginPhase] = useState<"idle" | "awaiting" | "checking">("idle")
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ kind: "success" | "error" | "info"; message: string } | null>(null)
  const entry = catalog.find((item) => item.name === type)
  const loginCmd = entry?.check_ready?.login_command || null
  const installed = health?.installed ?? entry?.installed ?? false
  const callback = useRef(onChange); callback.current = onChange
  // Refused at save, not just annotated: a model-gateway URL in a vendor-platform agent saves and starts cleanly, then fails on its first message.
  const blockedBy = (next: Record<string, string>): string | undefined => {
    const [, reason] = Object.entries(credentialErrors(type, next))[0] || []
    return reason ? t(`agents.credentials.endpointMismatch.${reason}`) : undefined
  }
  const publish = (next: Record<string, string>, fs = fields): void => callback.current({ type, name, fields: fs, values: next, initial: initial.current, blocked: blockedBy(next) })

  const confirmLogin = async (): Promise<void> => {
    setLoginPhase("checking"); setError("")
    try {
      await window.api.clearLoginKey(type, name)
      const health = await window.api.refreshLogin(type)
      setHealth(health); setLoggedIn(isCliLoginDetected(health, fields.length > 0))
      const [defaults, instance] = await Promise.all([window.api.getAgentEnv(type), name ? window.api.getAgentInstanceEnv(name) : Promise.resolve({})])
      const next = { ...defaults, ...instance }
      initial.current = next; setValues(next); publish(next); onChanged()
    } catch (err) { setError(String(err)) }
    finally { setLoginPhase("idle") }
  }
  const login = useCliLogin({ agentType: type, onSuccess: () => void confirmLogin() })
  useEffect(() => { onBusy(loading || installing || login.active); return () => onBusy(false) }, [loading, installing, login.active, onBusy])
  useEffect(() => { if (login.phase === "terminal") setLoginPhase("awaiting") }, [login.phase])
  useEffect(() => {
    let active = true; callback.current(null); setLoading(true)
    void Promise.all([window.api.getEnvFields(type), window.api.getAgentEnv(type), name ? window.api.getAgentInstanceEnv(name) : Promise.resolve({}), loginCmd ? window.api.refreshLogin(type) : window.api.healthCheck(type)])
      .then(([fs, defaults, instance, health]) => {
        if (!active) return
        const next = { ...defaults, ...instance }
        initial.current = next; setFields(fs); setValues(next); setAuthTab(preferredAuthTab(fs, next))
        setHealth(health); setLoggedIn(isCliLoginDetected(health, fs.length > 0)); publish(next, fs); setLoading(false)
      }).catch((err) => { if (active) { setError(String(err)); setLoading(false) } })
    return () => { active = false; callback.current(null) }
  }, [type, name])
  const change = (key: string, value: string): void => { const next = { ...values, [key]: value }; setValues(next); publish(next); setTestResult(null) }
  const importValues = (imported: Record<string, string>): void => { const next = { ...values, ...imported }; setValues(next); publish(next); setTestResult(null) }
  const test = async (): Promise<void> => {
    setTesting(true); setTestResult(null)
    try {
      const result = await window.api.testLLM(values)
      // Nothing to probe is not a failed credential: say how it is verified instead.
      setTestResult(result.success
        ? { kind: "success", message: t("agents.shared.connectionWorks") }
        : result.unsupported && result.reason
          ? { kind: "info", message: t(`agents.credentials.unprobeable.${result.reason}`) }
          : { kind: "error", message: result.error || t("agents.shared.connectionFailed") })
    }
    catch (err) { setTestResult({ kind: "error", message: String(err) }) } finally { setTesting(false) }
  }
  if (loading) return <Spinner />
  const keyForm = !loginCmd || authTab === "key"
  const loginModels = keyForm ? [] : fields.filter((field) => hasModelPicker(type, field.name))
  const unprobeable = isUnprobeable(type)
  const unprobeableReason = agentCredentials(type).reason
  return <div className="space-y-4">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {health && <AuthStatusBanner authInfo={{ ready: health.ready, authMode: health.auth_mode || null, message: health.message || null }} authLabels={entry?.check_ready?.auth_detected_labels || null} />}
    {!loginCmd && fields.length === 0 && <p className="text-sm text-muted-foreground">{t("agents.configureDialog.hintNoConfig")}</p>}
    {loginCmd && fields.length > 0 && <Tabs value={authTab} onValueChange={(value) => setAuthTab(value as "cli" | "key")}>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="cli" data-testid="auth-tab-cli">{t("agents.list.health.cliLogin")}</TabsTrigger>
        <TabsTrigger value="key" data-testid="auth-tab-key">{t("agents.shared.apiKey")}</TabsTrigger>
      </TabsList>
    </Tabs>}
    {loginCmd && authTab === "cli" && <CliLoginBlock agentType={type} loginCmd={loginCmd} loggedIn={loggedIn} loginPhase={loginPhase}
      notInstalled={!installed} login={login} onStartLogin={(options) => void login.start(options)} onConfirmLogin={confirmLogin} onCancelAwaiting={() => setLoginPhase("idle")} />}
    {loginCmd && authTab === "cli" && !installed && <Button disabled={installing} onClick={() => {
      setInstalling(true); setError("")
      void window.api.installAgentTypeStreaming(type).then((result) => { throwIfInstallFailed(result); return window.api.refreshLogin(type) }).then((next) => {
        setHealth(next); onChanged(); void login.start()
      }).catch((err) => setError(String(err))).finally(() => setInstalling(false))
    }}>{installing ? t("agents.shared.installing") : t("agents.shared.installAndSignIn")}</Button>}
    <AgentEnvFields agentType={type} modelPath={keyForm ? "key" : "login"} modelReloadKey={String(loggedIn)}
      fields={keyForm ? fields : loginModels}
      values={values} onChange={change} onImport={keyForm ? importValues : undefined} />
    {!keyForm && loginModels.length > 0 && <p className="m-0 text-xs text-muted-foreground">
      {t(loginModels.some((field) => field.required) ? "agents.configureDialog.modelRequiredWithLogin" : "agents.configureDialog.modelWithLogin")}
    </p>}
    {/* A test that can only fail is replaced by how this agent's credential IS verified. */}
    {keyForm && fields.length > 0 && (unprobeable
      ? <div role="note" className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <div>
          <p className="m-0 font-medium text-foreground">{t("agents.credentials.unprobeableTitle")}</p>
          {unprobeableReason && <p className="m-0 mt-1">{t(`agents.credentials.unprobeable.${unprobeableReason}`)}</p>}
        </div>
      </div>
      : <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 px-3.5 py-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          {testResult?.kind === "success"
            ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            : testResult?.kind === "error"
              ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              : <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
          <div className="min-w-0">
            <p className="m-0 text-xs font-medium text-foreground">{t("agents.shared.verifyApiSettings")}</p>
            <p role={testResult ? "status" : undefined} className={testResult
              ? `m-0 mt-0.5 text-2xs leading-relaxed ${testResult.kind === "success" ? "text-emerald-600 dark:text-emerald-400" : testResult.kind === "error" ? "text-destructive" : "text-muted-foreground"}`
              : "m-0 mt-0.5 text-2xs leading-relaxed text-muted-foreground"}>
              {testResult?.message || t("agents.shared.verifyApiSettingsHint")}
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="w-full shrink-0 sm:w-auto" onClick={() => void test()} disabled={testing}>
          {testing && <Loader2 className="size-3.5 animate-spin" />}
          {testing ? t("agents.shared.testing") : t("agents.shared.testConnection")}
        </Button>
      </div>)}
  </div>
}

function bounded<T>(promise: Promise<T>, ms = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("Could not read this computer’s status. Try again.")), ms) })])
    .finally(() => clearTimeout(timer))
}
