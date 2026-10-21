import type { ElectronApplication } from "@playwright/test"

/**
 * Opens the marketplace list the way the tray menu does — `navigate-to-install`
 * with no agent name — so a spec gets there from whatever page it is on. In
 * the app it is Connect Agents' "Browse and connect more agents".
 */
export async function openMarketplace(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    win?.webContents.send("navigate-to-install")
  })
}
