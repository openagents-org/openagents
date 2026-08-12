import React, { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { KeyRound, Terminal } from "lucide-react"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@renderer/components/ui/tabs"
import { Button } from "@renderer/components/ui/button"
import {
  AuthStatusBanner,
  CliLoginBlock,
  LoginStatusCard,
} from "@renderer/components/agent-auth/auth-status"
import { CliLoginPanel } from "@renderer/components/agent-auth/cli-login-panel"
import { useCliLogin } from "@renderer/components/agent-auth/use-cli-login"
import { ConfigureWorkDir } from "./configure-workdir"
import { AgentEnvFields } from "@renderer/components/agent-env-fields"
import { isCliLoginDetected } from "@renderer/lib/agent-auth"
import { capture } from "@renderer/lib/analytics"
import type { EnvField } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

export function ConfigureDialog({
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
  // The sign-in itself runs in-app (main/cli-login.ts). On success it lands in
  // the same place the terminal path's "I've signed in" button did — clearing
  // any stale API key and re-probing — so both paths leave identical state.
  const login = useCliLogin({
    agentType,
    onSuccess: () => void confirmLogin(),
  })
  // A CLI that had to be given a real terminal reports nothing back, so that
  // path keeps the old contract: the user tells us when they're done.
  useEffect(() => {
    if (login.phase === "terminal") setLoginPhase("awaiting")
  }, [login.phase])
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
  // Which half of a dual-auth agent is on screen. CLI first: it is the path
  // that needs no secret typed in.
  const [authTab, setAuthTab] = useState<"cli" | "key">("cli")

  const setFieldValue = useCallback((name: string, value: string): void => {
    setValues((prev) => ({ ...prev, [name]: value }))
  }, [])

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
    setAuthTab("cli")
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
                const ok = isCliLoginDetected(
                  h,
                  hasFields,
                )
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
      const ok = isCliLoginDetected(
        h,
        fields.length > 0,
      )
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

  // Shared by the tabbed (dual-auth) and the login-only layouts below.
  const cliLoginBlock = loginCmd ? (
    <CliLoginBlock
      agentType={agentType}
      loginCmd={loginCmd}
      loginPhase={loginPhase}
      loggedIn={loggedIn}
      login={login}
      onStartLogin={(opts) => void login.start(opts)}
      onConfirmLogin={confirmLogin}
      onCancelAwaiting={() => setLoginPhase("idle")}
    />
  ) : null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl" showCloseButton={false}>
      <DialogHeader className="pt-3 pb-1">
        <DialogTitle className="mb-1.5">
          {t("agents.configureDialog.title", { name: agentName || agentType })}
        </DialogTitle>
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
      </DialogHeader>

      <DialogBody>
        {!loading && agentName && (
          <ConfigureWorkDir
            value={workDir}
            initial={workDirInitial}
            saving={workDirSaving}
            onChange={setWorkDir}
            onBrowse={() => void browseWorkDir()}
            onSave={() => void saveWorkDir()}
          />
        )}
        {loading ? (
          <p className="loading-text m-0">
            {t("agents.configureDialog.loadingConfig")}
          </p>
        ) : noConfig ? null : loginCmd && fields.length === 0 ? (
          <>
            <AuthStatusBanner authInfo={authInfo} authLabels={authLabels} />
            <LoginStatusCard loginPhase={loginPhase} loggedIn={loggedIn} />
            {login.phase !== "idle" && (
              <CliLoginPanel
                login={login}
                onUseTerminal={() => void login.start({ terminal: true })}
              />
            )}
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
            {/* Dual-auth agents (Claude, Gemini…) accept EITHER a CLI sign-in or
                an API key. Tabs say that outright; the previous stacked layout
                showed both at once and read as "do both". */}
            {loginCmd && fields.length > 0 ? (
              <Tabs
                value={authTab}
                onValueChange={(v) => setAuthTab(v as "cli" | "key")}
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="cli" className="text-xs">
                    <Terminal />
                    {t("agents.list.health.cliLogin")}
                  </TabsTrigger>
                  <TabsTrigger value="key" className="text-xs">
                    <KeyRound />
                    {t("agents.list.health.apiKey")}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="cli" className="pt-1">
                  {cliLoginBlock}
                </TabsContent>
                <TabsContent value="key" className="pt-1">
                  <AgentEnvFields
                    fields={fields}
                    values={values}
                    onChange={setFieldValue}
                    idPrefix="agent-config"
                  />
                </TabsContent>
              </Tabs>
            ) : loginCmd ? (
              cliLoginBlock
            ) : (
              <AgentEnvFields
                fields={fields}
                values={values}
                onChange={setFieldValue}
                idPrefix="agent-config"
              />
            )}
          </>
        )}
      </DialogBody>

      {!loading && (
        <DialogFooter>
          {noConfig ? (
            <>
              <Button variant="outline" onClick={onClose}>
                {t("agents.configureDialog.close")}
              </Button>
            </>
          ) : loginCmd && fields.length === 0 ? (
            loginPhase === "awaiting" ? (
              <>
                <Button variant="default" onClick={confirmLogin}>
                  {t("agents.configureDialog.finishedSigningIn")}
                </Button>
                <Button variant="outline" onClick={() => setLoginPhase("idle")}>
                  {t("agents.configureDialog.notYet")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="default"
                  disabled={loginPhase === "checking" || login.active}
                  onClick={() => void login.start()}
                >
                  {loggedIn
                    ? t("agents.configureDialog.reLogin")
                    : t("agents.configureDialog.login")}
                </Button>
                <Button variant="outline" onClick={onClose}>
                  {t("agents.configureDialog.close")}
                </Button>
              </>
            )
          ) : (
            <>
              <Button variant="default" data-testid="cfg-save" onClick={save}>
                {t("agents.configureDialog.save")}
              </Button>
              <Button variant="outline"
                onClick={testConnection}
                disabled={testStatus === "loading"}
              >
                {testStatus === "loading"
                  ? t("agents.configureDialog.testing")
                  : t("agents.configureDialog.testConnection")}
              </Button>
              <Button variant="outline" onClick={onClose}>
                {t("agents.configureDialog.cancel")}
              </Button>
            </>
          )}
        </DialogFooter>
      )}
      </DialogContent>
    </Dialog>
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
