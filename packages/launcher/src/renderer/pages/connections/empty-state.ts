export type ConnectionFilter = "all" | "connected" | "disconnected"

type Reason = "noResults" | "noConnected" | "noDisconnected" | "noPlatforms"

export interface ConnectionsEmptyState {
  /** Sentence under the title. */
  key: `connections.search.${Reason}`
  /** Heading above it — the house empty state carries both. */
  titleKey: `connections.search.${Reason}Title`
  query?: string
  /** True when a search, rather than the data, is what emptied the list. */
  searching: boolean
}

function state(reason: Reason, query?: string): ConnectionsEmptyState {
  return {
    key: `connections.search.${reason}`,
    titleKey: `connections.search.${reason}Title`,
    query,
    searching: reason === "noResults",
  }
}

export function getConnectionsEmptyState(
  search: string,
  filter: ConnectionFilter,
): ConnectionsEmptyState {
  const query = search.trim()
  if (query) return state("noResults", query)
  if (filter === "connected") return state("noConnected")
  if (filter === "disconnected") return state("noDisconnected")
  return state("noPlatforms")
}
