import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { useUiStore } from "@renderer/store/ui"
import type { CatalogEntry, EnvField } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

export type WizardStep = "auth" | "test" | "create"
export type AuthTab = "cli" | "key"
export type LoginPhase = "idle" | "awaiting" | "checking"

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
  /** Non-null when the agent can sign in through its own CLI. */
  loginCommand: string | null
  loginPhase: LoginPhase
  setLoginPhase: (phase: LoginPhase) => void
  /** null until the sign-in probe answers — never an optimistic guess. */
  loggedIn: boolean | null
  testing: boolean
  testResult: { ok: boolean; message: string } | null
  agentName: string
  setAgentName: (name: string) => void
  submitting: boolean
  openLoginTerminal: () => Promise<void>
  confirmLogin: () => Promise<void>
  saveAndTest: () => Promise<void>
  createAgent: () => Promise<void>
}

/**
 * Post-install setup wizard state: what the agent needs, what the user has
 * supplied, and the IPC that turns the two into a working agent.
 *
 * The two authentication paths are deliberately independent — an agent that
 * accepts both a CLI sign-in and an API key needs neither to be attempted
 * before the other, so the CLI path skips straight past the connection test
 * (there is no key to test) while the key path runs it.
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
  const [loginPhase, setLoginPhase] = useState<LoginPhase>("idle")
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    message: string
  } | null>(null)
  const [agentName, setAgentName] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const loginCommand = entry?.check_ready?.login_command || null

  useEffect(() => {
    if (!open || !entry) return
    setStep("auth")
    setTestResult(null)
    setLoginPhase("idle")
    setLoggedIn(null)
    setAgentName(`my-${entry.name}`)
    // Default to the tab that asks least of the user: a CLI sign-in needs no
    // secret typed in, so it leads whenever the agent offers one.
    setAuthTab(loginCommand ? "cli" : "key")
    ;(async () => {
      const [envFields, saved] = await Promise.all([
        window.api.getEnvFields(entry.name).catch(() => [] as EnvField[]),
        window.api.getAgentEnv(entry.name).catch(() => ({}) as Record<string, string>),
      ])
      setFields(envFields || [])
      setValues({ ...(saved || {}) })
      // Nothing to configure at all → the wizard is just "name your agent".
      if ((envFields?.length ?? 0) === 0 && !loginCommand) setStep("create")
    })()
    if (loginCommand)
      window.api
        .refreshLogin(entry.name)
        .then((h) => setLoggedIn(h?.logged_in ?? h?.ready ?? false))
        .catch(() => setLoggedIn(false))
  }, [open, entry, loginCommand])

  const openLoginTerminal = useCallback(async () => {
    if (!loginCommand) return
    try {
      await window.api.openTerminal(loginCommand)
      setLoginPhase("awaiting")
    } catch (e: unknown) {
      showToast(
        t("onboarding.wizard.toast.openTerminalFailed", {
          message: (e as Error).message,
        }),
        "error",
      )
    }
  }, [loginCommand, showToast, t])

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

  const saveAndTest = useCallback(async () => {
    if (!entry) return
    setTesting(true)
    setTestResult(null)
    try {
      await window.api.saveAgentEnv(entry.name, values)
      const r = await window.api.testLLM(values)
      if (r.success) {
        setTestResult({
          ok: true,
          message: t("onboarding.wizard.test.okResponded", {
            model: r.model || t("onboarding.wizard.test.model"),
          }),
        })
        setStep("test")
      } else {
        setTestResult({
          ok: false,
          message: r.error || t("onboarding.wizard.test.testFailed"),
        })
      }
    } catch (e: unknown) {
      setTestResult({ ok: false, message: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }, [entry, values, t])

  const createAgent = useCallback(async () => {
    if (!entry) return
    const name = agentName.trim() || `my-${entry.name}`
    setSubmitting(true)
    try {
      await window.api.addAgent({ name, type: entry.name })
      showToast(t("onboarding.wizard.toast.agentCreated", { name }), "success")
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
  }, [entry, agentName, onClose, setCurrentTab, showToast, t])

  return {
    step,
    setStep,
    authTab,
    setAuthTab,
    fields,
    values,
    setValues,
    loginCommand,
    loginPhase,
    setLoginPhase,
    loggedIn,
    testing,
    testResult,
    agentName,
    setAgentName,
    submitting,
    openLoginTerminal,
    confirmLogin,
    saveAndTest,
    createAgent,
  }
}
