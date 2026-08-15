// ── Application menu and the keyboard surface that ships with it ──
//
// Electron's stock menu is a developer's menu: View → Reload, Force Reload and
// Toggle Developer Tools arrive pre-bound to Cmd/Ctrl+R, Cmd/Ctrl+Shift+R and
// F12. Windows and Linux drop the whole menu (`installApplicationMenu` below),
// but macOS cannot — the menu bar is where Cmd+C/Cmd+V live — so a shipped
// build kept a one-keystroke way to throw the renderer's entire state away in
// the middle of an install, an agent login or a chat.
//
// Reload is a development affordance, so it exists only in development.
import { Menu, app } from "electron"

/**
 * The menu a packaged macOS build gets: the three standard roles users expect
 * from any Mac app, and a View menu with the zoom/full-screen items but none of
 * the reload/inspector ones.
 *
 * Labels stay in English like Electron's own defaults. The localized surfaces
 * are the tray and the app itself; this bar only carries system-standard verbs,
 * and half of its items (Services, Hide, Quit) are drawn by AppKit anyway.
 */
function packagedMacTemplate(): Electron.MenuItemConstructorOptions[] {
  return [
    { role: "appMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ]
}

/**
 * Called once at startup, before the first window exists.
 *
 * macOS in development keeps Electron's default menu, reload included — that
 * shortcut is the point of a dev build. Windows and Linux have no menu at all,
 * as before: the app draws its own top edge, and dropping the menu drops every
 * accelerator attached to it.
 */
export function installApplicationMenu(): void {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null)
    return
  }
  if (app.isPackaged) {
    Menu.setApplicationMenu(Menu.buildFromTemplate(packagedMacTemplate()))
  }
}

/**
 * Cmd+R / Ctrl+R (with or without Shift) and F5.
 *
 * Belt and braces next to the menu: the menu is what *binds* these today, but a
 * future menu item, a devtools-opened window or an embedded page could bind
 * them again, and a reload is unrecoverable — the renderer holds install
 * progress, chat state and half-finished forms that live nowhere else.
 *
 * `platform` is a parameter so the rule is testable off a Mac.
 */
export function isReloadShortcut(
  input: Pick<Electron.Input, "type" | "key" | "control" | "meta">,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (input.type !== "keyDown") return false
  if (input.key === "F5") return true
  if (input.key.toLowerCase() !== "r") return false
  // Ctrl+R on macOS is not reload (and is a real Emacs-style binding in text
  // fields), so each platform only blocks its own modifier.
  return platform === "darwin" ? input.meta : input.control
}
