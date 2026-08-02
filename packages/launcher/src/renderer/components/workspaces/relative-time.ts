import type { TFunction } from "i18next"

/** Coarse "x ago" wording — workspace timestamps never need finer than days. */
export function workspaceRelativeTime(iso: string | null, t: TFunction): string {
  if (!iso) return t("workspaces.relativeTime.never")
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return t("workspaces.relativeTime.never")
  const diff = Date.now() - ts
  if (diff < 60_000) return t("workspaces.relativeTime.justNow")
  if (diff < 3_600_000)
    return t("workspaces.relativeTime.minutesAgo", {
      count: Math.floor(diff / 60_000),
    })
  if (diff < 86_400_000)
    return t("workspaces.relativeTime.hoursAgo", {
      count: Math.floor(diff / 3_600_000),
    })
  return t("workspaces.relativeTime.daysAgo", {
    count: Math.floor(diff / 86_400_000),
  })
}
