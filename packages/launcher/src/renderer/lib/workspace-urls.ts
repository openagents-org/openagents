const DEFAULT_WORKSPACE_WEB_BASE_URL = "https://workspace.openagents.org"

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
