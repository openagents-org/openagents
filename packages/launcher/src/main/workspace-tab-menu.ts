import { Menu, type BrowserWindow } from "electron"

import { t } from "./i18n"
import type { WorkspaceTabsSnapshot } from "../shared/workspace-view"

/**
 * The menu of every open Workspace tab, as a native menu.
 *
 * Native because of where it opens: right over the Workspace page, which is a
 * native view drawn above the launcher's own DOM. A menu drawn in that DOM
 * would land underneath it, and hiding the page to show the menu leaves the
 * user looking at a blank, loading window. An OS menu sits above both.
 */
export function popupWorkspaceTabMenu(
  window: BrowserWindow,
  snapshot: WorkspaceTabsSnapshot,
  position: { x: number; y: number },
  activate: (id: string) => void,
): void {
  const { tabs, active } = snapshot
  const counts = new Map<string, number>()
  for (const tab of tabs) counts.set(tab.title, (counts.get(tab.title) ?? 0) + 1)
  const menu = Menu.buildFromTemplate(tabs.map((tab, index) => {
    // ⌘1–⌘8 for the first eight, ⌘9 for the last — see shortcutTab.
    const key = index < 8 ? index + 1 : index === tabs.length - 1 ? 9 : null
    const duplicate = (counts.get(tab.title) ?? 0) > 1 && tab.slug && tab.slug !== tab.title
    return {
      label: duplicate ? `${tab.title} (${tab.slug})` : tab.title,
      type: "radio" as const,
      checked: tab.id === active,
      // Shown for reference only: the shortcuts are handled per view, and
      // registering them here would claim them for the whole window.
      ...(key ? { accelerator: `CmdOrCtrl+${key}`, registerAccelerator: false } : {}),
      click: () => activate(tab.id),
    }
  }))
  menu.popup({ window, x: Math.round(position.x), y: Math.round(position.y) })
}

export interface TabContextActions {
  reload: (id: string) => void
  close: (id: string) => void
  closeMany: (ids: string[], keep: string | null) => void
}

/**
 * A tab's right-click menu, laid out after Chrome's: reload, then the close
 * actions. Native for the same reason as the tab list above.
 */
export function popupWorkspaceTabContextMenu(
  window: BrowserWindow,
  snapshot: WorkspaceTabsSnapshot,
  id: string,
  actions: TabContextActions,
): void {
  const ids = snapshot.tabs.map((tab) => tab.id)
  const at = ids.indexOf(id)
  if (at < 0) return
  const others = ids.filter((other) => other !== id)
  const right = ids.slice(at + 1)
  const menu = Menu.buildFromTemplate([
    { label: t("tabReload"), click: () => actions.reload(id) },
    { type: "separator" },
    { label: t("tabClose"), click: () => actions.close(id) },
    { label: t("tabCloseOthers"), enabled: others.length > 0, click: () => actions.closeMany(others, id) },
    { label: t("tabCloseRight"), enabled: right.length > 0, click: () => actions.closeMany(right, id) },
    { type: "separator" },
    { label: t("tabCloseAll"), click: () => actions.closeMany(ids, null) },
  ])
  // Opened at the cursor, as a context menu is.
  menu.popup({ window })
}
