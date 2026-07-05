// Full keyed GUI flow: install → create instance → configure LLM → connect
// workspace → start → send a message → poll the workspace API for a real reply.
//
// Gated so a cell without the needed credentials skips cleanly (not fails):
//   - needs E2E_WS_TOKEN / E2E_WS_SLUG (workspace)
//   - needs the agent's provider key (LLM_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY)
//   - login-only agents (cursor, hermes) have no GUI key field — deferred to an
//     env-injection follow-up.

import { test, expect } from "./fixtures"
import { agentBySlug } from "./agents"
import {
  haveWorkspaceCreds,
  sendMessage,
  baselineCursor,
  pollForReply,
} from "./workspace"

const SLUG = process.env.E2E_AGENT || "openclaw"
const spec = agentBySlug(SLUG)

// GUI login-only agents (no API-key field) — keyed flow needs env-injection; TODO.
const LOGIN_ONLY = new Set(["cursor", "hermes"])

const INSTALL_TIMEOUT = 15 * 60 * 1000
const START_TIMEOUT = 90_000

function apiKeyFor(varName: string): string | undefined {
  if (varName.includes("ANTHROPIC")) return process.env.ANTHROPIC_API_KEY
  if (varName.includes("GEMINI") || varName.includes("GOOGLE"))
    return process.env.GEMINI_API_KEY
  return process.env.LLM_API_KEY
}
function baseUrlFor(varName: string): string | undefined {
  if (varName.includes("ANTHROPIC")) return process.env.ANTHROPIC_BASE_URL
  if (varName.includes("GEMINI") || varName.includes("GOOGLE")) return undefined
  return process.env.LLM_BASE_URL
}
function haveAgentKey(): boolean {
  if (SLUG === "claude") return !!process.env.ANTHROPIC_API_KEY
  if (SLUG === "gemini") return !!process.env.GEMINI_API_KEY
  return !!process.env.LLM_API_KEY
}

test.describe("launcher full flow", () => {
  test(`${SLUG} installs, connects, and replies`, async ({ page }) => {
    test.skip(!haveWorkspaceCreds(), "E2E_WS_TOKEN / E2E_WS_SLUG not set")
    test.skip(LOGIN_ONLY.has(SLUG), `${SLUG} is login-only (env-injection TODO)`)
    test.skip(!haveAgentKey(), `no provider API key for ${SLUG}`)
    test.setTimeout(INSTALL_TIMEOUT + 12 * 60 * 1000)

    const runId = process.env.GITHUB_RUN_ID || String(Date.now())
    const osTag =
      process.platform === "win32"
        ? "win"
        : process.platform === "darwin"
          ? "mac"
          : "lx"
    // Unique per cell so parallel matrix agents don't collide in the shared workspace.
    const name = `e2e-${SLUG}-${osTag}-${runId}`.slice(0, 38)

    // 1. Install (skip if a warm profile already has it).
    await page.getByTestId("nav-install").click()
    const card = page.getByTestId(`agent-card-${SLUG}`)
    await expect(card).toBeVisible({ timeout: 30_000 })
    if ((await card.getAttribute("data-installed")) !== "true") {
      await page.getByTestId(`install-btn-${SLUG}`).click()
      await page.getByTestId("install-confirm").click()
      await expect
        .poll(
          async () =>
            page.evaluate(async () => {
              const list = await (
                window as unknown as {
                  api: { getInstalledAgents: () => Promise<Array<{ name: string }>> }
                }
              ).api.getInstalledAgents()
              return list.map((r) => r.name)
            }),
          { timeout: INSTALL_TIMEOUT, intervals: [5_000] },
        )
        .toContain(SLUG)
    }

    // 2. Create an agent instance.
    await page.getByTestId("nav-agents").click()
    await page.getByTestId("new-agent-open").click()
    await page.locator("#agent-type").selectOption(SLUG)
    await page.locator("#agent-name").fill(name)
    await page.getByTestId("new-agent-create").click()

    // 3. Configure LLM — the dialog auto-opens after create. Fill each visible
    //    key/base/model field by its env-var name.
    const save = page.getByTestId("cfg-save")
    await expect(save).toBeVisible({ timeout: 20_000 })
    const fieldIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[id^="agent-config-"]')).map(
        (e) => e.id,
      ),
    )
    for (const id of fieldIds) {
      const varName = id.replace("agent-config-", "")
      let val: string | undefined
      if (varName.endsWith("_API_KEY")) val = apiKeyFor(varName)
      else if (varName.endsWith("_BASE_URL")) val = baseUrlFor(varName)
      else if (varName.endsWith("_MODEL")) val = spec?.model
      if (val) await page.locator(`[id="${id}"]`).fill(val)
    }
    await save.click()

    // 4. Connect to the workspace (dialog auto-opens for a new agent).
    await page.getByTestId("ws-join-toggle").click()
    await page.locator("#workspace-url-or-token").fill(process.env.E2E_WS_TOKEN!)
    await page.getByTestId("ws-join").click()

    // 5. Start the agent and wait until it's running + connected.
    const row = page.getByTestId(`agent-row-${name}`)
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toHaveAttribute("data-network", /.+/, { timeout: 30_000 })
    await page.getByTestId(`agent-toggle-${name}`).click()
    await expect(row).toHaveAttribute("data-state", /online|running|idle/, {
      timeout: START_TIMEOUT,
    })

    // 6. Send a message and confirm a meaningful reply via the workspace API.
    await new Promise((r) => setTimeout(r, 15_000)) // let it join + start polling
    const cursor = await baselineCursor()
    await sendMessage(name, name, "What is 2+2? Reply with just the number.")
    const reply = await pollForReply(name, name, cursor)
    expect(reply).toContain("4")
  })
})
