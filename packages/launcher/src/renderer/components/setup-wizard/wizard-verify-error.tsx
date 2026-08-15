import React, { useState } from "react"
import { AlertCircle, ChevronDown, ChevronRight } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { translateTestError } from "@renderer/lib/test-error"

/**
 * A failed verification, translated, sitting under the fields it is about.
 *
 * It is deliberately not a toast: the user is mid-form when this fires, and a
 * message that appears in a corner and then leaves is one they have to
 * remember rather than read. The retry lives here too, next to the reason,
 * instead of only in the far corner of the dialog.
 *
 * The raw error is available but folded away — it is usually a stack-shaped
 * string that answers nothing on its own.
 */
export function WizardVerifyError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}): React.JSX.Element {
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
                className="mt-1.5 inline-flex items-center gap-0.5 border-0 bg-transparent p-0 text-2xs text-muted-foreground transition-colors hover:text-foreground"
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
          <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
            {t("onboarding.wizard.verify.retry")}
          </Button>
        </div>
      </div>
    </div>
  )
}
