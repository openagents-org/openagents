import React from "react"
import { Check, Loader2, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { CliLoginPanel } from "@renderer/components/agent-auth/cli-login-panel"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { PasswordInput } from "@renderer/components/ui-kit"
import { envFieldHint, envFieldLabel } from "@renderer/lib/agent-meta"
import { cn } from "@renderer/lib/utils"
import type { EnvField, OnboardingAgent } from "@renderer/types"

import { FieldLabel, SectionLabel } from "../onboarding-chrome"
import type { OnboardingAuthApi } from "../use-onboarding-auth"
import { ExternalLink, LoginPanel } from "./login-panel"

export function ApiKeyStep({
  entry,
  auth,
}: {
  entry: OnboardingAgent | null
  auth: OnboardingAuthApi
}): React.JSX.Element {
  const { t } = useTranslation()
  const mode = entry?.authMode ?? "none"
  const hasEnvFields = !!entry && entry.envFields.length > 0

  // Secrets get a row to themselves; the rest (base URL, model…) pair up, which
  // is how the fields group naturally on every agent we ship.
  const secrets = entry?.envFields.filter((f) => f.password) ?? []
  const options = entry?.envFields.filter((f) => !f.password) ?? []

  return (
    <>
      {!entry ? (
        <div className="flex items-center gap-2 py-8 text-xs text-(--text-tertiary)">
          <Loader2 className="size-4 animate-spin" />
          {t("onboarding.flow.apiKey.loadingConfiguration")}
        </div>
      ) : (
        <>
          {mode === "login" && <LoginPanel entry={entry} auth={auth} />}

          {mode === "none" && !hasEnvFields && (
            <div className="rounded-lg border border-(--success-border) bg-(--success-bg) p-5 text-sm text-(--success-text)">
              {t("onboarding.flow.apiKey.noConfigNeeded")}
            </div>
          )}

          {hasEnvFields && (
            <>
              <SectionLabel className={cn(mode === "login" && "mt-9")}>
                {t("onboarding.flow.sections.env")}
              </SectionLabel>

              <div className="flex flex-col gap-5">
                {secrets.map((field) => (
                  <EnvRow key={field.name} field={field} auth={auth} />
                ))}
                {options.length > 0 && (
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    {options.map((field) => (
                      <EnvRow key={field.name} field={field} auth={auth} />
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => void auth.test()}
                  disabled={auth.testing}
                >
                  {auth.testing ? (
                    <>
                      <Loader2 className="animate-spin" />
                      {t("onboarding.flow.apiKey.testing")}
                    </>
                  ) : (
                    t("onboarding.flow.apiKey.testConnection")
                  )}
                </Button>
                {/* Key-mode agents that ALSO ship a login command keep the
                    CLI route available as a secondary action. */}
                {mode !== "login" && entry.loginCommand && (
                  <Button
                    variant="ghost"
                    onClick={() => void auth.startLogin()}
                    disabled={auth.checkingLogin || auth.login.active}
                  >
                    {auth.checkingLogin || auth.login.active
                      ? t("onboarding.flow.apiKey.waitingForLogin")
                      : auth.loggedIn
                        ? t("onboarding.flow.apiKey.reloginViaCli")
                        : t("onboarding.flow.apiKey.orLoginViaCli")}
                  </Button>
                )}
                <TestStatus auth={auth} />
              </div>

              {/* Only for the key-mode agents whose secondary "log in via CLI"
                  button sits above. A login-mode agent (Claude) already has
                  LoginPanel at the top of this step, and LoginPanel renders the
                  same card — without this gate both drew it and the user saw
                  the sign-in twice on one page. Same condition as the button. */}
              {mode !== "login" && auth.login.phase !== "idle" && (
                <CliLoginPanel
                  login={auth.login}
                  onUseTerminal={() => void auth.startLogin({ terminal: true })}
                />
              )}

              {entry.docsUrl && (
                <p className="mt-3 mb-0 text-xs">
                  <ExternalLink href={entry.docsUrl}>
                    {t("onboarding.flow.apiKey.whereKey")}
                  </ExternalLink>
                </p>
              )}
            </>
          )}
        </>
      )}
    </>
  )
}

function EnvRow({
  field,
  auth,
}: {
  field: EnvField
  auth: OnboardingAuthApi
}): React.JSX.Element {
  const { t } = useTranslation()
  const Control = field.password ? PasswordInput : Input
  const id = `onboarding-env-${field.name}`
  // The registry's own `description` is a full sentence written for docs, not
  // a label — it belongs under the input as a hint, with a short translated
  // name up top. See lib/agent-meta.
  const hint = envFieldHint(field, t)
  return (
    <div>
      <FieldLabel
        htmlFor={id}
        label={envFieldLabel(field, t)}
        token={field.name}
        required={field.required}
      />
      <Control
        id={id}
        value={auth.values[field.name] ?? ""}
        onChange={(e) => auth.setValue(field.name, e.target.value)}
        placeholder={
          field.placeholder ||
          field.default ||
          t("onboarding.flow.apiKey.fieldPlaceholder", { name: field.name })
        }
      />
      {hint && (
        <p className="mt-1.5 mb-0 text-2xs leading-relaxed text-(--text-tertiary)">
          {hint}
        </p>
      )}
    </div>
  )
}

/** The strip beside the test button: last result, or what to expect. */
function TestStatus({ auth }: { auth: OnboardingAuthApi }): React.JSX.Element {
  const { t } = useTranslation()
  const { testResult } = auth
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3 py-2 text-xs",
        !testResult && "border-(--border) text-(--text-tertiary)",
        testResult?.ok &&
          "border-(--success-border) bg-(--success-bg) text-(--success-text)",
        testResult &&
          !testResult.ok &&
          "border-(--danger-border) bg-(--danger-bg) text-(--danger-text)",
      )}
    >
      {testResult ? (
        <>
          {testResult.ok ? (
            <Check className="size-3.5 shrink-0" />
          ) : (
            <X className="size-3.5 shrink-0" />
          )}
          <span className="font-medium">
            {testResult.ok
              ? t("onboarding.flow.apiKey.connected")
              : t("onboarding.flow.apiKey.failed")}
          </span>
          {testResult.detail && (
            <span className="truncate opacity-80">— {testResult.detail}</span>
          )}
        </>
      ) : (
        <span className="truncate">{t("onboarding.flow.apiKey.notTested")}</span>
      )}
    </div>
  )
}
