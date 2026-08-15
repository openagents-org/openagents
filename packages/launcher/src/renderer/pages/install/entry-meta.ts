import type { TFunction } from "i18next"

import { agentDescription } from "@renderer/lib/agent-meta"
import type { CatalogEntry } from "@renderer/types"
import type { InstallJob } from "@renderer/store/install"

/**
 * What a catalog row says about itself, in the order the UI cares about.
 * `comingSoon` wins over everything: an unreleased agent can't be acted on.
 */
export type EntryStatus = "comingSoon" | "update" | "installed" | "available"

export function entryStatus(
  entry: CatalogEntry,
  hasUpdate: boolean,
): EntryStatus {
  if (entry.comingSoon) return "comingSoon"
  if (!entry.installed) return "available"
  return hasUpdate ? "update" : "installed"
}

/** Badge tone per status — kept next to the status so the two never drift. */
export const STATUS_VARIANT: Record<
  EntryStatus,
  "success" | "warning" | "muted"
> = {
  installed: "success",
  update: "warning",
  available: "muted",
  comingSoon: "muted",
}

/**
 * The agent's blurb, translated. The core ships English only — and for some
 * agents ships nothing at all — so every catalog surface has to go through the
 * `agentMeta.descriptions` overlay rather than reading `entry.description`
 * raw. Returns "" when neither has anything; callers supply the placeholder.
 */
export function describeEntry(entry: CatalogEntry, t: TFunction): string {
  return agentDescription(
    entry.name,
    entry.description || entry.long_description,
    t,
  )
}

/**
 * The runtime the agent needs on the machine, e.g. `nodejs`. Null when it
 * declares none — an api-only agent or a CLI bundled with its editor, which
 * the UI labels "built-in" rather than leaving blank.
 */
export function runtimeOf(entry: CatalogEntry): string | null {
  const requires = (entry.install?.requires || []).filter(
    (r): r is string => !!r,
  )
  return requires[0] || null
}

export function platformsOf(entry: CatalogEntry): string[] {
  return [
    entry.install?.macos && "macOS",
    entry.install?.linux && "Linux",
    entry.install?.windows && "Windows",
  ].filter((p): p is string => !!p)
}

/** A job is "busy" until it lands on a terminal phase. */
export function isJobBusy(job: InstallJob | undefined): boolean {
  return !!job && job.phase !== "done" && job.phase !== "error"
}
