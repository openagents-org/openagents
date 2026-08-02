import type { TFunction } from "i18next"

/**
 * Relative sync time, or null when the platform has never been synced — the
 * caller then omits the line entirely rather than rendering "Synced never",
 * which read as broken on the (majority) disconnected cards.
 */
export function relativeTime(t: TFunction, iso?: string): string | null {
  if (!iso) return null
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return null

  const diff = Date.now() - ts
  if (diff < 60_000) return t("connections.relativeTime.justNow")
  if (diff < 3_600_000)
    return t("connections.relativeTime.minutesAgo", { count: Math.floor(diff / 60_000) })
  if (diff < 86_400_000)
    return t("connections.relativeTime.hoursAgo", { count: Math.floor(diff / 3_600_000) })
  return t("connections.relativeTime.daysAgo", { count: Math.floor(diff / 86_400_000) })
}
