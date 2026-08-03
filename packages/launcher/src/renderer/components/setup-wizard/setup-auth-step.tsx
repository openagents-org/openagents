import React, { useState } from "react"
import { AlertCircle, ChevronDown, ChevronRight, KeyRound, Terminal } from "lucide-react"
import { useTranslation } from "react-i18next"

import { AgentEnvFields } from "@renderer/components/agent-env-fields"
import { CliLoginBlock } from "@renderer/components/agent-auth/auth-status"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@renderer/components/ui/tabs"
import { translateTestError } from "@renderer/lib/test-error"
import type { EnvField } from "@renderer/types"

import type { AuthTab, LoginPhase } from "./use-setup-wizard"

interface Props {
  fields: EnvField[]
  values: Record<string, string>
  onChange: (next: Record<string, string>) => void
  errorMessage?: string | null
  /** Dual-auth agents (Claude, Gemini…) expose a CLI login next to the key. */
  loginCommand: string | null
  loginPhase: LoginPhase
  loggedIn: boolean | null
  onOpenTerminal: () => void
  onConfirmLogin: () => void
  onCancelAwaiting: () => void
  tab: AuthTab
  onTabChange: (tab: AuthTab) => void
}

/**
 * Step 1 — how this agent authenticates. When it accepts both a CLI sign-in
 * and an API key, the two sit behind tabs: they are alternatives, and the
 * previous stacked layout read as "do both".
 */
export function SetupAuthStep({
  fields,
  values,
  onChange,
  errorMessage,
  loginCommand,
  loginPhase,
  loggedIn,
  onOpenTerminal,
  onConfirmLogin,
  onCancelAwaiting,
  tab,
  onTabChange,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  const cli = loginCommand ? (
    <CliLoginBlock
      loginCmd={loginCommand}
      loginPhase={loginPhase}
      loggedIn={loggedIn}
      onOpenTerminal={onOpenTerminal}
      onConfirmLogin={onConfirmLogin}
      onCancelAwaiting={onCancelAwaiting}
    />
  ) : null

  const keyForm =
    fields.length > 0 ? (
      <div className="flex flex-col gap-4">
        <p className="m-0 text-2xs text-muted-foreground">
          {t("onboarding.wizard.apiConfig.savedLocallyPrefix")}
          <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono">
            ~/.openagents/env/
          </code>
          {t("onboarding.wizard.apiConfig.savedLocallySuffix")}
        </p>
        <AgentEnvFields
          fields={fields}
          values={values}
          onChange={(name, value) => onChange({ ...values, [name]: value })}
          idPrefix="setup-env"
        />
        {errorMessage && <TestError message={errorMessage} />}
      </div>
    ) : (
      <p className="m-0 text-xs text-muted-foreground">
        {t("onboarding.wizard.apiConfig.noKeyRequired")}
      </p>
    )

  if (!cli) return keyForm
  if (fields.length === 0) return cli

  return (
    <Tabs value={tab} onValueChange={(v) => onTabChange(v as AuthTab)}>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="cli" className="text-xs">
          <Terminal />
          {t("onboarding.wizard.auth.cliTab")}
        </TabsTrigger>
        <TabsTrigger value="key" className="text-xs">
          <KeyRound />
          {t("onboarding.wizard.auth.keyTab")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="cli" className="pt-2">
        {cli}
      </TabsContent>
      <TabsContent value="key" className="pt-2">
        {keyForm}
      </TabsContent>
    </Tabs>
  )
}

/**
 * A failed connection test, translated. The raw error is available but folded
 * away — it is usually a stack-shaped string that answers nothing on its own.
 */
function TestError({ message }: { message: string }): React.JSX.Element {
  const { t } = useTranslation()
  const { title, hint, raw } = translateTestError(message)
  const [open, setOpen] = useState(false)
  const hasDetails = !!raw && raw.trim() !== title.trim() && raw.trim() !== hint?.trim()

  return (
    <div
      role="alert"
      className="rounded-lg border border-(--danger-border) bg-(--danger-bg) px-3.5 py-3"
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-(--danger-text)" />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-semibold text-(--danger-text)">{title}</p>
          {hint && (
            <p className="m-0 mt-1 text-xs leading-snug text-muted-foreground">{hint}</p>
          )}
          {hasDetails && (
            <>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="mt-1.5 inline-flex cursor-pointer items-center gap-0.5 border-0 bg-transparent p-0 text-2xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {open ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                {open
                  ? t("onboarding.wizard.apiConfig.hideDetails")
                  : t("onboarding.wizard.apiConfig.showDetails")}
              </button>
              {open && (
                <pre className="m-0 mt-1.5 max-h-32 overflow-auto rounded-sm bg-muted px-2 py-1.5 font-mono text-2xs break-all whitespace-pre-wrap">
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
