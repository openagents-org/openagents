import type { AccountWorkspace, Workspace } from "@renderer/types"

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

/**
 * Whether a workspace this device joined opens in the app's own Workspace.
 *
 * The embedded Workspace needs a signed-in account and talks to the configured
 * deployment only, so a workspace on another deployment, or any workspace while
 * signed out, opens in the browser instead.
 *
 * The account must also already be a member. The page is opened with this
 * device's access token, and a signed-in page that arrives with a token adds
 * the account to that workspace — so opening a workspace some other account
 * paired this device into quietly made the signed-in account a member of it.
 * `memberOf` is the account's workspace list; unknown (null) means the browser.
 */
export function opensInApp(
  ws: Workspace,
  configuredEndpoint: string | undefined,
  signedIn: boolean,
  memberOf: AccountWorkspace[] | null,
): boolean {
  return inAppBlocker(ws, configuredEndpoint, signedIn, memberOf) === null
}

/**
 * Why a workspace opens in the browser rather than the app, or null when it
 * opens in the app. The reason is shown to the user: a card that offers only
 * "Open in browser" beside one that offers both reads as a bug otherwise.
 * `unknown` is the account's workspace list still loading (or failing) — not
 * worth a sentence, since it usually resolves a moment later.
 */
export type InAppBlocker = "signedOut" | "otherDeployment" | "notMember" | "unknown"

export function inAppBlocker(
  ws: Workspace,
  configuredEndpoint: string | undefined,
  signedIn: boolean,
  memberOf: AccountWorkspace[] | null,
): InAppBlocker | null {
  if (!signedIn) return "signedOut"
  if (workspaceWebBaseUrl(ws.endpoint) !== workspaceWebBaseUrl(configuredEndpoint)) return "otherDeployment"
  if (!memberOf) return "unknown"
  const member = memberOf.some((m) => m.workspaceId === ws.id || (!!ws.slug && m.slug === ws.slug))
  return member ? null : "notMember"
}

export function workspaceDisplayHost(endpoint?: string): string {
  const baseUrl = workspaceWebBaseUrl(endpoint)
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
  }
}
