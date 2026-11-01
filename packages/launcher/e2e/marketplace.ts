import type { ElectronApplication } from "@playwright/test"

/**
 * Opens the marketplace list the way the tray menu does — `navigate-to-install`
 * with no agent name — so a spec gets there from whatever page it is on. In
 * the app it is Connect Agents' "Browse and connect more agents".
 */
export async function openMarketplace(app: ElectronApplication): Promise<void> {
  // Right after launch the window can still be reloading, which destroys the
  // evaluate's context mid-call; that is a retry, not a failure.
  for (let attempt = 1; ; attempt++) {
    try {
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
        win?.webContents.send("navigate-to-install")
      })
      return
    } catch (e) {
      if (attempt >= 5 || !/context was destroyed/i.test(String(e))) throw e
      await new Promise((r) => setTimeout(r, 2_000))
    }
  }
}
