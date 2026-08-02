type TFn = (key: string, opts?: Record<string, unknown>) => string

/** "just now" / "3 min ago" — shared by the agent cards and the activity feed. */
export function relativeTime(t: TFn, iso?: string | null): string {
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

/** The launcher records "last active" under three different field names. */
export function lastActiveOf(agent: object): string | undefined {
  const a = agent as {
    lastActiveAt?: string
    last_active?: string
    startedAt?: string
  }
  return [a.lastActiveAt, a.last_active, a.startedAt].find(
    (v): v is string => typeof v === "string",
  )
}
