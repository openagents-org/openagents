import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  useCliLogin,
  type CliLoginApi,
} from "@renderer/components/agent-auth/use-cli-login"
import { useAgentsStore } from "@renderer/store/agents"
import { useUiStore } from "@renderer/store/ui"
import type { CatalogEntry, EnvField } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

export type WizardStep = "auth" | "create"
export type AuthTab = "cli" | "key"
export type LoginPhase = "idle" | "awaiting" | "checking"

/** Outcome of the probe that runs inside the save action. */
export interface VerifyResult {
  ok: boolean
  message: string
  /** The model that answered — the one fact worth repeating back on success. */
  model?: string
}

interface Options {
  entry: CatalogEntry | null
  open: boolean
  onClose: () => void
  showToast: (msg: string, type?: ToastType) => void
}

interface SetupWizardState {
  step: WizardStep
  setStep: (step: WizardStep) => void
  authTab: AuthTab
  setAuthTab: (tab: AuthTab) => void
  fields: EnvField[]
  values: Record<string, string>
  setValues: (next: Record<string, string>) => void
  /**
   * The sign-in path's own values. Only the model fields live here — the CLI
   * tab has no key to ask for — and they are kept apart from `values` so a
   * relay's model id never turns up under an account that has never served it.
   */
  loginValues: Record<string, string>
  setLoginValues: (next: Record<string, string>) => void
  /** Non-null when the agent can sign in through its own CLI. */
  loginCommand: string | null
  loginPhase: LoginPhase
  setLoginPhase: (phase: LoginPhase) => void
  /** null until the sign-in probe answers — never an optimistic guess. */
  loggedIn: boolean | null
  testing: boolean
  testResult: VerifyResult | null
  agentName: string
  setAgentName: (name: string) => void
  submitting: boolean
  /** The workspace this device is paired with, or null for local-only. */
  pairedWorkspace: { slug: string; name: string | null } | null
  /** Whether the new agent joins that workspace on creation (default on). */
  connectOnCreate: boolean
  setConnectOnCreate: (v: boolean) => void
  /** Start the in-app CLI sign-in; `terminal` forces the terminal fallback. */
  startLogin: (opts?: { terminal?: boolean }) => Promise<void>
  /** Live state of that sign-in, for the card to render. */
  login: CliLoginApi
  confirmLogin: () => Promise<void>
  saveAndContinue: () => Promise<void>
  /** The sign-in path's step-1 action: persist its model choice, then move on. */
  continueWithLogin: () => Promise<void>
  createAgent: () => Promise<void>
}

/**
 * Post-install setup wizard state: what the agent needs, what the user has
 * supplied, and the IPC that turns the two into a working agent.
 *
 * Two steps, not three. Verifying a key was its own page for as long as it was
 * its own button, and it earned neither — the probe has no input of its own and
 * nothing to decide, so it now runs inside the save action and reports back
 * into the card the user was already looking at. A pass moves the wizard on; a
 * failure leaves the form exactly where it was, with the reason next to it.
 *
 * The two authentication paths stay independent — an agent that accepts both a
 * CLI sign-in and an API key needs neither attempted before the other, so the
 * CLI path reaches `create` through its own sign-in probe and never runs the
 * key probe at all (there is no key to probe).
 */
export function useSetupWizard({
  entry,
  open,
  onClose,
  showToast,
}: Options): SetupWizardState {
  const { t } = useTranslation()
  const setCurrentTab = useUiStore((s) => s.setCurrentTab)

  const [step, setStep] = useState<WizardStep>("auth")
  const [authTab, setAuthTab] = useState<AuthTab>("cli")
  const [fields, setFields] = useState<EnvField[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [loginValues, setLoginValues] = useState<Record<string, string>>({})
  const [loginPhase, setLoginPhase] = useState<LoginPhase>("idle")
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<VerifyResult | null>(null)
  const [agentName, setAgentName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [pairedWorkspace, setPairedWorkspace] = useState<{
    slug: string
    name: string | null
  } | null>(null)
  const [connectOnCreate, setConnectOnCreate] = useState(true)

  const loginCommand = entry?.check_ready?.login_command || null

  const login = useCliLogin({
    agentType: entry?.name ?? null,
    onSuccess: () => {
      setLoggedIn(true)
      setLoginPhase("idle")
      setStep("create")
    },
  })

  useEffect(() => {
    if (!open || !entry) return
    setStep("auth")
    setTestResult(null)
    setLoginPhase("idle")
    login.reset()
    setLoggedIn(null)
    setAgentName(`my-${entry.name}`)
    // Default to the tab that asks least of the user: a CLI sign-in needs no
    // secret typed in, so it leads whenever the agent offers one.
    setAuthTab(loginCommand ? "cli" : "key")
    setConnectOnCreate(true)
    // The Marketplace funnel used to dead-end local-only; with pairing-first
    // the wizard finishes the job by binding to the paired workspace.
    window.api
      .getNodeStatus()
      .then((st) =>
        setPairedWorkspace(
          st?.workspaceSlug
            ? { slug: st.workspaceSlug, name: st.workspaceName || null }
            : null,
        ),
      )
      .catch(() => setPairedWorkspace(null))
    ;(async () => {
      const [envFields, saved] = await Promise.all([
        window.api.getEnvFields(entry.name).catch(() => [] as EnvField[]),
        window.api.getAgentEnv(entry.name).catch(() => ({}) as Record<string, string>),
      ])
      setFields(envFields || [])
      setValues({ ...(saved || {}) })
      // A saved model belongs to whichever path configured it. A key or base
      // URL on file means these values came off the API form — carrying that
      // model into the sign-in tab shows a relay's model id under an account
      // that has never served it, which is exactly what an uninstall that kept
      // its data left behind. With no key on file the saved model IS the
      // sign-in path's, so it stays.
      const configuredByKey = (envFields || []).some(
        (f) =>
          /(API_KEY|_TOKEN|BASE_URL)$/.test(f.name) &&
          ((saved || {})[f.name] || "").trim(),
      )
      setLoginValues(configuredByKey ? {} : { ...(saved || {}) })
      // Nothing to configure at all → the wizard is just "name your agent".
      if ((envFields?.length ?? 0) === 0 && !loginCommand) setStep("create")
    })()
    if (loginCommand)
      window.api
        .refreshLogin(entry.name)
        .then((h) => setLoggedIn(h?.logged_in ?? h?.ready ?? false))
        .catch(() => setLoggedIn(false))
  }, [open, entry, loginCommand, login.reset])

  // A CLI that had to be given a real terminal (hermes, gemini) reports nothing
  // back, so the flow reverts to the old contract: ask the user to confirm when
  // they're done. `awaiting` is what shows those buttons.
  useEffect(() => {
    if (login.phase === "terminal") setLoginPhase("awaiting")
  }, [login.phase])

  // The sign-in runs inside the launcher (main/cli-login.ts) and reports back;
  // "awaiting" is now only for the terminal fallback, where there is no
  // completion signal and the user has to tell us they're done.
  const startLogin = useCallback(
    async (opts?: { terminal?: boolean }) => {
      if (!loginCommand) return
      await login.start(opts)
    },
    [loginCommand, login],
  )

  /** The terminal login has no completion callback — ask, then verify. */
  const confirmLogin = useCallback(async () => {
    if (!entry) return
    setLoginPhase("checking")
    try {
      const h = await window.api.refreshLogin(entry.name)
      const ok = h?.logged_in ?? h?.ready ?? false
      setLoggedIn(ok)
      if (ok) setStep("create")
      else showToast(t("onboarding.wizard.auth.couldntConfirm"), "warning")
    } catch {
      setLoggedIn(false)
      showToast(t("onboarding.wizard.auth.couldntConfirm"), "error")
    } finally {
      setLoginPhase("idle")
    }
  }, [entry, showToast, t])

  /**
   * The step-1 primary action: persist the key, prove it works, move on. The
   * failure branch deliberately does NOT toast — the user is mid-form, and an
   * error that lands away from the field it is about is an error they have to
   * go hunting for. It stays in `testResult` for the card to render.
   */
  const saveAndContinue = useCallback(async () => {
    if (!entry) return
    setTesting(true)
    setTestResult(null)
    try {
      await window.api.saveAgentEnv(entry.name, values)
      const r = await window.api.testLLM(values)
      if (r.success) {
        setTestResult({
          ok: true,
          model: r.model,
          message: t("onboarding.wizard.verify.ok"),
        })
        setStep("create")
      } else {
        setTestResult({
          ok: false,
          message: r.error || t("onboarding.wizard.verify.failed"),
        })
      }
    } catch (e: unknown) {
      setTestResult({ ok: false, message: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }, [entry, values, t])

  /**
   * The sign-in path's step-1 action. It has no key to probe, but it can carry
   * a model choice — which used to be dropped on the floor, because this button
   * only ever advanced the step. Blank values are left alone rather than
   * written through: an empty model means "whatever the account defaults to",
   * and the core's env save reads a blank as "delete this key".
   */
  const continueWithLogin = useCallback(async () => {
    if (!entry) return
    const filled = Object.fromEntries(
      Object.entries(loginValues).filter(([, v]) => (v || "").trim()),
    )
    if (Object.keys(filled).length) {
      try {
        await window.api.saveAgentEnv(entry.name, filled)
      } catch (e: unknown) {
        showToast((e as Error).message, "error")
        return
      }
    }
    setStep("create")
  }, [entry, loginValues, showToast])

  const createAgent = useCallback(async () => {
    if (!entry) return
    const name = agentName.trim() || `my-${entry.name}`
    setSubmitting(true)
    try {
      await window.api.addAgent({ name, type: entry.name })
      // Refresh the shared list right away: the Marketplace decides whether to
      // offer this wizard from it, and nothing else polls agents, so without
      // this the detail page kept offering "Setup wizard" for the agent that
      // was just created until the user visited another tab.
      await window.api
        .listAgents()
        .then((a) => useAgentsStore.getState().setAgents(a))
        .catch(() => {})
      showToast(t("onboarding.wizard.toast.agentCreated", { name }), "success")
      if (pairedWorkspace && connectOnCreate) {
        try {
          await window.api.connectWorkspace(name, pairedWorkspace.slug)
          window.api.signalReload()
          showToast(
            t("onboarding.wizard.toast.connectedTo", {
              name: pairedWorkspace.name || pairedWorkspace.slug,
            }),
            "success",
          )
        } catch (e: unknown) {
          // The agent exists either way — surface the failed bind and let the
          // Agents page finish the job.
          showToast((e as Error).message, "warning")
        }
      }
      onClose()
      setCurrentTab("agents")
    } catch (e: unknown) {
      showToast(
        t("onboarding.wizard.toast.createFailed", { message: (e as Error).message }),
        "error",
      )
    } finally {
      setSubmitting(false)
    }
  }, [
    entry,
    agentName,
    pairedWorkspace,
    connectOnCreate,
    onClose,
    setCurrentTab,
    showToast,
    t,
  ])

  return {
    step,
    setStep,
    authTab,
    setAuthTab,
    fields,
    values,
    setValues,
    loginValues,
    setLoginValues,
    loginCommand,
    loginPhase,
    setLoginPhase,
    loggedIn,
    testing,
    testResult,
    agentName,
    setAgentName,
    submitting,
    pairedWorkspace,
    connectOnCreate,
    setConnectOnCreate,
    startLogin,
    login,
    confirmLogin,
    saveAndContinue,
    continueWithLogin,
    createAgent,
  }
}
