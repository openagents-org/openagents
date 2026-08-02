import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangle, KeyRound, Loader2 } from "lucide-react"
import { Button } from "../../ui/button"
import { PasswordInput } from "../../ui-kit"
import { cn } from "../../../lib/utils"
import { isWindows } from "../onboarding-shared"
import type { OnboardingAgent } from "../../../types"
import { StepHeader } from "../onboarding-chrome"
import { Input } from "../../ui/input"

export function ApiKeyStep({
  entry,
  values,
  onChangeValue,
  onTest,
  onLogin,
  testing,
  testResult,
  loggedIn,
  checkingLogin,
  cliInstalled,
}: {
  entry: OnboardingAgent | null
  values: Record<string, string>
  onChangeValue: (name: string, value: string) => void
  onTest: () => void
  onLogin: () => void
  testing: boolean
  testResult: null | { ok: boolean; detail?: string }
  loggedIn: boolean
  checkingLogin: boolean
  cliInstalled: boolean | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const label =
    entry?.label || entry?.name || t("onboarding.flow.apiKey.thisAgent")
  const mode = entry?.authMode ?? "none"
  const hasLogin = !!entry?.loginCommand
  const hasEnvFields = !!entry && entry.envFields.length > 0
  const subtitle =
    mode === "env"
      ? t("onboarding.flow.apiKey.subtitleEnv", { label })
      : mode === "login"
        ? hasEnvFields
          ? t("onboarding.flow.apiKey.subtitleLoginWithKey", { label })
          : t("onboarding.flow.apiKey.subtitleLogin", { label })
        : t("onboarding.flow.apiKey.subtitleNone", { label })

  // Claude Code refuses to run under cmd.exe on Windows; the launcher opens
  // PowerShell, but if the CLI also needs bash the user must have Git for
  // Windows. Surface that up front instead of a cryptic terminal error.
  const showWindowsShellNote =
    isWindows && hasLogin && /^claude\b/.test(entry?.loginCommand || "")

  // Reusable: the env-field inputs (used as the primary view in "env" mode and
  // as the optional "prefer an API key" section inside "login" mode).
  const envInputs = entry ? (
    <div className="flex flex-col gap-4">
      {entry.envFields.map((f) => {
        const FieldInput = f.password ? PasswordInput : Input
        const value = values[f.name] ?? ""
        return (
          <div key={f.name}>
            <label className="block text-xs font-medium mb-1.5">
              {f.description || f.name}
              {f.required && (
                <span className="text-(--danger-text) ml-0.5">*</span>
              )}
              <span className="ml-2 text-3xs text-(--text-tertiary) font-mono">
                {f.name}
              </span>
            </label>
            <FieldInput
              value={value}
              onChange={(e) => onChangeValue(f.name, e.target.value)}
              placeholder={
                f.placeholder ||
                f.default ||
                t("onboarding.flow.apiKey.fieldPlaceholder", { name: f.name })
              }
            />
          </div>
        )
      })}
    </div>
  ) : null

  const testRow = (
    <div className="flex items-center gap-3 mt-4 flex-wrap">
      <Button variant="outline" size="sm" onClick={onTest} disabled={testing}>
        {testing ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />{" "}
            {t("onboarding.flow.apiKey.testing")}
          </>
        ) : (
          t("onboarding.flow.apiKey.testConnection")
        )}
      </Button>
      {entry?.docsUrl && (
        <a
          href={entry.docsUrl}
          onClick={(e) => {
            e.preventDefault()
            if (entry?.docsUrl) window.api.openExternal(entry.docsUrl)
          }}
          className="text-xs text-(--accent) hover:underline"
        >
          {t("onboarding.flow.apiKey.whereKey")}
        </a>
      )}
    </div>
  )

  const loginBlock = entry ? (
    <div className="p-4 rounded-(--radius-sm) bg-(--bg-card) border border-(--border)">
      {loggedIn ? (
        <div className="flex items-center gap-2 text-sm mb-3 text-(--success-text)">
          <span>✓</span>
          <strong>{t("onboarding.flow.apiKey.detectedLogin")}</strong>
        </div>
      ) : cliInstalled === false ? (
        // Login can't succeed until the CLI exists. Onboarding installs the
        // agent before this step, but surface it explicitly so a missing/failed
        // install doesn't read as a silent login failure.
        <div className="flex items-center gap-2 text-sm mb-3 text-(--warning-text)">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>
            <strong>
              {t("onboarding.flow.apiKey.notInstalledYet", { label })}
            </strong>
            {t("onboarding.flow.apiKey.notInstalledHint")}
          </span>
        </div>
      ) : cliInstalled === true ? (
        <div className="flex items-center gap-2 text-sm mb-3 text-(--text-secondary)">
          <span>✓</span>
          <span>
            {t("onboarding.flow.apiKey.installedNotSignedIn", { label })}
          </span>
        </div>
      ) : null}
      <p className="text-xs text-(--text-secondary) m-0 mb-3">
        {t("onboarding.flow.apiKey.loginInstructionsPrefix", { label })}
        <code className="inline-code">{entry.loginCommand}</code>
        {t("onboarding.flow.apiKey.loginInstructionsMid")}
        <strong>{t("onboarding.flow.apiKey.saveAndContinue")}</strong>
        {t("onboarding.flow.apiKey.loginInstructionsSuffix")}
      </p>
      {showWindowsShellNote && (
        <div className="flex items-start gap-2 text-2xs text-(--text-secondary) mb-3 p-2.5 rounded-sm bg-(--bg-input)">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-(--warning-text)" />
          <span>
            {t("onboarding.flow.apiKey.windowsShellNotePrefix")}
            <a
              href="https://git-scm.com/downloads/win"
              onClick={(e) => {
                e.preventDefault()
                window.api.openExternal("https://git-scm.com/downloads/win")
              }}
              className="text-(--accent) hover:underline"
            >
              {t("onboarding.flow.apiKey.gitForWindows")}
            </a>
            {t("onboarding.flow.apiKey.windowsShellNoteOr")}
            <a
              href="https://aka.ms/powershell"
              onClick={(e) => {
                e.preventDefault()
                window.api.openExternal("https://aka.ms/powershell")
              }}
              className="text-(--accent) hover:underline"
            >
              {t("onboarding.flow.apiKey.powershell7")}
            </a>
            {t("onboarding.flow.apiKey.windowsShellNoteSuffix")}
          </span>
        </div>
      )}
      <Button
        size="sm"
        variant="default"
        onClick={onLogin}
        disabled={checkingLogin}
      >
        {checkingLogin ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />{" "}
            {t("onboarding.flow.apiKey.waitingForLogin")}
          </>
        ) : loggedIn ? (
          t("onboarding.flow.apiKey.reopenLoginTerminal")
        ) : (
          t("onboarding.flow.apiKey.openLoginTerminal")
        )}
      </Button>
      <p className="mt-3 text-2xs text-(--text-tertiary) m-0">
        {t("onboarding.flow.apiKey.detectionNote")}
      </p>
      {hasEnvFields && (
        <div className="mt-4 pt-4 border-t border-(--border)">
          <p className="text-xs font-medium m-0 mb-3">
            {t("onboarding.flow.apiKey.preferApiKey")}
          </p>
          {envInputs}
          {testRow}
        </div>
      )}
    </div>
  ) : null

  return (
    <>
      <StepHeader
        icon={<KeyRound className="w-5 h-5" />}
        title={t("onboarding.flow.apiKey.title")}
        subtitle={subtitle}
      />

      {!entry ? (
        <div className="flex items-center gap-2 text-xs text-(--text-tertiary) py-6">
          <Loader2 className="w-4 h-4 animate-spin" />{" "}
          {t("onboarding.flow.apiKey.loadingConfiguration")}
        </div>
      ) : mode === "env" ? (
        <>
          {envInputs}
          <div className="flex items-center gap-3 mt-4 flex-wrap">
            <Button variant="outline" size="sm" onClick={onTest} disabled={testing}>
              {testing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />{" "}
                  {t("onboarding.flow.apiKey.testing")}
                </>
              ) : (
                t("onboarding.flow.apiKey.testConnection")
              )}
            </Button>
            {hasLogin && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onLogin}
                disabled={checkingLogin}
              >
                {checkingLogin
                  ? t("onboarding.flow.apiKey.waitingForLogin")
                  : loggedIn
                    ? t("onboarding.flow.apiKey.reloginViaCli")
                    : t("onboarding.flow.apiKey.orLoginViaCli")}
              </Button>
            )}
            {entry.docsUrl && (
              <a
                href={entry.docsUrl}
                onClick={(e) => {
                  e.preventDefault()
                  if (entry.docsUrl) window.api.openExternal(entry.docsUrl)
                }}
                className="text-xs text-(--accent) hover:underline"
              >
                {t("onboarding.flow.apiKey.whereKey")}
              </a>
            )}
          </div>
        </>
      ) : mode === "login" ? (
        loginBlock
      ) : (
        <div className="p-4 rounded-(--radius-sm) bg-(--success-bg) text-(--success-text) text-xs">
          {t("onboarding.flow.apiKey.noConfigNeededPrefix")}
          <strong>{t("onboarding.flow.apiKey.saveAndContinue")}</strong>
          {t("onboarding.flow.apiKey.noConfigNeededSuffix")}
        </div>
      )}

      {testResult && (
        <div
          className={cn(
            "mt-4 px-3 py-2 rounded-sm text-xs",
            testResult.ok
              ? "bg-(--success-bg) text-(--success-text)"
              : "bg-(--danger-bg) text-(--danger-text)",
          )}
        >
          {testResult.ok
            ? t("onboarding.flow.apiKey.connected")
            : t("onboarding.flow.apiKey.failed")}
          {testResult.detail && (
            <span className="ml-1.5 opacity-80">— {testResult.detail}</span>
          )}
        </div>
      )}
    </>
  )
}
