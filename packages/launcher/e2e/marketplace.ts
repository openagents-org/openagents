import type { ElectronApplication } from "@playwright/test"

/**
 * Opens the marketplace list. It has no button in the app any more — Connect
 * Agents leads to the setup gallery instead — so the specs take the same
 * main-process route the tray menu does: `navigate-to-install` with no agent
 * name opens the list.
 */
export async function openMarketplace(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    win?.webContents.send("navigate-to-install")
  })
}
