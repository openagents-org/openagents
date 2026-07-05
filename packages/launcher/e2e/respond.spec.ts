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

// Env to inject for agents WITHOUT a GUI key field (claude = no-config,
// cursor/hermes = login-only). Written to the instance env via IPC so the
// adapter authenticates without a CLI login.
function injectionEnv(): Record<string, string> {
  const e: Record<string, string> = {}
  const key = process.env.LLM_API_KEY || ""
  const base = process.env.LLM_BASE_URL || ""
  const model = spec?.model || ""
  if (SLUG === "claude") {
    if (process.env.ANTHROPIC_API_KEY) e.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
    if (process.env.ANTHROPIC_BASE_URL) e.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL
    return e
  }
  if (SLUG === "cursor") {
    if (key) e.CURSOR_API_KEY = key
    if (model) e.CURSOR_MODEL = model
    return e
  }
  // hermes + generic fallback
  if (key) e.LLM_API_KEY = key
  if (base) e.LLM_BASE_URL = base
  if (model) e.LLM_MODEL = model
  return e
}

test.describe("launcher full flow", () => {
  test(`${SLUG} installs, connects, and replies`, async ({ page, homeDir }) => {
    test.skip(!haveWorkspaceCreds(), "E2E_WS_TOKEN / E2E_WS_SLUG not set")
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

    // Installing an API-key agent auto-opens the post-install SetupWizard modal,
    // whose overlay blocks navigation. Dismiss it (Escape → base Modal.onClose),
    // retrying because it opens asynchronously after the install resolves.
    await expect(async () => {
      await page.keyboard.press("Escape")
      await page.getByTestId("nav-agents").click({ timeout: 2_000 })
      await expect(page.getByTestId("new-agent-open")).toBeVisible({
        timeout: 2_000,
      })
    }).toPass({ timeout: 30_000 })

    // 2. Create an agent instance. The working directory is normally async-
    //    prefilled from listPaths(); fill it explicitly so Create never rejects
    //    on an empty path (the prefill can lose the race, esp. on Windows).
    await page.getByTestId("new-agent-open").click()
    await page.locator("#agent-type").selectOption(SLUG)
    await page.locator("#agent-name").fill(name)
    await page.locator("#agent-working-directory").fill(homeDir)
    await page.getByTestId("new-agent-create").click()

    // 3. Configure LLM — the dialog auto-opens after create. Agents with GUI key
    //    fields (openclaw/opencode/codex/gemini) get filled + Saved. Agents with
    //    no key field (claude no-config; cursor/hermes login-only) get their env
    //    injected via IPC, then the dialog is closed (→ Connect dialog opens).
    const save = page.getByTestId("cfg-save")
    // getEnvFields (IPC → core) can be slow right after install, esp. on Windows.
    const hasKeyFields = await save
      .isVisible({ timeout: 60_000 })
      .catch(() => false)
    if (hasKeyFields) {
      // Retry fill+Save until the dialog closes. save() only closes when no
      // required field is blank; on some agents (dual-auth codex on Windows) a
      // late getAgentInstanceEnv re-init can blank a field right at click time,
      // so Save is rejected and the dialog stays open — re-fill and try again.
      await expect(async () => {
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
        await expect(save).toBeHidden({ timeout: 4_000 })
      }).toPass({ timeout: 40_000 })
    } else {
      await page.evaluate(
        async ({ n, env }) => {
          await (
            window as unknown as {
              api: {
                saveAgentInstanceEnv: (
                  name: string,
                  env: Record<string, string>,
                ) => Promise<void>
              }
            }
          ).api.saveAgentInstanceEnv(n, env)
        },
        { n: name, env: injectionEnv() },
      )
      await page.keyboard.press("Escape")
    }

    // 4. Connect to the workspace (dialog auto-opens for a new agent).
    await page.getByTestId("ws-join-toggle").click()
    await page.locator("#workspace-url-or-token").fill(process.env.E2E_WS_TOKEN!)
    await page.getByTestId("ws-join").click()

    // 5. Ensure the agent is running + connected. Connecting triggers a daemon
    //    reload that AUTO-STARTS the agent, so clicking Start on an already-
    //    running agent would toggle it OFF. Wait for auto-start first; only click
    //    Start if it hasn't come up on its own.
    const row = page.getByTestId(`agent-row-${name}`)
    const running = /online|running|idle/
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toHaveAttribute("data-network", /.+/, { timeout: 45_000 })
    try {
      await expect(row).toHaveAttribute("data-state", running, { timeout: 45_000 })
    } catch {
      await page.getByTestId(`agent-toggle-${name}`).click()
      await expect(row).toHaveAttribute("data-state", running, {
        timeout: START_TIMEOUT,
      })
    }

    // 6. Send a message and confirm a meaningful reply via the workspace API.
    await new Promise((r) => setTimeout(r, 25_000)) // let it join + start polling
    const cursor = await baselineCursor()
    await sendMessage(name, name, "What is 2+2? Reply with just the number.")
    try {
      const reply = await pollForReply(name, name, cursor, 300_000)
      expect(reply).toContain("4")
    } catch (e) {
      // Attach the daemon log/status so a non-reply is diagnosable (why the
      // agent didn't answer: LLM error, join failure, wrong model, etc.).
      const fs = await import("node:fs")
      const p = await import("node:path")
      for (const rel of ["daemon.log", "daemon.status.json", "daemon.yaml"]) {
        const fp = p.join(homeDir, ".openagents", rel)
        if (fs.existsSync(fp)) {
          await test.info().attach(rel, { path: fp })
        }
      }
      throw e
    }
  })
})
