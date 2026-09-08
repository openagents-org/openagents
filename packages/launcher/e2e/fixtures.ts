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
  type BrowserContext,
  type ElectronApplication,
  type Page,
} from "@playwright/test"
import { mkdtempSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

interface LauncherFixtures {
  /** Isolated HOME for this test — `~/.openagents` (daemon log/config) lives here. */
  homeDir: string
  /**
   * Internal: a launcher proven to be rendering. `app` and `page` read from it
   * so both refer to the same attempt — specs should depend on those, not this.
   */
  launcher: { app: ElectronApplication; page: Page }
  app: ElectronApplication
  page: Page
}

/** Absolute path to the built main entry. Override with LAUNCHER_MAIN. */
function mainEntry(): string {
  return process.env.LAUNCHER_MAIN
    ? path.resolve(process.env.LAUNCHER_MAIN)
    : path.resolve(process.cwd(), "out/main/index.js")
}

/**
 * How many times to relaunch a launcher that comes up without frame production.
 *
 * Stalls run at roughly one launch in four and are independent between
 * launches, so five attempts put an all-stalled run near 0.1%. A relaunch
 * reuses the warm HOME, so it costs seconds rather than another runtime
 * download — the slowest recovery observed added ~2 min to a spec budgeted 15.
 */
const MAX_LAUNCH_ATTEMPTS = 5

/** Flags that keep the first-run onboarding wizard and guided tour closed. */
function dismissFirstRun(): void {
  try {
    localStorage.setItem("onboarding_completed", "true")
    localStorage.setItem("guided_tour_completed", "true")
  } catch {
    /* ignore */
  }
}

/**
 * Whether the renderer is actually producing frames.
 *
 * A window occasionally ends up with no frame production at all. The DOM stays
 * perfectly healthy under `page.evaluate` — correct geometry, nothing covering
 * the element — while `requestAnimationFrame` never fires. Playwright's
 * actionability check compares an element's bounding box across two rAF
 * callbacks, so every click then hangs on "waiting for element to be visible,
 * enabled and stable" until it times out, with no `intercepts pointer events`
 * to explain it.
 *
 * Measured on a self-hosted Windows box at roughly one launch in four (5 of 19),
 * at random and independent between launches. It is a property of the launch
 * itself, not of anything the fixture does afterwards. The state never recovers:
 * forcing show/focus/moveTop moves `isFocused` yet leaves the window at 0 fps,
 * and window visibility, minimised state and focus read identically on stalled
 * and healthy windows. There is nothing to wait for and nothing to poke, so the
 * only remedy is to relaunch — which is what the `launcher` fixture does.
 */
async function producesFrames(page: Page, timeoutMs = 10_000): Promise<boolean> {
  return page
    .evaluate(
      (ms) =>
        new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), ms)
          requestAnimationFrame(() => {
            clearTimeout(timer)
            resolve(true)
          })
        }),
      timeoutMs,
    )
    .catch(() => false)
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

/** Starts the launcher and returns its main window, ready for a spec to drive. */
async function launchOnce(env: Record<string, string>): Promise<{
  app: ElectronApplication
  page: Page
}> {
  const app = await electron.launch({ args: [mainEntry()], env })

  // Register on the CONTEXT, not the page: the main window does not exist yet
  // (the splash comes first), so the flags are in place for its very first load.
  // Registering on the page instead would mean loading the app and reloading it
  // to apply them — an extra round trip that buys nothing.
  await (app.context() as BrowserContext).addInitScript(dismissFirstRun)

  const page = await mainAppPage(app)
  await page.waitForLoadState("domcontentloaded")

  // Warm profiles could in principle create the main window before the init
  // script lands. Not observed in 14 runs, but reload rather than let a spec
  // fight the onboarding overlay.
  const dismissed = await page
    .evaluate(() => {
      try {
        return localStorage.getItem("onboarding_completed") === "true"
      } catch {
        return false
      }
    })
    .catch(() => false)
  if (!dismissed) {
    console.warn("[fixtures] init script lost the race to the main window; reloading")
    await page.evaluate(dismissFirstRun).catch(() => {})
    await page.reload()
    await page.waitForLoadState("domcontentloaded")
  }

  return { app, page }
}

export const test = base.extend<LauncherFixtures>({
  homeDir: async ({}, use) => {
    const home = mkdtempSync(path.join(tmpdir(), "oa-e2e-"))
    await use(home)
  },

  launcher: async ({ homeDir }, use) => {
    // Windows keys userData off APPDATA; give it a home-scoped location too so
    // profiles never leak between runs on self-hosted-style reuse.
    const appData = path.join(homeDir, "AppData", "Roaming")
    const localAppData = path.join(homeDir, "AppData", "Local")
    mkdirSync(appData, { recursive: true })
    mkdirSync(localAppData, { recursive: true })
    // HOMEDRIVE + HOMEPATH as well as USERPROFILE: a Windows tool that resolves
    // the home directory from the older pair lands in the REAL profile whatever
    // USERPROFILE says, and the isolation is only as good as its leakiest
    // reader. openclaw's auth store was found under C:\Users\Administrator
    // during a run whose HOME was a temp dir, which is the shape of exactly
    // this. Windows-only: the pair means nothing elsewhere, and homeDir is
    // always drive-lettered there (mkdtemp under %TEMP%).
    const winHome =
      process.platform === "win32" && /^[A-Za-z]:/.test(homeDir)
        ? { HOMEDRIVE: homeDir.slice(0, 2), HOMEPATH: homeDir.slice(2) }
        : {}
    const env = {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      ...winHome,
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
    } as Record<string, string>

    // Hand a spec nothing but a window that is proven to be rendering. The check
    // costs seconds next to a 15-minute install, and a stalled window costs the
    // whole spec. A relaunch reuses the warm HOME, so it does not repeat the
    // runtime download.
    let ready: { app: ElectronApplication; page: Page } | undefined
    for (let attempt = 1; attempt <= MAX_LAUNCH_ATTEMPTS; attempt++) {
      let candidate: { app: ElectronApplication; page: Page } | undefined
      try {
        candidate = await launchOnce(env)
        if (await producesFrames(candidate.page)) {
          ready = candidate
          break
        }
      } catch {
        /* fall through to the relaunch below */
      }
      console.warn(
        `[fixtures] launch ${attempt}/${MAX_LAUNCH_ATTEMPTS} produced no frames; relaunching`,
      )
      // Always close on the way out — an abandoned Electron process holds the
      // isolated HOME open and poisons the next attempt.
      await candidate?.app.close().catch(() => {})
    }
    if (!ready) {
      throw new Error(
        `launcher produced no frames across ${MAX_LAUNCH_ATTEMPTS} launches — ` +
          `the renderer never established a frame pipeline`,
      )
    }

    await use(ready)
    await ready.app.close().catch(() => {})
  },

  app: async ({ launcher }, use) => {
    await use(launcher.app)
  },

  page: async ({ launcher }, use) => {
    await use(launcher.page)
  },
})

export { expect } from "@playwright/test"
