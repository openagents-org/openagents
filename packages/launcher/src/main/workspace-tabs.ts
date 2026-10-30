/**
 * The rules behind the Workspace tab strip, kept free of Electron so they can
 * be tested on their own. The views themselves live in workspace-host.ts.
 */

/** Routes the bundle serves outside any one workspace. See desktop/app.tsx. */
const SHARED_ROUTES = new Set(["invite", "share", "auth"])

/** Longest route a page may hand over; the bundle's own routes are far shorter. */
const MAX_ROUTE = 2048

/**
 * The workspace a route belongs to: its first path segment, decoded — the
 * slug or id the web app routes on. Null for the All Workspaces page, and
 * undefined for a route that is not a workspace's or is not a route at all.
 */
export function routeWorkspace(route: unknown): string | null | undefined {
  if (typeof route !== "string" || !route.startsWith("/") || route.startsWith("//") || route.length > MAX_ROUTE) {
    return undefined
  }
  const [first] = route.split("?")[0].split("/").filter(Boolean)
  if (!first) return null
  let segment: string
  try {
    segment = decodeURIComponent(first)
  } catch {
    return undefined
  }
  if (SHARED_ROUTES.has(segment) || !/^[\w-]{1,200}$/.test(segment)) return undefined
  return segment
}

/**
 * What a tab answers to. A workspace is reachable by slug and by id, and the
 * same id on another deployment is another workspace, so a tab is matched on
 * the deployment it was opened against as well as on every name it is known by.
 */
export interface TabIdentity {
  origin: string
  aliases: ReadonlySet<string>
  workspaceId: string | null
}

export function findTab<T extends TabIdentity>(tabs: readonly T[], target: string, origin: string): T | undefined {
  return tabs.find((tab) => tab.origin === origin && (tab.aliases.has(target) || tab.workspaceId === target))
}

/**
 * Another tab already showing the workspace this one turned out to be — the
 * same workspace opened once by slug and once by id, before either page had
 * said which workspace it was.
 */
export function duplicateOf<T extends TabIdentity>(tabs: readonly T[], tab: T): T | undefined {
  if (!tab.workspaceId) return undefined
  return tabs.find((other) => other !== tab && other.origin === tab.origin && other.workspaceId === tab.workspaceId)
}

/**
 * The tab to show once `closing` is gone: the one to its right, else the one
 * to its left, else none — and none means the All Workspaces page.
 */
export function neighbourAfterClose(order: readonly string[], closing: string): string | null {
  const at = order.indexOf(closing)
  if (at < 0) return null
  return order[at + 1] ?? order[at - 1] ?? null
}

/** The origin a deployment's workspaces are identified under. */
export function tabOrigin(webBase: string): string {
  try {
    return new URL(webBase).origin
  } catch {
    return webBase
  }
}

