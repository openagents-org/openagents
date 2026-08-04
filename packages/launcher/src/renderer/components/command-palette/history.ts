const HISTORY_KEY = "launcher:command-history"
const MAX_HISTORY = 10

/** Recently run command ids, most recent first. */
export function loadHistory(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]")
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === "string").slice(0, MAX_HISTORY)
      : []
  } catch {
    return []
  }
}

export function pushHistory(id: string): void {
  try {
    const next = [id, ...loadHistory().filter((s) => s !== id)].slice(0, MAX_HISTORY)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {}
}
