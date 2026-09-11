import { beforeEach, describe, expect, it, vi } from "vitest"

// The whole point of these cases is what is and isn't on disk, so fs is the
// thing under control. Only the two reads installVanished/getInstalledVersion
// make are modelled: existsSync and readFileSync.
const files = new Map<string, string>()
const links = new Map<string, string>()
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
    // Global installs link their bin at the real file inside the package.
    realpathSync: (p: string) => links.get(String(p)) || String(p),
  }
  return { ...api, default: api }
})

// The install cases run npm as a fake process that records its argv and exits
// 0, and read the registry from a fixture instead of the network.
const spawned: string[][] = []
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>()
  const { EventEmitter } = await import("events")
  const stream = () =>
    Object.assign(new EventEmitter(), { setEncoding: () => undefined })
  const spawn = (_cmd: string, args: string[]) => {
    spawned.push(args)
    const proc = Object.assign(new EventEmitter(), {
      stdout: stream(),
      stderr: stream(),
    })
    setTimeout(() => proc.emit("close", 0), 0)
    return proc
  }
  return { ...actual, default: { ...actual, spawn }, spawn }
})
let npmInfo: unknown = null
vi.mock("./npm-registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./npm-registry")>()),
  fetchNpmInfo: async () => npmInfo,
}))

import path from "path"

import { InstallService } from "./install-service"
import { CONFIG_DIR, INSTALLED_HISTORY_FILE, PORTABLE_NODE_DIR } from "./paths"

const npmInstall = "npm install -g @openai/codex"
const openclawInstall = "npm install -g openclaw@latest"
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
  // npm-backed and floating on `latest` — the shape the Node check guards.
  openclaw: {
    name: "openclaw",
    install: {
      binary: "openclaw",
      macos: openclawInstall,
      linux: openclawInstall,
      windows: openclawInstall,
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
  links.clear()
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

/**
 * A globally-installed CLI used to report no version at all, because only the
 * launcher's own runtime prefixes were consulted. isUpgradeAvailable(null, x)
 * is false, so those agents could never be told they were out of date — the
 * marketplace said "0 updates" while the CLI was old enough for the backend to
 * refuse it outright (#649: "The 'gpt-5.6-sol' model requires a newer version
 * of Codex").
 */
describe("getInstalledVersion — globally installed CLIs", () => {
  const globalBin = "/Users/u/.local/bin/codex"
  const realBin = "/Users/u/.local/lib/node_modules/@openai/codex/bin/codex.js"
  const globalPkg = "/Users/u/.local/lib/node_modules/@openai/codex/package.json"

  it("reads the version off the package that owns the binary", () => {
    links.set(globalBin, realBin)
    files.set(globalPkg, JSON.stringify({ name: "@openai/codex", version: "0.150.0" }))
    const svc = makeService((t) => (t === "codex" ? globalBin : null))
    expect(svc.getInstalledVersion("codex")).toBe("0.150.0")
  })

  it("prefers a launcher-managed copy over the global one", () => {
    links.set(globalBin, realBin)
    files.set(globalPkg, JSON.stringify({ name: "@openai/codex", version: "0.150.0" }))
    files.set(pkgJson("codex", "@openai/codex"), JSON.stringify({ version: "0.160.0" }))
    const svc = makeService((t) => (t === "codex" ? globalBin : null))
    expect(svc.getInstalledVersion("codex")).toBe("0.160.0")
  })

  it("refuses a package.json that belongs to something else", () => {
    // A wrapper script parked inside an unrelated package must not lend it its
    // version — that would report a confident number that is simply wrong.
    links.set(globalBin, "/opt/tools/bin/codex")
    files.set("/opt/tools/package.json", JSON.stringify({ name: "some-toolbox", version: "9.9.9" }))
    const svc = makeService((t) => (t === "codex" ? globalBin : null))
    expect(svc.getInstalledVersion("codex")).toBe(null)
  })

  it("stays null for a script-installed CLI with no npm package", () => {
    const svc = makeService(() => "/Users/u/.cursor/bin/cursor-agent")
    expect(svc.getInstalledVersion("cursor")).toBe(null)
  })

  it("stays null when no binary resolves at all", () => {
    expect(makeService(none).getInstalledVersion("codex")).toBe(null)
  })
})

/**
 * openclaw 2026.9.3 raised its floor to Node 24.16 with a preinstall script
 * that exits non-zero below it. The launcher installs and runs agents on its
 * portable Node 22, so from 2026-09-11 every openclaw update — and every fresh
 * install — failed, while the badge kept offering the release that couldn't
 * install.
 */
describe("when npm's latest refuses the agents' Node", () => {
  const NODE_22_OK = ">=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0"
  const NODE_24_ONLY = ">=24.16.0 <25 || >=26.1.0"

  beforeEach(() => {
    spawned.length = 0
    npmInfo = {
      "dist-tags": { latest: "2026.9.4" },
      versions: {
        "2026.9.2": { engines: { node: NODE_22_OK } },
        "2026.9.3": { engines: { node: NODE_24_ONLY } },
        "2026.9.4": { engines: { node: NODE_24_ONLY } },
      },
    }
  })

  function service(node: string | null) {
    const installStreaming = vi.fn(async () => ({ success: true }))
    const svc = new InstallService({
      connector: () => ({
        registry: { getEntry: (t: string) => REGISTRY[t] || null },
        installer: { hasNodejs: () => true, installStreaming },
      }),
      clearCatalogCache: () => undefined,
      getCatalog: async () => [{ ...REGISTRY.openclaw, installed: true }],
      resolveBinary: none,
      nodeVersion: async () => node,
    })
    return { svc, installStreaming }
  }

  it("offers the newest release that runs, not one that can't install", async () => {
    const { svc } = service("22.22.3")
    const [update] = await svc.checkAgentUpdates({ force: true })
    expect(update.latest).toBe("2026.9.2")
  })

  it("updates to that release, and says why it isn't the newest", async () => {
    const log: string[] = []
    const result = await service("22.22.3").svc.updateAgentTypeStreaming(
      "openclaw",
      (d) => log.push(d),
    )
    expect(result).toMatchObject({ success: true, version: "2026.9.2" })
    expect(spawned[0]).toContain("openclaw@2026.9.2")
    expect(log.join("")).toContain("requires Node >=24.16.0")
  })

  it("installs it fresh the same way, instead of handing the core `latest`", async () => {
    const { svc, installStreaming } = service("22.22.3")
    await svc.installAgentTypeStreaming("openclaw", () => undefined)
    expect(installStreaming).not.toHaveBeenCalled()
    expect(spawned[0]).toContain("openclaw@2026.9.2")
  })

  it.each(["24.20.0", null])("changes nothing on Node %s", async (node) => {
    // New enough, or no Node to ask: `latest` as before, and a fresh install
    // stays with the core, which owns the full install pipeline.
    const { svc, installStreaming } = service(node)
    const [update] = await svc.checkAgentUpdates({ force: true })
    expect(update.latest).toBe("2026.9.4")
    await svc.updateAgentTypeStreaming("openclaw", () => undefined)
    expect(spawned[0]).toContain("openclaw@latest")
    await svc.installAgentTypeStreaming("openclaw", () => undefined)
    expect(installStreaming).toHaveBeenCalledOnce()
  })
})
