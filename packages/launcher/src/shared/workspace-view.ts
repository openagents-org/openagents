/**
 * Why an installed app would not show the Workspace: it has no bundle to load.
 *
 * Thrown by main from `workspace-view:show` and matched by the renderer in the
 * rejected IPC call's message, which Electron prefixes with its own text.
 */
export const WORKSPACE_BUNDLE_MISSING = "workspace-bundle-missing"

/**
 * The id of the All Workspaces page. It is a view like any workspace tab, so
 * opening the list never covers a workspace's page, but it is not a tab: it
 * cannot be closed and is reached from its own button.
 */
export const WORKSPACE_HOME_TAB = "home"

export type WorkspaceTabState = "loading" | "ready" | "failed"

/** One open workspace, as the top bar shows it. Never carries an access token. */
export interface WorkspaceTab {
  /** Opaque and stable for the tab's lifetime; not the workspace's own id. */
  id: string
  /** The workspace's name once its page reports one; the route until then. */
  title: string
  /** Shown beside the title when two open workspaces share a name. */
  slug: string | null
  state: WorkspaceTabState
}

export interface WorkspaceTabsSnapshot {
  /** In display order. */
  tabs: WorkspaceTab[]
  /** A tab id, WORKSPACE_HOME_TAB, or null while nothing has been opened. */
  active: string | null
  /** The All Workspaces page's load state, null until it exists. */
  home: WorkspaceTabState | null
}

/** What the page in a view is, so its router knows which routes are its own. */
export type WorkspaceViewScope =
  | { kind: "home" }
  | { kind: "workspace"; aliases: string[] }

/** At this many open tabs the strip also offers a menu of all of them. */
export const TAB_MENU_THRESHOLD = 5

/**
 * The tab a key press asks for, browser-style: ⌘1–⌘8 (Ctrl on Windows and
 * Linux) pick that tab, ⌘9 the last one. Null for any other key.
 */
export function shortcutTab(
  input: { type: string; key: string; meta: boolean; control: boolean; shift: boolean; alt: boolean },
  platform: string,
  order: readonly string[],
): string | null {
  const primary = platform === "darwin" ? input.meta && !input.control : input.control && !input.meta
  if (input.type !== "keyDown" || !primary || input.shift || input.alt) return null
  if (!/^[1-9]$/.test(input.key)) return null
  const n = Number(input.key)
  return (n === 9 ? order[order.length - 1] : order[n - 1]) ?? null
}
