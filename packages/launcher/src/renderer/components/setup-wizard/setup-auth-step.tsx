import React from "react"
import { KeyRound, Terminal } from "lucide-react"
import { useTranslation } from "react-i18next"

import { AgentEnvFields } from "@renderer/components/agent-env-fields"
import type { CliLoginApi } from "@renderer/components/agent-auth/use-cli-login"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@renderer/components/ui/tabs"
import { hasModelPicker } from "@renderer/lib/model-fields"
import type { EnvField } from "@renderer/types"

import { WizardCliCard } from "./wizard-cli-card"
import { WizardVerifyError } from "./wizard-verify-error"
import type { AuthTab, LoginPhase } from "./use-setup-wizard"

interface Props {
  /** Agent type id, e.g. "gemini" — decides whether a terminal is the only route. */
  agentType: string
  fields: EnvField[]
  values: Record<string, string>
  onChange: (next: Record<string, string>) => void
  /** The sign-in tab's own values — see `useSetupWizard`. */
  loginValues: Record<string, string>
  onLoginChange: (next: Record<string, string>) => void
  errorMessage?: string | null
  onRetry: () => void
  /** Dual-auth agents (Claude, Codex, Gemini…) offer a CLI login and a key. */
  loginCommand: string | null
  loginPhase: LoginPhase
  loggedIn: boolean | null
  onStartLogin: (opts?: { terminal?: boolean }) => void
  login: CliLoginApi
  onConfirmLogin: () => void
  onCancelAwaiting: () => void
  tab: AuthTab
  onTabChange: (tab: AuthTab) => void
}

/**
 * Step 1 — how this agent authenticates. When it accepts both a CLI sign-in
 * and an API key, the two sit behind tabs: they are alternatives, and the
 * previous stacked layout read as "do both".
 *
 * Each path keeps its explanation, its state and its recovery action inside one
 * card. They used to be spread down the step — description at the top, status
 * in the middle, the button acting on that status somewhere below — so the eye
 * had to travel the whole column to answer "am I connected?".
 */
export function SetupAuthStep({
  agentType,
  fields,
  values,
  onChange,
  loginValues,
  onLoginChange,
  errorMessage,
  onRetry,
  loginCommand,
  loginPhase,
  loggedIn,
  onStartLogin,
  login,
  onConfirmLogin,
  onCancelAwaiting,
  tab,
  onTabChange,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  const cli = loginCommand ? (
    <WizardCliCard
      agentType={agentType}
      loginCommand={loginCommand}
      loginPhase={loginPhase}
      loggedIn={loggedIn}
      onStartLogin={onStartLogin}
      login={login}
      onConfirmLogin={onConfirmLogin}
      onCancelAwaiting={onCancelAwaiting}
    />
  ) : null

  // The model is a setting of both paths, not of the key — an agent signed in
  // through its CLI still has to be told which model to run. Its list here comes
  // from the sign-in, not from the (empty) key form beside it, and so does its
  // value: `loginValues` is what this tab holds, kept apart from the key form's
  // so a relay's model id never shows up as this account's.
  const modelFields = fields.filter((f) => hasModelPicker(agentType, f.name))
  const cliBlock =
    cli && modelFields.length > 0 ? (
      <div className="flex flex-col gap-4">
        {cli}
        <div className="border-t pt-4">
          <AgentEnvFields
            agentType={agentType}
            modelPath="login"
            fields={modelFields}
            values={loginValues}
            onChange={(name, value) =>
              onLoginChange({ ...loginValues, [name]: value })
            }
            idPrefix="setup-env-cli"
          />
          <p className="mt-2 mb-0 text-2xs text-muted-foreground">
            {t("agents.configureDialog.modelWithLogin")}
          </p>
        </div>
      </div>
    ) : (
      cli
    )

  const keyForm =
    fields.length > 0 ? (
      <div className="flex flex-col gap-4">
        <AgentEnvFields
          agentType={agentType}
          modelPath="key"
          fields={fields}
          values={values}
          onChange={(name, value) => onChange({ ...values, [name]: value })}
          idPrefix="setup-env"
        />
        {errorMessage && (
          <WizardVerifyError message={errorMessage} onRetry={onRetry} />
        )}
      </div>
    ) : (
      <p className="m-0 text-xs text-muted-foreground">
        {t("onboarding.wizard.apiConfig.noKeyRequired")}
      </p>
    )

  // Only an agent offering BOTH needs the switch. One path on its own is not a
  // choice, and a single-item tab strip reads as a missing second option.
  const dual = !!cli && fields.length > 0
  const description = dual
    ? tab === "key"
      ? "onboarding.wizard.auth.keyDescription"
      : "onboarding.wizard.auth.dualDescription"
    : cli
      ? "onboarding.wizard.auth.cliDescription"
      : "onboarding.wizard.auth.keyDescription"

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <h2 className="m-0 text-xl font-bold tracking-tight">
          {t("onboarding.wizard.auth.heading")}
        </h2>
        <p className="m-0 mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {t(description)}
        </p>
      </div>

      {!dual ? (
        (cliBlock ?? keyForm)
      ) : (
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
            {cliBlock}
          </TabsContent>
          <TabsContent value="key" className="pt-2">
            {keyForm}
          </TabsContent>
        </Tabs>
      )}

      {/* Reassurance belongs next to the choice it softens. It used to sit in
          the footer, where a sentence of small print beside the actions read as
          a third control. */}
      <p className="m-0 text-2xs text-muted-foreground">
        {t("onboarding.wizard.footer.changeLater")}
      </p>
    </div>
  )
}
