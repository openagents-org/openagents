import React from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeft, CircleCheck } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import type { SectionId } from "../section-config"

/**
 * Top of every settings module: the way back to the overview, what this module
 * is, and the reminder that nothing here needs saving — none of these controls
 * has an OK button, and that is only obvious once it is said.
 */
export function DetailHeader({
  section,
  onBack,
}: {
  section: SectionId
  onBack: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="mb-5">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 mb-3 text-muted-foreground"
        onClick={onBack}
      >
        <ArrowLeft />
        {t("settings.overview.back")}
      </Button>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 text-2xl font-bold tracking-tight">
            {t(`settings.pages.${section}.title`)}
          </h1>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">
            {t(`settings.pages.${section}.desc`)}
          </p>
        </div>

        <span className="flex shrink-0 items-center gap-1.5 text-2xs text-muted-foreground">
          <CircleCheck className="size-3.5" />
          {t("settings.detail.autoSaved")}
        </span>
      </div>
    </div>
  )
}
