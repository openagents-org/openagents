import type { InstallPhase } from "../../types"
import type { InstallJob } from "../../store/install"

/**
 * The five user-facing install stages. They map onto the four backend phases
 * emitted by main/classifyInstallChunk() plus a finer split of `installing`
 * based on the streamed detail text:
 *
 *   preparing / downloading                → downloading
 *   installing + detail "extract|expand"   → extracting
 *   installing (other detail)              → installing
 *   verifying                              → validating
 *   done                                   → completed
 *
 * Labels live in the i18n catalog under `install.progress.stages.<key>`.
 */
export const STAGES = [
  "downloading",
  "extracting",
  "installing",
  "validating",
  "completed",
] as const

export type StageKey = (typeof STAGES)[number]

export function stageIndex(phase: InstallPhase, detail: string): number {
  if (phase === "preparing" || phase === "downloading") return 0
  if (phase === "installing") return /extract|expand/i.test(detail) ? 1 : 2
  if (phase === "verifying") return 3
  if (phase === "done") return 4
  return -1
}

/** Coarse percentage for the mini banner, which has no room for stage chips. */
export function stagePercent(index: number, errored: boolean): number {
  if (errored) return 100
  if (index < 0) return 4
  if (index >= STAGES.length - 1) return 100
  const band = 100 / STAGES.length
  return Math.round(band * index + band * 0.55)
}

export function jobStage(job: InstallJob | undefined): StageKey | null {
  if (!job) return null
  const idx = stageIndex(job.phase, job.detail || "")
  return idx < 0 ? null : STAGES[Math.min(idx, STAGES.length - 1)]
}
