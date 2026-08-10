import React from "react"
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  CliLoginPanel,
  UseTerminalButton,
} from "@renderer/components/agent-auth/cli-login-panel"
import type { CliLoginApi } from "@renderer/components/agent-auth/use-cli-login"
import { needsRealTerminal } from "../../../shared/agent-login"
import { Button } from "@renderer/components/ui/button"
import { cn } from "@renderer/lib/utils"

import type { LoginPhase } from "./use-setup-wizard"

/**
 * The CLI sign-in path as one card: what to run, then where that got you.
 *
 * Separate from the shared `CliLoginBlock`, which the Configure dialog renders
 * inside a much denser stack and should keep its tighter, tinted framing. Here
 * the card IS the step, so it gets the room to spell the command out.
 */
export function WizardCliCard({
  agentType,
  loginCommand,
  loginPhase,
  loggedIn,
  onStartLogin,
  login,
  onConfirmLogin,
  onCancelAwaiting,
}: {
  agentType: string
  loginCommand: string
  loginPhase: LoginPhase
  loggedIn: boolean | null
  onStartLogin: (opts?: { terminal?: boolean }) => void
  login: CliLoginApi
  onConfirmLogin: () => void
  onCancelAwaiting: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const checking = loginPhase === "checking" || loggedIn === null

  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="m-0 text-sm font-semibold">
        {t("onboarding.wizard.auth.cliCardTitle")}
      </p>
      <p className="m-0 mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {t("onboarding.wizard.auth.cliCardRun")}{" "}
        <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-2xs">
          {loginCommand}
        </code>{" "}
        {t("onboarding.wizard.auth.cliCardNoKey")}
      </p>

      <span className="my-4 block h-px bg-border" />

      {loginPhase === "awaiting" ? (
        <>
          <p className="m-0 mb-3 text-xs text-muted-foreground">
            {t("agents.loginStatus.finishThenConfirm")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onConfirmLogin}>
              {t("agents.loginStatus.finishedSigningIn")}
            </Button>
            <Button size="sm" variant="outline" onClick={onCancelAwaiting}>
              {t("agents.loginStatus.notYet")}
            </Button>
          </div>
        </>
      ) : (
        // Status and the action it implies share one row — reading "signed in"
        // and then hunting for the button below was the awkward part.
        <div className="flex flex-wrap items-center justify-between gap-3">
          {checking ? (
            <StatusLine icon={Loader2} spin className="text-muted-foreground">
              {t("agents.loginStatus.checking")}
            </StatusLine>
          ) : loggedIn ? (
            <StatusLine icon={CheckCircle2} className="text-success">
              {t("onboarding.wizard.auth.connected")}
            </StatusLine>
          ) : (
            <StatusLine icon={AlertCircle} className="text-(--warning-text)">
              {t("agents.loginStatus.notSignedIn")}
            </StatusLine>
          )}
          {/* Both actions in one group, or justify-between spreads status and
              the two buttons evenly across the row and they stop reading as a
              primary action with an alternative beside it. */}
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <Button
              size="sm"
              variant={loggedIn ? "outline" : "default"}
              disabled={loginPhase === "checking" || login.active}
              onClick={() => onStartLogin()}
            >
              {loggedIn
                ? t("agents.loginStatus.reLogin")
                : t("agents.loginStatus.signIn")}
            </Button>
            {/* Pointless for an agent whose primary button already opens a
                terminal (gemini, hermes) — two buttons, one action. */}
            {login.phase === "idle" &&
              !needsRealTerminal(agentType, loginCommand) && (
                <UseTerminalButton
                  onClick={() => onStartLogin({ terminal: true })}
                />
              )}
          </div>
        </div>
      )}

      {login.phase !== "idle" && (
        <CliLoginPanel
          login={login}
          onUseTerminal={() => onStartLogin({ terminal: true })}
        />
      )}
    </div>
  )
}

function StatusLine({
  icon: Icon,
  spin,
  className,
  children,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  spin?: boolean
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      className={cn("flex min-w-0 items-center gap-2 text-sm font-semibold", className)}
    >
      <Icon
        className={cn("size-4 shrink-0", spin && "animate-spin")}
        strokeWidth={2}
      />
      {children}
    </span>
  )
}
