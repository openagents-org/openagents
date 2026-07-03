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
  app: ElectronApplication
  page: Page
}

/** Absolute path to the built main entry. Override with LAUNCHER_MAIN. */
function mainEntry(): string {
  return process.env.LAUNCHER_MAIN
    ? path.resolve(process.env.LAUNCHER_MAIN)
    : path.resolve(process.cwd(), "out/main/index.js")
}

export const test = base.extend<LauncherFixtures>({
  app: async ({}, use) => {
    const home = mkdtempSync(path.join(tmpdir(), "oa-e2e-"))
    // Windows keys userData off APPDATA; give it a home-scoped location too so
    // profiles never leak between runs on self-hosted-style reuse.
    const appData = path.join(home, "AppData", "Roaming")
    const localAppData = path.join(home, "AppData", "Local")
    mkdirSync(appData, { recursive: true })
    mkdirSync(localAppData, { recursive: true })

    const app = await electron.launch({
      args: [mainEntry()],
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        APPDATA: appData,
        LOCALAPPDATA: localAppData,
      },
    })
    await use(app)
    await app.close().catch(() => {})
  },

  page: async ({ app }, use) => {
    const page = await app.firstWindow()
    // Pre-dismiss first-run overlays, then reload so the flags are read before
    // the app's onboarding effect runs.
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
