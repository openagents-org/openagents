import type { TFunction } from "i18next"

export function timeAgo(iso: string, t: TFunction): string {
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return ""
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return t("github.time.secondsAgo", { count: s })
  if (s < 3600) return t("github.time.minutesAgo", { count: Math.floor(s / 60) })
  if (s < 86400) return t("github.time.hoursAgo", { count: Math.floor(s / 3600) })
  return t("github.time.daysAgo", { count: Math.floor(s / 86400) })
}
