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

// Per-agent credentials (keys from E2E_* secrets; all via one gateway). claude
// speaks Anthropic (own base); the rest are OpenAI-compatible on E2E_OPENAI_BASE.
const GW = process.env.E2E_OPENAI_BASE || "https://api.openai.com/v1"
// Gemini CLI speaks the NATIVE Gemini API (…/v1beta/models/…), so it needs the
// gateway root without the OpenAI-style /v1 suffix.
const GEMINI_BASE = process.env.E2E_GEMINI_BASE || GW.replace(/\/v1\/?$/, "")
interface Cred {
  key?: string
  base?: string
  model: string
}
const CREDS: Record<string, Cred> = {
  claude: {
    key: process.env.E2E_ANTHROPIC_API_KEY,
    base: process.env.E2E_ANTHROPIC_BASE_URL,
    model: "claude-sonnet-4-6",
  },
  codex: { key: process.env.E2E_CODEX_API_KEY, base: GW, model: "gpt-5-mini" },
  gemini: { key: process.env.E2E_GEMINI_API_KEY, base: GEMINI_BASE, model: "gemini-3.5-flash" },
  openclaw: { key: process.env.E2E_DEEPSEEK_API_KEY, base: GW, model: "deepseek-v4-flash" },
  // opencode → GPT model (deepseek-v4-flash returned provider_server_error via
  // opencode's openai provider). gpt-5-mini works cleanly on the gateway.
  opencode: { key: process.env.E2E_CODEX_API_KEY, base: GW, model: "gpt-5-mini" },
  hermes: { key: process.env.E2E_DEEPSEEK_API_KEY, base: GW, model: "deepseek-v4-flash" },
  cursor: { key: process.env.E2E_DEEPSEEK_API_KEY, base: GW, model: "deepseek-v4-flash" },
}
const cred: Cred = CREDS[SLUG] || { model: spec?.model || "" }

function haveAgentKey(): boolean {
  return !!cred.key
}

// Env to inject for agents WITHOUT a GUI key field (claude = no-config,
// cursor/hermes = login-only). Written to the instance env via IPC so the
// adapter authenticates without a CLI login.
function injectionEnv(): Record<string, string> {
  const e: Record<string, string> = {}
  if (SLUG === "claude") {
    if (cred.key) e.ANTHROPIC_API_KEY = cred.key
    if (cred.base) e.ANTHROPIC_BASE_URL = cred.base
    return e
  }
  if (SLUG === "cursor") {
    if (cred.key) e.CURSOR_API_KEY = cred.key
    if (cred.base) e.CURSOR_BASE_URL = cred.base
    if (cred.model) e.CURSOR_MODEL = cred.model
    return e
  }
  if (SLUG === "gemini") {
    if (cred.key) e.GEMINI_API_KEY = cred.key
    if (cred.base) e.GOOGLE_GEMINI_BASE_URL = cred.base
    if (cred.model) e.GEMINI_MODEL = cred.model
    return e
  }
  // hermes + generic fallback
  if (cred.key) e.LLM_API_KEY = cred.key
  if (cred.base) e.LLM_BASE_URL = cred.base
  if (cred.model) e.LLM_MODEL = cred.model
  return e
}

test.describe("launcher full flow", () => {
  test(`${SLUG} installs, connects, and replies`, async ({ page, homeDir }) => {
    test.skip(!haveWorkspaceCreds(), "E2E_WS_TOKEN / E2E_WS_SLUG not set")
    // cursor-agent has no custom base-URL support and authenticates only against
    // Cursor's own cloud (browser login or a real cursor.com key) — the gateway
    // keys can't drive it, so its keyed flow stays install-smoke-only for now.
    test.skip(SLUG === "cursor", "cursor: needs a real cursor.com API key (no gateway support)")
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

    // Diagnostic: after install, list what the installer actually produced for
    // this agent under the isolated HOME (helps see whether a CLI binary landed
    // and where — esp. hermes on Windows, whose PowerShell installer can exit 0
    // without leaving a findable binary).
    {
      const fs = await import("node:fs")
      const p = await import("node:path")
      const hits: string[] = []
      const walk = (d: string, depth: number): void => {
        if (depth > 5) return
        let ents: import("node:fs").Dirent[] = []
        try {
          ents = fs.readdirSync(d, { withFileTypes: true })
        } catch {
          return
        }
        for (const e of ents) {
          const fp = p.join(d, e.name)
          if (new RegExp(SLUG, "i").test(e.name)) hits.push(fp)
          if (e.isDirectory() && e.name !== "node_modules") walk(fp, depth + 1)
        }
      }
      for (const r of [
        p.join(homeDir, "AppData", "Local"),
        p.join(homeDir, ".openagents", "runtimes"),
        p.join(homeDir, ".local", "bin"),
        p.join(homeDir, `.${SLUG}`),
      ]) {
        walk(r, 0)
      }
      await test
        .info()
        .attach(`install-fs-${SLUG}.txt`, {
          body: hits.join("\n") || `(no '${SLUG}' files found under HOME)`,
          contentType: "text/plain",
        })
      // The launcher's streamed install output (what installStreaming produced).
      const installLog = await page.evaluate((slug) => {
        const s = (
          window as unknown as {
            __oaInstallStore?: {
              getState: () => { jobs: Record<string, { log?: string }> }
            }
          }
        ).__oaInstallStore
        return s?.getState().jobs[slug]?.log || "(no install log)"
      }, SLUG)
      await test
        .info()
        .attach(`install-log-${SLUG}.txt`, {
          body: installLog,
          contentType: "text/plain",
        })
    }

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
    // Success of the configure step = the Connect dialog has opened (its
    // join-token toggle is visible). We assert on THAT rather than the Save
    // button vanishing, because codex's dual-auth dialog transiently re-enters
    // its loading state on Windows (footer unmounts briefly), which would
    // false-positive a "dialog closed" check.
    const joinToggle = page.getByTestId("ws-join-toggle")
    if (hasKeyFields) {
      await expect(async () => {
        if (await joinToggle.isVisible().catch(() => false)) return
        const fieldIds = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[id^="agent-config-"]')).map(
            (e) => e.id,
          ),
        )
        for (const id of fieldIds) {
          const varName = id.replace("agent-config-", "")
          let val: string | undefined
          if (varName.endsWith("_API_KEY")) val = cred.key
          else if (varName.endsWith("_BASE_URL")) val = cred.base
          else if (varName.endsWith("_MODEL")) val = cred.model
          if (val) await page.locator(`[id="${id}"]`).fill(val)
        }
        await save.click().catch(() => {})
        await expect(joinToggle).toBeVisible({ timeout: 6_000 })
      }).toPass({ timeout: 60_000 })
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
      await expect(async () => {
        if (await joinToggle.isVisible().catch(() => false)) return
        await page.keyboard.press("Escape")
        await expect(joinToggle).toBeVisible({ timeout: 4_000 })
      }).toPass({ timeout: 30_000 })
    }

    // hermes authenticates via ~/.hermes/{.env,config.yaml} (what `hermes setup`
    // writes), not env vars — write them here (headless equivalent of setup). The
    // adapter runs the default profile, so it reads these files directly.
    if (SLUG === "hermes") {
      const fs = await import("node:fs")
      const p = await import("node:path")
      const dir = p.join(homeDir, ".hermes")
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(p.join(dir, ".env"), `OPENAI_API_KEY=${cred.key}\n`)
      fs.writeFileSync(
        p.join(dir, "config.yaml"),
        `model:\n  default: ${cred.model}\n  provider: custom\n  base_url: ${cred.base}\n  api_key: ${cred.key}\n`,
      )
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
