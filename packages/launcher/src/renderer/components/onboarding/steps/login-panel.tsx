import React from "react"
import { AlertTriangle, Check, Loader2, LogIn, TerminalSquare } from "lucide-react"
import { useTranslation } from "react-i18next"

import { CliLoginPanel } from "@renderer/components/agent-auth/cli-login-panel"
import { Button } from "@renderer/components/ui/button"
import { cn } from "@renderer/lib/utils"
import type { OnboardingAgent } from "@renderer/types"

import { InlineCode } from "../onboarding-chrome"
import { isWindows } from "../onboarding-shared"
import type { OnboardingAuthApi } from "../use-onboarding-auth"

/**
 * The CLI sign-in card for agents that authenticate through their own binary.
 * It reports what was actually detected (signed in / installed but not signed
 * in / not installed) but never blocks the step — see `detectionNote`.
 */
export function LoginPanel({
  entry,
  auth,
}: {
  entry: OnboardingAgent
  auth: OnboardingAuthApi
}): React.JSX.Element {
  const { t } = useTranslation()
  const { loggedIn, checkingLogin, cliInstalled, startLogin, login } = auth
  const label = entry.label || entry.name
  const busy = checkingLogin || login.active

  // Only relevant once we've actually fallen back to a terminal: Claude Code
  // refuses to run under cmd.exe on Windows, and if the CLI also needs bash the
  // user must have Git for Windows. The in-app flow spawns the binary directly
  // with no shell involved, so it doesn't hit this at all — showing the warning
  // up front there would be scaring people about a problem they don't have.
  const showWindowsShellNote =
    isWindows &&
    login.phase === "terminal" &&
    /^claude\b/.test(entry.loginCommand || "")

  return (
    <div
      className={cn(
        "rounded-lg border p-5",
        loggedIn
          ? "border-(--success-border) bg-(--success-bg)"
          : cliInstalled === false
            ? "border-(--warning-border) bg-(--warning-bg)"
            : "border-(--border) bg-(--bg-card)",
      )}
    >
      <div className="flex items-center gap-2 text-base font-semibold">
        {loggedIn ? (
          <>
            <Check className="size-4 shrink-0 text-(--success-text)" />
            <span className="text-(--success-text)">
              {t("onboarding.flow.apiKey.detectedLogin")}
            </span>
          </>
        ) : cliInstalled === false ? (
          <>
            <AlertTriangle className="size-4 shrink-0 text-(--warning-text)" />
            <span className="text-(--warning-text)">
              {t("onboarding.flow.apiKey.notInstalledYet", { label })}
            </span>
          </>
        ) : (
          <>
            <TerminalSquare className="size-4 shrink-0 text-(--accent)" />
            <span>
              {cliInstalled
                ? t("onboarding.flow.apiKey.installedNotSignedIn", { label })
                : t("onboarding.flow.apiKey.signInTitle", { label })}
            </span>
          </>
        )}
      </div>

      <p className="m-0 mt-2.5 text-xs leading-relaxed text-(--text-secondary)">
        {cliInstalled === false
          ? t("onboarding.flow.apiKey.notInstalledHint")
          : t("onboarding.flow.apiKey.loginInstructionsPrefix", { label })}
        {cliInstalled !== false && (
          <>
            <InlineCode>{entry.loginCommand}</InlineCode>
            {t("onboarding.flow.apiKey.loginInstructionsSuffix")}
          </>
        )}
      </p>

      {login.phase !== "idle" && (
        <CliLoginPanel
          login={login}
          onUseTerminal={() => void startLogin({ terminal: true })}
        />
      )}

      {showWindowsShellNote && (
        <div className="mt-3 flex items-start gap-2 rounded-sm bg-accent p-3 text-2xs text-(--text-secondary)">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-(--warning-text)" />
          <span>
            {t("onboarding.flow.apiKey.windowsShellNotePrefix")}
            <ExternalLink href="https://git-scm.com/downloads/win">
              {t("onboarding.flow.apiKey.gitForWindows")}
            </ExternalLink>
            {t("onboarding.flow.apiKey.windowsShellNoteOr")}
            <ExternalLink href="https://aka.ms/powershell">
              {t("onboarding.flow.apiKey.powershell7")}
            </ExternalLink>
            {t("onboarding.flow.apiKey.windowsShellNoteSuffix")}
          </span>
        </div>
      )}

      <Button
        className="mt-4"
        size="sm"
        variant={loggedIn ? "outline" : "default"}
        onClick={() => void startLogin()}
        disabled={busy}
      >
        {busy ? (
          <>
            <Loader2 className="animate-spin" />
            {t("onboarding.flow.apiKey.waitingForLogin")}
          </>
        ) : (
          <>
            <LogIn />
            {loggedIn
              ? t("onboarding.flow.apiKey.signInAgain")
              : t("onboarding.flow.apiKey.signInNow")}
          </>
        )}
      </Button>

      <p className="m-0 mt-3 text-2xs leading-relaxed text-(--text-tertiary)">
        {t("onboarding.flow.apiKey.detectionNote")}
      </p>
    </div>
  )
}

export function ExternalLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        void window.api.openExternal(href)
      }}
      className="text-(--accent) hover:underline"
    >
      {children}
    </a>
  )
}
