import React from "react"
import { CheckCircle2, XCircle } from "lucide-react"
import { useTranslation } from "react-i18next"

import { cn } from "@renderer/lib/utils"

/** Step 2 — what the connection test actually said. */
export function SetupTestStep({
  ok,
  message,
}: {
  ok: boolean
  message: string
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <div
        className={cn(
          "flex items-start gap-2 rounded-lg border px-3.5 py-3 text-sm",
          ok
            ? "border-(--success-border) bg-(--success-bg) text-(--success-text)"
            : "border-(--danger-border) bg-(--danger-bg) text-(--danger-text)",
        )}
      >
        {ok ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
        ) : (
          <XCircle className="mt-0.5 size-4 shrink-0" />
        )}
        <span className="min-w-0">{message}</span>
      </div>
      <p className="m-0 text-xs text-muted-foreground">
        {ok
          ? t("onboarding.wizard.connectionTest.okHint")
          : t("onboarding.wizard.connectionTest.failHint")}
      </p>
    </>
  )
}
