// Spike spec (no API keys needed): boot the app and install one agent through
// the GUI, asserting it reaches the installed state. Defaults to openclaw;
// override with E2E_AGENT to point at any catalog slug.
//
// This exists to de-risk the biggest unknown before building the full 7-agent
// matrix: can a GUI Electron app launch + run a real install on GitHub-hosted
// macOS AND Windows runners?

import { test, expect } from "./fixtures"

const SLUG = process.env.E2E_AGENT || "openclaw"

// Install pulls a portable Node runtime + npm packages on first run; be generous.
const INSTALL_TIMEOUT = 15 * 60 * 1000

test.describe("launcher install smoke", () => {
  test(`boots and installs ${SLUG}`, async ({ page }) => {
    test.setTimeout(INSTALL_TIMEOUT + 120_000)

    // 1. App booted.
    await expect(page).toHaveTitle(/OpenAgents/i)

    // 2. Go to the Install (marketplace) tab.
    await page.getByTestId("nav-install").click()

    // 3. The agent's card renders.
    const card = page.getByTestId(`agent-card-${SLUG}`)
    await expect(card).toBeVisible({ timeout: 30_000 })

    // Warm-profile short-circuit: already installed => nothing to prove here.
    if ((await card.getAttribute("data-installed")) === "true") {
      test.info().annotations.push({ type: "note", description: "already installed" })
      return
    }

    // 4. Install → confirm the two-step modal.
    await page.getByTestId(`install-btn-${SLUG}`).click()
    await page.getByTestId("install-confirm").click()

    // 5. Clicking Install navigates to the AgentDetail view (and may auto-open a
    // setup wizard), so the marketplace card unmounts — asserting on it is
    // unreliable. Instead confirm completion via the app's own installed-agents
    // state over the same IPC bridge the UI uses. The action was driven through
    // the GUI; only the outcome check is view-independent.
    await expect
      .poll(
        async () => {
          const names = await page.evaluate(async () => {
            const list = await (
              window as unknown as {
                api: { getInstalledAgents: () => Promise<Array<{ name: string }>> }
              }
            ).api.getInstalledAgents()
            return list.map((r) => r.name)
          })
          return names.includes(SLUG)
        },
        { timeout: INSTALL_TIMEOUT, intervals: [5_000] },
      )
      .toBe(true)
  })
})
