import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  useCliLogin,
  type CliLoginApi,
} from "@renderer/components/agent-auth/use-cli-login"
import type { ToastType } from "@renderer/hooks/useToast"
import { capture } from "@renderer/lib/analytics"
import type { EnvField, OnboardingAgent } from "@renderer/types"

export interface TestResult {
  ok: boolean
  detail?: string
}

export interface OnboardingAuthApi {
  values: Record<string, string>
  setValue: (name: string, value: string) => void
  loggedIn: boolean
  checkingLogin: boolean
  /** CLI presence for login-mode agents: true / false / null-unknown. */
  cliInstalled: boolean | null
  testing: boolean
  testResult: TestResult | null
  saving: boolean
  /** True once the user is committing to the API-key path (see below). */
  usingApiKeyPath: boolean
  /** Required key fields are still empty on the key path — blocks Continue. */
  blocked: boolean
  test: () => Promise<void>
  /** Start the in-app CLI sign-in; `terminal` forces the terminal fallback. */
  startLogin: (opts?: { terminal?: boolean }) => Promise<void>
  /** Live state of that sign-in, for the card to render. */
  login: CliLoginApi
  saveAndContinue: () => Promise<void>
}

function hasMissingRequired(
  fields: EnvField[],
  values: Record<string, string>,
): boolean {
  return fields.some((f) => f.required && !(values[f.name] || "").trim())
}

/**
 * The configure step: env-var values, the CLI-login probe, the connection
 * test, and persisting the result.
 */
export function useOnboardingAuth({
  active,
  entry,
  showToast,
  onSaved,
}: {
  /** True while the configure step is on screen. */
  active: boolean
  entry: OnboardingAgent | null
  showToast: (msg: string, type?: ToastType) => void
  onSaved: () => void
}): OnboardingAuthApi {
  const { t } = useTranslation()
  const [values, setValues] = useState<Record<string, string>>({})
  const [loggedIn, setLoggedIn] = useState(false)
  const [checkingLogin, setCheckingLogin] = useState(false)
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [saving, setSaving] = useState(false)

  const login = useCliLogin({
    agentType: entry?.name ?? null,
    onSuccess: () => {
      setLoggedIn(true)
      setCheckingLogin(false)
      showToast(t("onboarding.flow.toast.signedIn"), "success")
    },
  })

  // Whether the user is taking the API-key path (vs the CLI login). In "env"
  // mode the key is the only path, so always. In "login" mode (dual-auth agents
  // like Claude) the key is OPTIONAL — only treat it as in-use once the user
  // types into a secret field. Non-secret fields are pre-seeded with defaults
  // (base URL / model), so they can't be the signal. When this is false, the
  // required-key validation must NOT gate progress — the user signs in instead.
  const usingApiKeyPath = useMemo(() => {
    if (!entry) return false
    if (entry.authMode === "env") return true
    return entry.envFields.some(
      (f) => f.password && (values[f.name] || "").trim(),
    )
  }, [entry, values])

  // Initialise from the selected agent's resolved auth info. No network
  // round-trips for the field list — the picker already carries the
  // authoritative env fields / login command, so an agent that needs auth is
  // never silently shown as "no configuration needed".
  useEffect(() => {
    if (!active || !entry) return
    let cancelled = false
    setTestResult(null)
    const seed: Record<string, string> = {}
    for (const f of entry.envFields) {
      seed[f.name] = f.password ? "" : f.default || ""
    }
    setValues(seed)
    setLoggedIn(false)
    setCliInstalled(null)
    // Switching agents must not leave the previous one's login card on screen.
    login.reset()
    if (entry.authMode !== "login") return
    setCheckingLogin(true)
    // refreshLogin forces a fresh CLI `status` probe so an EXISTING sign-in is
    // detected the moment the step opens (healthCheck only reads the cache,
    // which is empty on first entry). Falls back to healthCheck for agents
    // without a login probe.
    window.api
      .refreshLogin(entry.name)
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
    return () => {
      cancelled = true
    }
  }, [active, entry, login.reset])

  const setValue = useCallback((name: string, value: string): void => {
    setValues((prev) => ({ ...prev, [name]: value }))
    setTestResult(null)
  }, [])

  const test = useCallback(async (): Promise<void> => {
    if (!entry || entry.envFields.length === 0) return
    if (hasMissingRequired(entry.envFields, values)) {
      showToast(t("onboarding.flow.toast.fillRequiredFields"), "warning")
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const r = await window.api.testLLM(values)
      capture("llm_test_run", { success: r.success, model: r.model || null })
      setTestResult(
        r.success
          ? {
              ok: true,
              detail: r.model
                ? t("onboarding.flow.test.modelResponded", { model: r.model })
                : t("onboarding.flow.test.connectionLooksGood"),
            }
          : { ok: false, detail: r.error || t("onboarding.flow.test.testFailed") },
      )
    } catch (e) {
      setTestResult({ ok: false, detail: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }, [entry, values, showToast, t])

  // The sign-in itself runs INSIDE the launcher (main/cli-login.ts): the
  // authorize URL and the code prompt surface in the card below rather than in
  // a terminal window the user has to go find. The main process keeps probing
  // for five minutes and pushes the result here, so a slow sign-in still lands
  // — the old flow polled for 24s from this hook and then silently gave up.
  const startLogin = useCallback(
    async (opts?: { terminal?: boolean }): Promise<void> => {
      if (!entry?.loginCommand) return
      await login.start(opts)
    },
    [entry, login],
  )

  const saveAndContinue = useCallback(async (): Promise<void> => {
    if (!entry) return
    // Only enforce/save the API-key fields when the user is actually on the
    // key path. In login mode (dual-auth agents like Claude) the key is
    // optional — a user signing in via the CLI must not be blocked by the
    // required key fields (which carry pre-seeded base-URL/model defaults).
    if (!usingApiKeyPath) {
      // login / none modes (no key entered): never block. If the agent isn't
      // actually authed yet, it'll surface when the agent is started later.
      onSaved()
      return
    }
    if (hasMissingRequired(entry.envFields, values)) {
      showToast(t("onboarding.flow.toast.fillRequiredFields"), "warning")
      return
    }
    setSaving(true)
    try {
      await window.api.saveAgentEnv(entry.name, values)
      onSaved()
    } catch (e) {
      showToast((e as Error).message, "error")
    } finally {
      setSaving(false)
    }
  }, [entry, values, usingApiKeyPath, onSaved, showToast, t])

  return {
    values,
    setValue,
    loggedIn,
    checkingLogin,
    cliInstalled,
    testing,
    testResult,
    saving,
    usingApiKeyPath,
    blocked:
      usingApiKeyPath && !!entry && hasMissingRequired(entry.envFields, values),
    test,
    startLogin,
    login,
    saveAndContinue,
  }
}
