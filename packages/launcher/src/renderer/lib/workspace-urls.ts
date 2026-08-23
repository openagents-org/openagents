import type { Workspace } from "@renderer/types"

const DEFAULT_WORKSPACE_WEB_BASE_URL = "https://workspace.openagents.org"

/** Full workspace URL, including the access token when the workspace has one. */
export function workspaceUrl(ws: Workspace): string {
  const url = workspacePageUrl(ws)
  return ws.token ? `${url}?token=${encodeURIComponent(ws.token)}` : url
}

/**
 * Workspace URL without the access token — for opening in a browser, where a
 * token in the address bar would leak into history and screen shares. The
 * browser session is expected to already have (or prompt for) access.
 */
export function workspacePageUrl(ws: Workspace): string {
  return `${workspaceWebBaseUrl(ws.endpoint)}/${ws.slug || ws.id}`
}

export function workspaceWebBaseUrl(endpoint?: string): string {
  const baseUrl = (endpoint || DEFAULT_WORKSPACE_WEB_BASE_URL).replace(/\/$/, "")
  return baseUrl.replace("workspace-endpoint", "workspace").replace(/\/v1$/, "")
}

export function workspaceDisplayHost(endpoint?: string): string {
  const baseUrl = workspaceWebBaseUrl(endpoint)
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
  }
}
