export type ConnectionFilter = "all" | "connected" | "disconnected"

export interface ConnectionsEmptyState {
  key:
    | "connections.search.noResults"
    | "connections.search.noConnected"
    | "connections.search.noDisconnected"
    | "connections.search.noPlatforms"
  query?: string
}

export function getConnectionsEmptyState(
  search: string,
  filter: ConnectionFilter,
): ConnectionsEmptyState {
  const query = search.trim()
  if (query) {
    return { key: "connections.search.noResults", query }
  }
  if (filter === "connected") {
    return { key: "connections.search.noConnected" }
  }
  if (filter === "disconnected") {
    return { key: "connections.search.noDisconnected" }
  }
  return { key: "connections.search.noPlatforms" }
}
