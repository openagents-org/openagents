import React, { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { cn } from "@renderer/lib/utils"
import type { InstallJob } from "@renderer/store/install"
import { STAGES, stageIndex } from "@renderer/components/install-progress/stages"

import { DetailSection } from "./detail-section"
import { InstallPrereqNotice } from "./install-prereq-notice"

const VERB_LABEL: Record<InstallJob["verb"], string> = {
  install: "install.progress.verb.install",
  update: "install.progress.verb.update",
  uninstall: "install.progress.verb.uninstall",
  rollback: "install.progress.verb.rollback",
}

interface Props {
  job: InstallJob
  onCopyLog?: () => void
  onRetry?: () => void
}

/**
 * Install progress as five equal segments — the shape of the work is known up
 * front, so a determinate track reads better than a spinner claiming a
 * percentage nothing can actually measure. The streamed log sits underneath,
 * collapsed until asked for.
 */
export function DetailProgress({ job, onCopyLog, onRetry }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [logOpen, setLogOpen] = useState(false)
  const errored = job.phase === "error"
  const current = stageIndex(job.phase, job.detail || "")

  const detail = errored
    ? job.error || t("install.progress.failed")
    : job.detail ||
      (current >= 0
        ? t(`install.progress.stages.${STAGES[Math.min(current, STAGES.length - 1)]}`)
        : t("install.progress.starting"))

  return (
    <DetailSection
      title={t("install.progress.verbProgress", { verb: t(VERB_LABEL[job.verb]) })}
      action={
        <div className="flex items-center gap-1.5">
          {errored && onRetry && (
            <Button size="sm" onClick={onRetry}>
              {t("install.progress.retry")}
            </Button>
          )}
          {onCopyLog && (
            <Button size="sm" variant="ghost" onClick={onCopyLog}>
              {t("install.progress.copyLog")}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            aria-expanded={logOpen}
            onClick={() => setLogOpen((v) => !v)}
          >
            {logOpen ? t("install.progress.hideLog") : t("install.progress.showLog")}
          </Button>
        </div>
      }
    >
      <ol className="m-0 grid list-none grid-cols-5 gap-2 p-0">
        {STAGES.map((stage, i) => {
          const done = !errored && i < current
          const active = !errored && i === current
          const failed = errored && i === Math.max(current, 0)
          return (
            <li
              key={stage}
              aria-current={active ? "step" : undefined}
              className="flex min-w-0 flex-col gap-2"
            >
              <span
                className={cn(
                  "h-1 rounded-full transition-colors",
                  done && "bg-success",
                  active && "bg-primary",
                  failed && "bg-destructive",
                  !done && !active && !failed && "bg-muted",
                )}
              />
              <span
                className={cn(
                  "truncate text-center text-2xs",
                  active ? "font-medium text-foreground" : "text-muted-foreground",
                  failed && "text-(--danger-text)",
                )}
              >
                {t(`install.progress.stages.${stage}`)}
              </span>
            </li>
          )
        })}
      </ol>

      <p
        className="m-0 mt-3 truncate text-xs text-muted-foreground"
        title={job.detail}
      >
        {detail}
      </p>

      {/* A refused install is not a failed one: nothing ran, and the fix is a
          concrete step the user can take right here. */}
      {errored && job.missing && job.missing.length > 0 && (
        <InstallPrereqNotice missing={job.missing} onRetry={onRetry} />
      )}

      {job.logFile && (
        <p className="m-0 mt-3 flex min-w-0 items-center gap-2 text-2xs text-muted-foreground">
          <span className="shrink-0">{t("install.progress.logFile.label")}</span>
          <button
            type="button"
            className="min-w-0 truncate underline underline-offset-2 hover:text-foreground"
            title={job.logFile}
            onClick={() => void window.api.showPath(job.logFile as string)}
          >
            {t("install.progress.logFile.reveal")}
          </button>
        </p>
      )}

      {logOpen && (
        <pre className="log-viewer mt-3 max-h-60 overflow-auto text-2xs leading-relaxed break-words whitespace-pre-wrap">
          {job.log ||
            (errored
              ? job.error || t("install.progress.noLog")
              : t("install.progress.waitingForOutput"))}
        </pre>
      )}
    </DetailSection>
  )
}
