import React from "react"
import { CheckCircle2, XCircle } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "../ui/button"
import { cn } from "../../lib/utils"

/** Step 2 — confirm the connection result, then advance to instance creation. */
export function SetupConnectionTestBody({
  message,
  ok,
}: {
  message: string
  ok: boolean
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

export function SetupConnectionTestFooter({
  onNext,
  onBack,
}: {
  onNext: () => void
  onBack: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <Button variant="outline" onClick={onBack}>
        {t("onboarding.wizard.connectionTest.back")}
      </Button>
      <Button onClick={onNext}>
        {t("onboarding.wizard.connectionTest.nextCreateAgent")}
      </Button>
    </>
  )
}
