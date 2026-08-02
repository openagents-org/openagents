import React, { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangle, CheckCircle2, Loader2, Terminal } from "lucide-react"
import { Button } from "@renderer/components/shadcn/button"

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
      <div className="flex items-center gap-2 text-sm text-(--text-secondary)">
        <Loader2 className="w-4 h-4 shrink-0 animate-spin" strokeWidth={2} />
        <span>{t("agents.loginStatus.checking")}</span>
      </div>
    )
  }
  if (loggedIn) {
    return (
      <div className="flex items-center gap-2 text-sm text-(--success-text)">
        <CheckCircle2 className="w-4 h-4 shrink-0" strokeWidth={2} />
        <span>{t("agents.loginStatus.signedIn")}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 text-sm text-(--warning-text)">
      <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={2} />
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
  loginCmd,
  loginPhase,
  loggedIn,
  onOpenTerminal,
  onConfirmLogin,
  onCancelAwaiting,
}: {
  loginCmd: string
  loginPhase: "idle" | "awaiting" | "checking"
  loggedIn: boolean | null
  onOpenTerminal: () => void | Promise<void>
  onConfirmLogin: () => void | Promise<void>
  onCancelAwaiting: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="rounded-sm border border-(--accent)/35 bg-(--accent-bg)/60 px-3.5 py-3">
      <div className="flex items-start gap-2.5 mb-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--accent)/15 text-(--accent)">
          <Terminal className="h-4 w-4" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-semibold text-(--text-primary)">
            {t("agents.loginStatus.signInWithCli")}
          </p>
          <p className="hint m-0 mt-1 mb-0 leading-snug">
            {t("agents.loginStatus.opensTerminalPrefix")}{" "}
            <code>{loginCmd}</code>{" "}
            {t("agents.loginStatus.opensTerminalSuffix")}
          </p>
        </div>
      </div>
      <div className="mb-3">
        <LoginStatusRow loginPhase={loginPhase} loggedIn={loggedIn} />
      </div>
      {loginPhase === "awaiting" ? (
        <>
          <p className="hint m-0 mb-3">
            {t("agents.loginStatus.finishThenConfirm")}
          </p>
          <div className="form-actions mt-0 flex-wrap">
            <Button variant="default" onClick={onConfirmLogin}>
              {t("agents.loginStatus.finishedSigningIn")}
            </Button>
            <Button variant="outline" onClick={onCancelAwaiting}>
              {t("agents.loginStatus.notYet")}
            </Button>
          </div>
        </>
      ) : (
        <div className="form-actions mt-0">
          <Button
            variant="default"
            disabled={loginPhase === "checking"}
            onClick={onOpenTerminal}
          >
            {loggedIn
              ? t("agents.loginStatus.reLogin")
              : t("agents.loginStatus.signIn")}
          </Button>
        </div>
      )}
    </div>
  )
}
