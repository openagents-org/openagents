import React, { useState } from "react"
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  TerminalSquare,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"

import type { CliLoginApi } from "./use-cli-login"

/**
 * The live sign-in card: the authorize URL as a button (not a 300-character
 * string buried in a terminal window), a field for the code the browser hands
 * back, and the terminal fallback for CLIs that refuse to run under pipes.
 *
 * Rendered by every login entry point while `login.active` — see `useCliLogin`.
 */
export function CliLoginPanel({
  login,
  onUseTerminal,
}: {
  login: CliLoginApi
  /** Explicit "open a terminal instead" escape hatch. */
  onUseTerminal: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()

  // Nothing in flight: the surrounding card already says "signed in" (or not),
  // and a stale "open the sign-in page" button after a finished login is worse
  // than no card at all.
  if (
    login.phase === "idle" ||
    login.phase === "success" ||
    login.phase === "cancelled"
  )
    return null

  if (login.phase === "terminal") {
    return (
      <Note icon={TerminalSquare}>
        {t("agents.cliLogin.terminalFallback")}
        {login.message && (
          <span className="mt-1 block text-(--text-tertiary)">
            {login.message}
          </span>
        )}
      </Note>
    )
  }

  if (login.phase === "failed") {
    return (
      <div className="mt-3 space-y-2">
        <Note icon={AlertTriangle} tone="warning">
          {login.message || t("agents.cliLogin.failed")}
        </Note>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void login.start()}>
            {t("agents.cliLogin.tryAgain")}
          </Button>
          <Button size="sm" variant="outline" onClick={onUseTerminal}>
            <TerminalSquare />
            {t("agents.cliLogin.useTerminal")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-lg border border-primary/25 bg-primary/5 p-3.5">
      {login.url ? (
        <UrlRow url={login.url} onReopen={login.reopen} />
      ) : (
        <p className="m-0 flex items-center gap-2 text-xs text-(--text-secondary)">
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
          {t("agents.cliLogin.starting")}
        </p>
      )}

      {login.needsCode && <CodeForm login={login} />}

      {login.phase === "verifying" && (
        <p className="m-0 mt-3 flex items-center gap-2 text-xs text-(--text-secondary)">
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
          {t("agents.cliLogin.verifying")}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-2xs">
        <button
          type="button"
          className="text-(--text-tertiary) hover:underline"
          onClick={onUseTerminal}
        >
          {t("agents.cliLogin.useTerminal")}
        </button>
        <button
          type="button"
          className="text-(--text-tertiary) hover:underline"
          onClick={() => void login.cancel()}
        >
          {t("agents.cliLogin.cancel")}
        </button>
      </div>
    </div>
  )
}

/** The URL, as an action rather than a string to hand-copy out of a terminal. */
function UrlRow({
  url,
  onReopen,
}: {
  url: string
  onReopen: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const copy = (): void => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <>
      <p className="m-0 text-xs font-semibold">
        {t("agents.cliLogin.browserTitle")}
      </p>
      <p className="m-0 mt-1 text-2xs leading-relaxed text-(--text-secondary)">
        {t("agents.cliLogin.browserHint")}
      </p>
      <p className="m-0 mt-2 truncate rounded-sm bg-background px-2 py-1.5 font-mono text-2xs text-(--text-tertiary)">
        {url}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={onReopen}>
          <ExternalLink />
          {t("agents.cliLogin.openBrowser")}
        </Button>
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? <Check /> : <Copy />}
          {copied ? t("agents.cliLogin.copied") : t("agents.cliLogin.copyLink")}
        </Button>
      </div>
    </>
  )
}

/** The paste-the-code step (Claude's flow ends here, not in the browser). */
function CodeForm({ login }: { login: CliLoginApi }): React.JSX.Element {
  const { t } = useTranslation()
  const [code, setCode] = useState("")

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    void login.submitCode(code)
    setCode("")
  }

  return (
    <form onSubmit={submit} className="mt-3">
      <p className="m-0 mb-1.5 text-2xs leading-relaxed text-(--text-secondary)">
        {t("agents.cliLogin.codeHint")}
      </p>
      <div className="flex gap-2">
        <Input
          value={code}
          autoFocus
          spellCheck={false}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("agents.cliLogin.codePlaceholder")}
          className="h-8 font-mono text-2xs"
        />
        <Button type="submit" size="sm" disabled={!code.trim()}>
          {t("agents.cliLogin.submitCode")}
        </Button>
      </div>
    </form>
  )
}

function Note({
  icon: Icon,
  tone,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  tone?: "warning"
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-sm bg-accent p-3 text-2xs leading-relaxed text-(--text-secondary)">
      <Icon
        className={
          tone === "warning"
            ? "mt-0.5 size-3.5 shrink-0 text-(--warning-text)"
            : "mt-0.5 size-3.5 shrink-0 text-(--accent)"
        }
      />
      <span className="min-w-0">{children}</span>
    </div>
  )
}
