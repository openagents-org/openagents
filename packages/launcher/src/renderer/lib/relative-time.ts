type TFn = (key: string, opts?: Record<string, unknown>) => string

/**
 * "just now" / "3 min ago" — the app-wide wording for a past timestamp.
 *
 * Returns an empty string for a missing or unparseable value so each caller
 * picks its own fallback ("Never", "—", nothing at all) instead of having one
 * baked in here.
 *
 * The strings live under `dashboard.relativeTime.*`, where the first copy of
 * this helper lived; they are generic and now shared by every surface that
 * shows an age.
 */
export function relativeTimeAgo(t: TFn, iso?: string | null): string {
  if (!iso) return ""
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return ""

  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return t("dashboard.relativeTime.justNow")
  if (s < 3600)
    return t("dashboard.relativeTime.minutesAgo", { count: Math.floor(s / 60) })
  if (s < 86400)
    return t("dashboard.relativeTime.hoursAgo", { count: Math.floor(s / 3600) })
  return t("dashboard.relativeTime.daysAgo", { count: Math.floor(s / 86400) })
}
