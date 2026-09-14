import React, { useState } from "react"
import { AlertCircle, CornerDownRight } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { translateTestError } from "@renderer/lib/test-error"

/**
 * A failed verification, translated, pinned above the wizard's footer.
 *
 * It is deliberately not a toast: the user is mid-form when this fires, and a
 * message that appears in a corner and then leaves is one they have to
 * remember rather than read. It used to sit under the fields instead — which
 * reads well on a short form and not at all on a long one. An agent with a
 * dozen env vars pushed it past the bottom of the scroll area, so the only
 * sign that anything had gone wrong was the footer button quietly changing to
 * "Retry": the reason was on screen for nobody. Pinned, it is next to the
 * button that produced it, whatever the form is scrolled to.
 *
 * The raw error is available but folded away — it is usually a stack-shaped
 * string that answers nothing on its own.
 */
export function WizardVerifyError({
  message,
  explained = false,
  fieldName,
  onShowField,
}: {
  message: string
  /**
   * The message is already a written explanation rather than a connector error
   * string, so it is shown as the reason instead of being run through the
   * translator — which would bury the one sentence worth reading.
   */
  explained?: boolean
  /** The env var this is about, when it is about one. */
  fieldName?: string
  /** Take the user to it — it is rarely where they are looking. */
  onShowField?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { title, hint, raw } = explained
    ? { title: t("onboarding.wizard.verify.refused"), hint: message, raw: "" }
    : translateTestError(message)
  const [open, setOpen] = useState(false)
  const hasDetails =
    !!raw && raw.trim() !== title.trim() && raw.trim() !== hint?.trim()

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-(--danger-border) bg-(--danger-bg) px-3 py-2"
    >
      <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-(--danger-text)" />
      <div className="min-w-0 flex-1">
        {/* One paragraph, not a stack. A single line of reason set out as a
            card with a heading, a subheading and a link under it took a fifth
            of the dialog to say six words — and that space came off the form
            it is pinned above. Reason and follow-up run on together, and the
            banner is only as tall as what it has to say. */}
        <p className="m-0 text-xs leading-snug text-muted-foreground">
          <span className="font-semibold text-(--danger-text)">{title}</span>
          {hint && <> {hint}</>}
          {hasDetails && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="ml-1.5 inline-flex cursor-pointer items-center gap-0.5 border-0 bg-transparent p-0 align-baseline text-2xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
            >
              {open
                ? t("onboarding.wizard.apiConfig.hideDetails")
                : t("onboarding.wizard.apiConfig.showDetails")}
            </button>
          )}
        </p>
        {open && (
          <pre className="m-0 mt-1.5 max-h-28 overflow-auto rounded-sm bg-muted px-2 py-1.5 font-mono text-2xs break-all whitespace-pre-wrap">
            {raw}
          </pre>
        )}
      </div>
      {/* No retry button here: this sits directly above the footer, whose
          primary action already says "Retry" in exactly this state. What the
          footer cannot do is say WHICH field was refused. */}
      {fieldName && onShowField && (
        <Button
          size="xs"
          variant="outline"
          className="shrink-0"
          onClick={onShowField}
        >
          <CornerDownRight />
          {t("onboarding.wizard.verify.showField", { name: fieldName })}
        </Button>
      )}
    </div>
  )
}
