import React, { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "../../lib/utils"
import { Button } from "../ui/button"
import type { InstallPhase } from "../../types"
import type { InstallJob } from "../../store/install"

/**
 * The five user-facing stages requested in stage.md §2.3.
 * They map onto the four backend phases emitted by main/classifyInstallChunk()
 * (preparing/downloading/installing/verifying/done) plus a finer split of
 * the installing phase based on the streamed detail text:
 *
 *   preparing/downloading                      → Downloading
 *   installing  + detail "extract|expand"      → Extracting
 *   installing  (other detail)                 → Installing dependencies
 *   verifying                                  → Validating
 *   done                                       → Completed
 */
// Stage ids only; the user-facing labels live in the i18n catalog under
// `install.progress.stages.<key>` and are resolved with t() at render time.
const STAGES = [
  { key: "downloading" },
  { key: "extracting" },
  { key: "installing" },
  { key: "validating" },
  { key: "completed" },
] as const

type StageKey = (typeof STAGES)[number]["key"]

function deriveStageIndex(phase: InstallPhase, detail: string): number {
  if (phase === "preparing" || phase === "downloading") return 0
  if (phase === "installing") {
    if (/extract|expand/i.test(detail)) return 1
    return 2
  }
  if (phase === "verifying") return 3
  if (phase === "done") return 4
  return -1
}

function stageProgressPct(stageIdx: number, errored: boolean): number {
  if (errored) return 100
  if (stageIdx < 0) return 4
  if (stageIdx >= STAGES.length - 1) return 100
  // Slot each stage into an equal band, sitting at ~mid-band while active.
  const bandSize = 100 / STAGES.length
  return Math.round(bandSize * stageIdx + bandSize * 0.55)
}

interface StagedProgressProps {
  job: InstallJob
  className?: string
  onCopyLog?: () => void
  onRetry?: () => void
  onDismiss?: () => void
}

export function StagedProgress({
  job,
  className,
  onCopyLog,
  onRetry,
  onDismiss,
}: StagedProgressProps): React.JSX.Element {
  const { t } = useTranslation()
  const [logOpen, setLogOpen] = useState(false)
  const errored = job.phase === "error"
  const current = useMemo(
    () => deriveStageIndex(job.phase, job.detail || ""),
    [job.phase, job.detail],
  )
  const pct = stageProgressPct(current, errored)
  const verbLabel =
    job.verb === "uninstall" ? t("install.progress.verb.uninstall")
    : job.verb === "rollback" ? t("install.progress.verb.rollback")
    : job.verb === "update" ? t("install.progress.verb.update")
    : t("install.progress.verb.install")

  return (
    <div className={cn("rounded-(--radius) border border-(--border) bg-(--bg-card) shadow-sm overflow-hidden", className)}>
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-(--text-secondary)">
            {t("install.progress.verbProgress", { verb: verbLabel })}
          </div>
          <div className="mt-0.5 text-xs text-(--text-primary) truncate" title={job.detail}>
            {errored
              ? job.error || t("install.progress.failed")
              : job.detail ||
                (current >= 0
                  ? t(`install.progress.stages.${STAGES[Math.min(current, STAGES.length - 1)].key}`)
                  : t("install.progress.starting"))}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {errored && onRetry && (
            <Button size="sm" variant="default" onClick={onRetry}>{t("install.progress.retry")}</Button>
          )}
          {onCopyLog && (
            <Button size="sm" variant="ghost" onClick={onCopyLog}>{t("install.progress.copyLog")}</Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setLogOpen((v) => !v)}
            aria-expanded={logOpen}
          >
            {logOpen ? t("install.progress.hideLog") : t("install.progress.showLog")}
          </Button>
          {onDismiss && (job.phase === "done" || job.phase === "error") && (
            <Button size="sm" variant="ghost" onClick={onDismiss}>{t("install.progress.dismiss")}</Button>
          )}
        </div>
      </div>

      <div className="px-4">
        <div className="h-1.5 rounded-full bg-(--bg-input) overflow-hidden">
          <div
            className={cn(
              "h-full transition-[width] duration-500 ease-out",
              errored ? "bg-(--danger)" : "bg-(--accent)",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ol className="flex items-stretch gap-1 px-4 pt-3 pb-4 list-none m-0">
        {STAGES.map((stage, i) => {
          const isCurrent = !errored && i === current
          const isDone = !errored && i < current
          const isErrorHere = errored && i === Math.max(current, 0)
          return (
            <li
              key={stage.key}
              className={cn(
                "flex-1 min-w-0 rounded-md border px-2.5 py-2 transition-all duration-200",
                "border-(--border) bg-(--bg-input)",
                isCurrent && "border-(--accent) bg-(--accent-bg) shadow-[0_0_0_1px_var(--accent-border)]",
                isDone && "border-(--success) bg-(--success-bg)",
                isErrorHere && "border-(--danger) bg-(--danger-bg)",
              )}
              aria-current={isCurrent ? "step" : undefined}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "inline-flex h-4 w-4 items-center justify-center rounded-full text-3xs font-semibold shrink-0",
                    isDone && "bg-(--success) text-white",
                    isCurrent && "bg-(--accent) text-white",
                    isErrorHere && "bg-(--danger) text-white",
                    !isDone && !isCurrent && !isErrorHere && "bg-(--bg-card) text-(--text-tertiary) border border-(--border)",
                  )}
                >
                  {isDone ? "✓" : isErrorHere ? "!" : i + 1}
                </span>
                <span
                  className={cn(
                    "truncate text-2xs font-medium",
                    isDone ? "text-(--success-text)"
                    : isCurrent ? "text-(--text-primary)"
                    : isErrorHere ? "text-(--danger-text)"
                    : "text-(--text-tertiary)",
                  )}
                  title={t(`install.progress.stages.${stage.key}`)}
                >
                  {t(`install.progress.stages.${stage.key}`)}
                </span>
              </div>
            </li>
          )
        })}
      </ol>

      {logOpen && (
        <div className="border-t border-(--border) bg-(--bg-input) px-3 py-2">
          <pre
            className="log-viewer m-0 max-h-60 overflow-auto whitespace-pre-wrap break-words text-2xs leading-snug"
          >
            {job.log || (errored ? job.error || t("install.progress.noLog") : t("install.progress.waitingForOutput"))}
          </pre>
        </div>
      )}
    </div>
  )
}

interface MiniBannerProps {
  job: InstallJob
  onOpen: () => void
}

export function InstallMiniBanner({ job, onOpen }: MiniBannerProps): React.JSX.Element {
  const { t } = useTranslation()
  const errored = job.phase === "error"
  const current = deriveStageIndex(job.phase, job.detail || "")
  const pct = stageProgressPct(current, errored)
  const verb =
    job.verb === "uninstall" ? t("install.progress.mini.uninstalling")
    : job.verb === "rollback" ? t("install.progress.mini.rollingBack")
    : job.verb === "update" ? t("install.progress.mini.updating")
    : t("install.progress.mini.installing")

  return (
    <button
      type="button"
      onClick={onOpen}
      title={t("install.progress.mini.tooltip")}
      className={cn(
        "fixed bottom-4 right-4 z-30 w-75 cursor-pointer text-left",
        "rounded-(--radius) border border-(--border) bg-(--bg-card) shadow-lg",
        "px-3.5 py-3 flex flex-col gap-1.5",
        "transition-all duration-200 hover:shadow-xl hover:-translate-y-px",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-(--text-primary) truncate">
          {verb} {job.agent}
        </span>
        <span className={cn(
          "text-3xs font-medium tracking-wide shrink-0",
          errored ? "text-(--danger-text)" : "text-(--text-tertiary)",
        )}>
          {errored ? t("install.progress.mini.failedStatus") : current >= 4 ? t("install.progress.mini.doneStatus") : `${pct}%`}
        </span>
      </div>
      <div className="h-1 rounded-full bg-(--bg-input) overflow-hidden">
        <div
          className={cn(
            "h-full transition-[width] duration-500",
            errored ? "bg-(--danger)" : "bg-(--accent)",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-2xs text-(--text-tertiary) truncate" title={job.detail}>
        {errored
          ? job.error || t("install.progress.failed")
          : job.detail ||
            (current >= 0
              ? t(`install.progress.stages.${STAGES[Math.min(current, STAGES.length - 1)].key}`)
              : t("install.progress.starting"))}
      </span>
    </button>
  )
}

// Helpful for tests + other consumers (e.g. the marketplace card chip).
export function stageOf(job: InstallJob | undefined): StageKey | null {
  if (!job) return null
  const idx = deriveStageIndex(job.phase, job.detail || "")
  if (idx < 0) return null
  return STAGES[Math.min(idx, STAGES.length - 1)].key
}
