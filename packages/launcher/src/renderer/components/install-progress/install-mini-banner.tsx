import React from "react"
import { useTranslation } from "react-i18next"

import { cn } from "../../lib/utils"
import type { InstallJob } from "../../store/install"
import { STAGES, stageIndex, stagePercent } from "./stages"

const VERB_LABEL: Record<InstallJob["verb"], string> = {
  install: "install.progress.mini.installing",
  update: "install.progress.mini.updating",
  uninstall: "install.progress.mini.uninstalling",
  rollback: "install.progress.mini.rollingBack",
}

/**
 * Floating progress pill, shown app-wide while an install runs so leaving the
 * marketplace doesn't hide what the launcher is doing. Clicking it returns to
 * the agent's detail page.
 */
export function InstallMiniBanner({
  job,
  onOpen,
}: {
  job: InstallJob
  onOpen: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const errored = job.phase === "error"
  const index = stageIndex(job.phase, job.detail || "")
  const pct = stagePercent(index, errored)

  const status = errored
    ? t("install.progress.mini.failedStatus")
    : index >= STAGES.length - 1
      ? t("install.progress.mini.doneStatus")
      : `${pct}%`

  return (
    <button
      type="button"
      onClick={onOpen}
      title={t("install.progress.mini.tooltip")}
      className={cn(
        "fixed right-4 bottom-4 z-30 flex w-75 cursor-pointer flex-col gap-1.5 text-left",
        "rounded-xl border bg-card px-3.5 py-3 shadow-lg transition-shadow hover:shadow-xl",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold">
          {t(VERB_LABEL[job.verb])} {job.agent}
        </span>
        <span
          className={cn(
            "shrink-0 font-mono text-3xs",
            errored ? "text-(--danger-text)" : "text-muted-foreground",
          )}
        >
          {status}
        </span>
      </div>

      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full transition-[width] duration-500",
            errored ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <span className="truncate text-2xs text-muted-foreground" title={job.detail}>
        {errored
          ? job.error || t("install.progress.failed")
          : job.detail || t("install.progress.starting")}
      </span>
    </button>
  )
}
