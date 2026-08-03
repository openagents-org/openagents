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
