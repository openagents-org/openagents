import React, { useState } from "react"
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Terminal,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Input } from "../shadcn/input"
import { PasswordInput } from "../ui-kit"
import { Button } from "../shadcn/button"
import { translateTestError } from "../../lib/test-error"
import type { EnvField } from "../../types"
import { WizardStepShell } from "./WizardStepShell"

interface SetupApiConfigProps {
  fields: EnvField[]
  values: Record<string, string>
  onChange: (next: Record<string, string>) => void
  testing: boolean
  errorMessage?: string | null
  onSubmit: () => void
  onSkip: () => void
  // Dual-auth agents (e.g. Claude) expose a CLI login alongside the API key.
  // When present, offer it as an alternative to entering a key.
  loginCommand?: string | null
  onLogin?: () => void
  onContinueWithoutKey?: () => void
  section?: "all" | "body" | "footer"
}

/**
 * Step 1 of the post-install wizard — collect API keys / endpoint / token
 * declared by the agent's env_config. Password fields use PasswordInput so
 * secrets never appear plain in the DOM (per stage.md §2.2 security note).
 */
export function SetupApiConfig({
  fields,
  values,
  onChange,
  testing,
  errorMessage,
  onSubmit,
  onSkip,
  loginCommand,
  onLogin,
  onContinueWithoutKey,
  section = "all",
}: SetupApiConfigProps): React.JSX.Element {
  const { t } = useTranslation()
  const loginBlock =
    loginCommand && onLogin ? (
      <div className="rounded-sm border border-(--accent)/35 bg-(--accent-bg)/60 px-3.5 py-3">
        <div className="flex items-start gap-2.5 mb-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--accent)/15 text-(--accent)">
            <Terminal className="h-4 w-4" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-semibold text-(--text-primary)">
              {t("onboarding.wizard.apiConfig.signInWithCli")}
            </p>
            <p className="hint m-0 mt-1 mb-0 leading-snug">
              {t("onboarding.wizard.apiConfig.opensTerminalPrefix")}
              <code>{loginCommand}</code>
              {t("onboarding.wizard.apiConfig.opensTerminalSuffix")}
            </p>
          </div>
        </div>
        <div className="form-actions mt-0 flex-wrap">
          <Button variant="default" onClick={onLogin}>
            {t("onboarding.wizard.apiConfig.signIn")}
          </Button>
          {onContinueWithoutKey && (
            <Button variant="outline" onClick={onContinueWithoutKey}>
              {t("onboarding.wizard.apiConfig.continueWithoutKey")}
            </Button>
          )}
        </div>
      </div>
    ) : null

  const apiKeyDivider = loginBlock ? (
    <div className="flex items-center gap-2 text-2xs font-medium uppercase tracking-wide text-(--text-tertiary)">
      <span className="h-px flex-1 bg-(--border)" />
      <KeyRound className="h-3 w-3" />
      <span>{t("onboarding.wizard.apiConfig.orUseApiKey")}</span>
      <span className="h-px flex-1 bg-(--border)" />
    </div>
  ) : null

  const actionButtons = (
    <div className="form-actions mt-0">
      <Button variant="default" onClick={onSubmit} disabled={testing}>
        {testing
          ? t("onboarding.wizard.apiConfig.testing")
          : fields.length === 0
            ? t("onboarding.wizard.apiConfig.continue")
            : t("onboarding.wizard.apiConfig.saveAndTest")}
      </Button>
      <Button variant="outline" onClick={onSkip}>{t("onboarding.wizard.apiConfig.skip")}</Button>
    </div>
  )

  if (fields.length === 0) {
    const body = (
      <>
        {loginBlock}
        <p className="hint m-0">
          {t("onboarding.wizard.apiConfig.noKeyRequired")}
        </p>
      </>
    )
    const footer = actionButtons
    if (section === "body") return body
    if (section === "footer") return footer
    return <WizardStepShell body={body} footer={footer} />
  }

  const body = (
    <>
      {loginBlock}
      {apiKeyDivider}
      <p className="hint m-0">
        {t("onboarding.wizard.apiConfig.savedLocallyPrefix")}
        <code>~/.openagents/env/</code>
        {t("onboarding.wizard.apiConfig.savedLocallySuffix")}
      </p>
      {fields.map((f) => {
        const FieldInput = f.password ? PasswordInput : Input
        return (
          <div className="form-group mb-0" key={f.name}>
            <label>
              {f.description || f.name}
              {f.required && <span className="required"> *</span>}
            </label>
            <FieldInput
              value={values[f.name] ?? f.default ?? ""}
              onChange={(e) =>
                onChange({ ...values, [f.name]: e.target.value })
              }
              placeholder={
                f.placeholder ||
                t("onboarding.wizard.apiConfig.fieldPlaceholder", {
                  name: f.name,
                })
              }
            />
          </div>
        )
      })}
      {errorMessage && <TestErrorCard message={errorMessage} />}
    </>
  )

  const footer = actionButtons

  if (section === "body") return body
  if (section === "footer") return footer
  return <WizardStepShell body={body} footer={footer} />
}

function TestErrorCard({ message }: { message: string }): React.JSX.Element {
  const { t } = useTranslation()
  const { title, hint, raw } = translateTestError(message)
  const [showDetails, setShowDetails] = useState(false)
  // Only offer the "Show details" toggle when the raw error contains
  // information beyond what's already in the title — no point expanding to
  // see the same text twice.
  const hasExtraDetails =
    !!raw && raw.trim() !== title.trim() && raw.trim() !== hint?.trim()

  return (
    <div
      role="alert"
      className="rounded-(--radius-sm) border border-(--danger)/30 bg-(--danger-bg) px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <AlertCircle
          className="w-4 h-4 mt-0.5 shrink-0 text-(--danger-text)"
          strokeWidth={2}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-(--danger-text)">
            {title}
          </div>
          {hint && (
            <div className="text-xs mt-1 text-(--text-secondary) leading-snug">
              {hint}
            </div>
          )}
          {hasExtraDetails && (
            <>
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className="mt-1.5 inline-flex items-center gap-0.5 text-2xs text-(--text-tertiary) hover:text-(--text-secondary) transition-colors cursor-pointer bg-transparent border-0 p-0"
              >
                {showDetails ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                {showDetails
                  ? t("onboarding.wizard.apiConfig.hideDetails")
                  : t("onboarding.wizard.apiConfig.showDetails")}
              </button>
              {showDetails && (
                <pre className="mt-1.5 text-2xs font-mono text-(--text-tertiary) whitespace-pre-wrap break-all max-h-32 overflow-auto bg-(--bg-input)/50 rounded-sm px-2 py-1.5 m-0">
                  {raw}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
