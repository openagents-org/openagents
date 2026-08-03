import React, { useState } from "react"
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Terminal,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "../ui/button"
import { AgentEnvFields } from "../agent-env-fields"
import { translateTestError } from "../../lib/test-error"
import type { EnvField } from "../../types"

/** Inline command/path chip. A bare <code> only changes the font family. */
const INLINE_CODE = "rounded-sm bg-accent px-1.5 py-0.5 font-mono text-2xs"

interface BodyProps {
  fields: EnvField[]
  values: Record<string, string>
  onChange: (next: Record<string, string>) => void
  errorMessage?: string | null
  // Dual-auth agents (e.g. Claude) expose a CLI login alongside the API key.
  // When present, offer it as an alternative to entering a key.
  loginCommand?: string | null
  onLogin?: () => void
  onContinueWithoutKey?: () => void
}

/**
 * Step 1 of the post-install wizard — collect API keys / endpoint / token
 * declared by the agent's env_config. Password fields use PasswordInput so
 * secrets never appear plain in the DOM (per stage.md §2.2 security note).
 */
export function SetupApiConfigBody({
  fields,
  values,
  onChange,
  errorMessage,
  loginCommand,
  onLogin,
  onContinueWithoutKey,
}: BodyProps): React.JSX.Element {
  const { t } = useTranslation()
  const loginBlock =
    loginCommand && onLogin ? (
      <div className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-3.5">
        <div className="mb-3 flex items-start gap-2.5">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Terminal className="size-4" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-semibold">
              {t("onboarding.wizard.apiConfig.signInWithCli")}
            </p>
            <p className="m-0 mt-1 mb-0 text-xs leading-relaxed text-muted-foreground">
              {t("onboarding.wizard.apiConfig.opensTerminalPrefix")}
              <code className={INLINE_CODE}>{loginCommand}</code>
              {t("onboarding.wizard.apiConfig.opensTerminalSuffix")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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

  if (fields.length === 0) {
    return (
      <>
        {loginBlock}
        <p className="m-0 text-xs text-muted-foreground">
          {t("onboarding.wizard.apiConfig.noKeyRequired")}
        </p>
      </>
    )
  }

  return (
    <>
      {loginBlock}
      {apiKeyDivider}
      <p className="m-0 text-xs text-muted-foreground">
        {t("onboarding.wizard.apiConfig.savedLocallyPrefix")}
        <code className={INLINE_CODE}>~/.openagents/env/</code>
        {t("onboarding.wizard.apiConfig.savedLocallySuffix")}
      </p>
      <AgentEnvFields
        fields={fields}
        values={values}
        onChange={(name, value) => onChange({ ...values, [name]: value })}
        idPrefix="setup-env"
      />
      {errorMessage && <TestErrorCard message={errorMessage} />}
    </>
  )
}

/** Buttons bare, so DialogFooter's shared row layout applies to them. */
export function SetupApiConfigFooter({
  hasFields,
  testing,
  onSubmit,
  onSkip,
}: {
  hasFields: boolean
  testing: boolean
  onSubmit: () => void
  onSkip: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <Button variant="outline" onClick={onSkip}>
        {t("onboarding.wizard.apiConfig.skip")}
      </Button>
      <Button onClick={onSubmit} disabled={testing}>
        {testing
          ? t("onboarding.wizard.apiConfig.testing")
          : hasFields
            ? t("onboarding.wizard.apiConfig.saveAndTest")
            : t("onboarding.wizard.apiConfig.continue")}
      </Button>
    </>
  )
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
