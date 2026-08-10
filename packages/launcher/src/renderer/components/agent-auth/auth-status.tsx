import React, { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangle, CheckCircle2, Loader2, Terminal } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { CliLoginPanel, UseTerminalButton } from "./cli-login-panel"
import { needsRealTerminal } from "../../../shared/agent-login"
import type { CliLoginApi } from "./use-cli-login"

export function AuthStatusBanner({
  authInfo,
  authLabels,
}: {
  authInfo: {
    ready: boolean
    authMode: string | null
    message: string | null
  } | null
  authLabels: Record<string, string> | null
}): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!authLabels || !authInfo) return null
  if (authInfo.ready) {
    const detected =
      (authInfo.authMode && authLabels[authInfo.authMode]) ||
      t("agents.configureDialog.authReadyGeneric")
    return (
      <div className="flex items-center gap-2 p-3 rounded-(--radius) bg-(--bg-input) text-sm text-(--success-text)">
        <CheckCircle2 className="w-4 h-4 shrink-0" strokeWidth={2} />
        <span>
          {t("agents.configureDialog.authReadyPrefix")} {detected}
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2 p-3 rounded-(--radius) bg-(--bg-input) text-sm text-(--warning-text)">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={2} />
      <span>
        {authInfo.message || t("agents.configureDialog.authNotReadyGeneric")}
      </span>
    </div>
  )
}

export function LoginStatusRow({
  loginPhase,
  loggedIn,
}: {
  loginPhase: "idle" | "awaiting" | "checking"
  loggedIn: boolean | null
}): React.JSX.Element {
  const { t } = useTranslation()
  if (loginPhase === "checking" || loggedIn === null) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 shrink-0 animate-spin" strokeWidth={2} />
        <span>{t("agents.loginStatus.checking")}</span>
      </div>
    )
  }
  if (loggedIn) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-(--success-text)">
        <CheckCircle2 className="size-3.5 shrink-0" strokeWidth={2} />
        <span>{t("agents.loginStatus.signedIn")}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1.5 text-xs text-(--warning-text)">
      <AlertTriangle className="size-3.5 shrink-0" strokeWidth={2} />
      <span>{t("agents.loginStatus.notSignedIn")}</span>
    </div>
  )
}

export function LoginStatusCard({
  loginPhase,
  loggedIn,
}: {
  loginPhase: "idle" | "awaiting" | "checking"
  loggedIn: boolean | null
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 p-3 rounded-(--radius) bg-(--bg-input)">
      {loginPhase === "checking" || loggedIn === null ? (
        <>
          <Loader2
            className="w-5 h-5 shrink-0 text-(--text-tertiary) animate-spin"
            strokeWidth={2}
          />
          <strong className="text-sm">
            {t("agents.loginStatus.checking")}
          </strong>
        </>
      ) : loggedIn ? (
        <>
          <CheckCircle2
            className="w-5 h-5 shrink-0 text-(--success-text)"
            strokeWidth={2}
          />
          <strong className="text-sm">
            {t("agents.loginStatus.signedIn")}
          </strong>
        </>
      ) : (
        <>
          <AlertTriangle
            className="w-5 h-5 shrink-0 text-(--warning-text)"
            strokeWidth={2}
          />
          <strong className="text-sm">
            {t("agents.loginStatus.notSignedIn")}
          </strong>
        </>
      )}
    </div>
  )
}

export function CliLoginBlock({
  agentType,
  loginCmd,
  loginPhase,
  loggedIn,
  login,
  onStartLogin,
  onConfirmLogin,
  onCancelAwaiting,
}: {
  agentType: string
  loginCmd: string
  loginPhase: "idle" | "awaiting" | "checking"
  loggedIn: boolean | null
  login: CliLoginApi
  onStartLogin: (opts?: { terminal?: boolean }) => void
  onConfirmLogin: () => void | Promise<void>
  onCancelAwaiting: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="rounded-lg border border-primary/25 bg-primary/5 p-3.5">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background text-primary shadow-sm">
          <Terminal className="size-4" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-semibold">
            {t("agents.loginStatus.signInWithCli")}
          </p>
          <p className="m-0 mt-1 text-2xs leading-relaxed text-muted-foreground">
            {t("agents.loginStatus.opensTerminalPrefix")}{" "}
            <code className="rounded-sm bg-background px-1 py-0.5 font-mono">
              {loginCmd}
            </code>{" "}
            {t("agents.loginStatus.opensTerminalSuffix")}
          </p>
        </div>
      </div>

      {loginPhase === "awaiting" ? (
        <>
          <p className="m-0 mb-3 text-2xs text-muted-foreground">
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
        // Status and the action it implies sit on one line — reading "signed
        // in" and then hunting for the button below was the awkward part.
        <div className="flex flex-wrap items-center justify-between gap-2">
          <LoginStatusRow loginPhase={loginPhase} loggedIn={loggedIn} />
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
              !needsRealTerminal(agentType, loginCmd) && (
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
