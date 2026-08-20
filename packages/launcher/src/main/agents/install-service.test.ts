import { beforeEach, describe, expect, it, vi } from "vitest"

// The whole point of these cases is what is and isn't on disk, so fs is the
// thing under control. Only the two reads installVanished/getInstalledVersion
// make are modelled: existsSync and readFileSync.
const files = new Map<string, string>()
vi.mock("fs", () => {
  const api = {
    existsSync: (p: string) => files.has(String(p)),
    readFileSync: (p: string) => {
      const v = files.get(String(p))
      if (v === undefined) throw new Error(`ENOENT: ${p}`)
      return v
    },
    mkdirSync: () => undefined,
    writeFileSync: (p: string, data: string) => {
      files.set(String(p), String(data))
    },
    // installVanished logs its verdict through appendDaemonLog.
    appendFileSync: () => undefined,
  }
  return { ...api, default: api }
})

import path from "path"

import { InstallService } from "./install-service"
import { CONFIG_DIR, INSTALLED_HISTORY_FILE, PORTABLE_NODE_DIR } from "./paths"

const npmInstall = "npm install -g @openai/codex"
const script = "powershell -c irm cursor.com/install | iex"
const REGISTRY: Record<string, Record<string, unknown>> = {
  // npm-backed: has a package dir we can check.
  codex: {
    name: "codex",
    install: {
      binary: "codex",
      macos: npmInstall,
      linux: npmInstall,
      windows: npmInstall,
    },
  },
  // Script-installed: no package, so the records are all we have.
  cursor: {
    name: "cursor",
    install: {
      binary: "cursor-agent",
      macos: script,
      linux: script,
      windows: script,
    },
  },
}

const pkgJson = (agent: string, pkg: string): string =>
  path.join(CONFIG_DIR, "runtimes", agent, "node_modules", pkg, "package.json")
const legacyPkgJson = (pkg: string): string =>
  path.join(PORTABLE_NODE_DIR, "node_modules", pkg, "package.json")

function makeService(resolveBinary: (t: string) => string | null) {
  return new InstallService({
    connector: () => ({
      registry: { getEntry: (t: string) => REGISTRY[t] || null },
    }),
    clearCatalogCache: () => undefined,
    getCatalog: async () => [],
    resolveBinary,
  })
}

const none = (): null => null

beforeEach(() => {
  files.clear()
})

/**
 * The install history and the core's markers are write-once claims that nothing
 * re-checks. On Windows, 2026-08-17, that showed a user "Codex, installed
 * v0.133.0, update available" for a CLI that `where codex` could not find —
 * every sign-in attempt failed and the marketplace hid the one button (Install)
 * that would have fixed it.
 */
describe("installVanished", () => {
  it("calls out an npm agent whose package is gone", () => {
    const svc = makeService(none)
    expect(svc.installVanished("codex")).toBe(true)
  })

  it("leaves it alone when the package is right there", () => {
    files.set(
      pkgJson("codex", "@openai/codex"),
      JSON.stringify({ version: "0.147.0" }),
    )
    expect(makeService(none).installVanished("codex")).toBe(false)
  })

  it("accepts the legacy shared prefix too", () => {
    files.set(
      legacyPkgJson("@openai/codex"),
      JSON.stringify({ version: "0.133.0" }),
    )
    expect(makeService(none).installVanished("codex")).toBe(false)
  })

  it("accepts a global install the launcher never made", () => {
    const svc = makeService((t) =>
      t === "codex" ? "C:\\npm\\codex.cmd" : null,
    )
    expect(svc.installVanished("codex")).toBe(false)
  })

  it("never judges a script-installed CLI — there is no package to look for", () => {
    // Cursor's installer drops an exe and edits the registry PATH; nothing about
    // it lives in node_modules, so an empty disk here proves nothing.
    expect(makeService(none).installVanished("cursor")).toBe(false)
  })

  it("never judges an agent the registry doesn't know", () => {
    expect(makeService(none).installVanished("nope")).toBe(false)
  })
})

describe("listInstalledAgents", () => {
  const history = (data: Record<string, unknown>): void => {
    files.set(INSTALLED_HISTORY_FILE, JSON.stringify(data))
  }

  it("drops a record whose package no longer exists", () => {
    history({
      codex: { name: "codex", version: "0.133.0", installedAt: "2026-08-17" },
    })
    expect(makeService(none).listInstalledAgents()).toEqual([])
  })

  it("keeps it once the package is back, and reports the DISK version", () => {
    history({
      codex: { name: "codex", version: "0.133.0", installedAt: "2026-08-17" },
    })
    files.set(
      pkgJson("codex", "@openai/codex"),
      JSON.stringify({ version: "0.147.0" }),
    )
    const [rec] = makeService(none).listInstalledAgents()
    // The record still says 0.133.0 — an update outside the launcher is exactly
    // the case where believing the record misreports what is running.
    expect(rec.version).toBe("0.147.0")
  })

  it("keeps a script-installed agent on its recorded version", () => {
    history({
      cursor: {
        name: "cursor",
        version: "2026.8.1",
        installedAt: "2026-08-17",
      },
    })
    const [rec] = makeService(none).listInstalledAgents()
    expect([rec.name, rec.version]).toEqual(["cursor", "2026.8.1"])
  })
})
