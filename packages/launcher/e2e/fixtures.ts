// Playwright fixtures for driving the built Electron launcher.
//
// Launches `out/main/index.js` directly (electron-vite build output) — NOT a
// packaged/signed installer. Each test gets an isolated HOME so `~/.openagents`
// (portable Node, core lib, daemon config) and the Electron userData dir start
// clean, and the first-run onboarding / guided tour are pre-dismissed via
// localStorage so they don't intercept clicks.

import {
  test as base,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test"
import { mkdtempSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

interface LauncherFixtures {
  /** Isolated HOME for this test — `~/.openagents` (daemon log/config) lives here. */
  homeDir: string
  app: ElectronApplication
  page: Page
}

/** Absolute path to the built main entry. Override with LAUNCHER_MAIN. */
function mainEntry(): string {
  return process.env.LAUNCHER_MAIN
    ? path.resolve(process.env.LAUNCHER_MAIN)
    : path.resolve(process.cwd(), "out/main/index.js")
}

// On first launch the app shows a `data:text/html` SPLASH window while it
// bootstraps (downloads the portable Node runtime + core lib, minutes), then
// creates the real mainWindow at `index.html` and destroys the splash. So the
// naive firstWindow() returns the splash — we must wait for the index.html one.
async function mainAppPage(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 6 * 60 * 1000
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      if (w.url().includes("index.html")) return w
    }
    // Wait for the next window event (splash → main), but don't busy-spin.
    await app.waitForEvent("window", { timeout: 5000 }).catch(() => {})
  }
  throw new Error("main app window (index.html) never appeared within 6 min")
}

export const test = base.extend<LauncherFixtures>({
  homeDir: async ({}, use) => {
    const home = mkdtempSync(path.join(tmpdir(), "oa-e2e-"))
    await use(home)
  },

  app: async ({ homeDir }, use) => {
    // Windows keys userData off APPDATA; give it a home-scoped location too so
    // profiles never leak between runs on self-hosted-style reuse.
    const appData = path.join(homeDir, "AppData", "Roaming")
    const localAppData = path.join(homeDir, "AppData", "Local")
    mkdirSync(appData, { recursive: true })
    mkdirSync(localAppData, { recursive: true })

    const app = await electron.launch({
      args: [mainEntry()],
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        APPDATA: appData,
        LOCALAPPDATA: localAppData,
      },
    })
    await use(app)
    await app.close().catch(() => {})
  },

  page: async ({ app }, use) => {
    const page = await mainAppPage(app)
    await page.waitForLoadState("domcontentloaded")
    // Pre-dismiss first-run overlays (onboarding wizard + spotlight tour) so
    // they don't intercept clicks, then reload so the flags are read before the
    // app's onboarding effect runs.
    await page.addInitScript(() => {
      try {
        localStorage.setItem("onboarding_completed", "true")
        localStorage.setItem("guided_tour_completed", "true")
      } catch {
        /* ignore */
      }
    })
    await page.reload()
    await page.waitForLoadState("domcontentloaded")
    await use(page)
  },
})

export { expect } from "@playwright/test"
