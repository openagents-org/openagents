import React from "react"
import { Trans, useTranslation } from "react-i18next"

import { Input } from "../ui/input"
import { cn } from "../../lib/utils"
import { formatCode } from "../../lib/pairing-code"

const WORKSPACE_SITE = "https://workspace.openagents.org"

/**
 * The pairing-code field. State and the action that submits it live with the
 * caller (see `usePairDevice`); this only renders. No visible label: the
 * dialog title already says what goes here, so the field sits right under it.
 */
export function PairPanel({
  code,
  onChange,
  onSubmit,
  error,
  autoFocus = true,
  className,
}: {
  code: string
  onChange: (v: string) => void
  onSubmit: () => void
  error: string | null
  autoFocus?: boolean
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Input
        id="quick-connect-code"
        aria-label={t("workspaces.quickConnect.pairLabel")}
        aria-invalid={!!error || undefined}
        value={code}
        onChange={(e) => onChange(formatCode(e.target.value))}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        placeholder={t("workspaces.quickConnect.pairPlaceholder")}
        className="h-14 text-center font-mono text-xl tracking-widest uppercase md:text-xl"
        autoFocus={autoFocus}
      />
      {error && <p role="alert" className="m-0 text-xs text-(--danger-text)">{error}</p>}
    </div>
  )
}

/**
 * Where a pairing code comes from, for someone who does not have one yet.
 * Foreground ink rather than muted: it is the only guidance on the form.
 */
export function PairingCodeHowTo({ className }: { className?: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className={cn("text-xs leading-6 text-foreground", className)}>
      <p className="m-0 font-medium">{t("workspaces.quickConnect.howTo.title")}</p>
      <p className="m-0">
        <Trans
          i18nKey="workspaces.quickConnect.howTo.step1"
          components={{
            1: (
              <button
                type="button"
                onClick={() => window.api.openExternal(WORKSPACE_SITE)}
                className="cursor-pointer border-0 bg-transparent p-0 text-xs text-primary underline underline-offset-2"
              />
            ),
          }}
        />
      </p>
      <p className="m-0">{t("workspaces.quickConnect.howTo.step2")}</p>
    </div>
  )
}

export function openWorkspaceSite(): void {
  window.api.openExternal(WORKSPACE_SITE)
}
