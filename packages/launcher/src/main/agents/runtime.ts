/**
 * Finding the pieces the launcher runs agents with: the agent-launcher core,
 * a node binary that actually launches, and a way to invoke npm.
 */
import path from "path"
import fs from "fs"
import { spawnSync } from "child_process"
import { withPathEnv } from "../env"
import { compareVersions } from "../../shared/version-compare"
import { CONFIG_DIR, GLOBAL_CORE, LOCAL_CORE } from "./paths"

/** The install-command key for this OS, as the shared registry spells it. */
export function platformKey(): "macos" | "linux" | "windows" {
  if (process.platform === "darwin") return "macos"
  if (process.platform === "win32") return "windows"
  return "linux"
}

/** Which copy of the core a tier refers to. */
export type CoreSource = "local" | "global" | "bundled"

export interface CoreTier {
  /** Package root — the directory holding the core's package.json. */
  dir: string
  /** Its version, or null when package.json is unreadable. */
  version: string | null
  source: CoreSource
}

/** A path inside app.asar rewritten to its unpacked twin (see build.asarUnpack). */
export function unpackedPath(p: string): string {
  return p.includes("app.asar") && !p.includes("app.asar.unpacked")
    ? p.replace("app.asar", "app.asar.unpacked")
    : p
}

/** The core packaged with the app, located however the bundler laid it out. */
export function bundledCoreDir(): string | null {
  try {
    return path.dirname(
      require.resolve("@openagents-org/agent-launcher/package.json"),
    )
  } catch {
    return null
  }
}

function coreVersionAt(dir: string): string | null {
  try {
    const v = JSON.parse(
      fs.readFileSync(path.join(dir, "package.json"), "utf-8"),
    ).version
    return typeof v === "string" && v ? v : null
  } catch {
    return null
  }
}

function tierAt(dir: string | null, source: CoreSource): CoreTier | null {
  if (!dir) return null
  try {
    if (!fs.existsSync(path.join(dir, "package.json"))) return null
  } catch {
    return null
  }
  return { dir, version: coreVersionAt(dir), source }
}

/**
 * Every core we could run, best first.
 *
 * Three copies exist: the monorepo's (dev), the one the runtime bootstrap
 * downloads from npm, and the one packaged inside the app. The downloaded copy
 * used to win outright, which pinned every user to whatever npm's `latest`
 * dist-tag happened to be — so an app built against a newer core still ran the
 * older one, and anything shipping IN the core (an adapter, and the registry
 * entry describing it) stayed invisible until a publish went out.
 *
 * Kimi Code CLI was exactly that: the app shipped core 0.2.175, npm's latest
 * was still 0.2.173, and 0.2.173 describes kimi as an API-only agent with no
 * installer and no `kimi login`. The marketplace faithfully showed the old
 * agent while the new one sat unused in the app bundle.
 *
 * So the monorepo copy still wins in dev, and otherwise the NEWEST of the
 * downloaded and packaged copies does. A core newer than the app still takes
 * effect — that is what the bootstrap is for — but one older than the app can
 * no longer downgrade it. Ties and unreadable versions keep the previous
 * precedence (downloaded before packaged), because sort is stable.
 */
export function coreTiers(): CoreTier[] {
  return orderCoreTiers([
    tierAt(LOCAL_CORE, "local"),
    tierAt(GLOBAL_CORE, "global"),
    tierAt(bundledCoreDir(), "bundled"),
  ])
}

/**
 * The ordering rule on its own, so it can be exercised without three real
 * install trees on disk. Pass the tiers in discovery order (local, global,
 * bundled): a tie keeps that order, since sort is stable.
 */
export function orderCoreTiers(tiers: Array<CoreTier | null>): CoreTier[] {
  const present = tiers.filter((t): t is CoreTier => t !== null)
  return [
    ...present.filter((t) => t.source === "local"),
    ...present
      .filter((t) => t.source !== "local")
      .sort((a, b) => compareCoreVersions(b.version, a.version)),
  ]
}

/** Semver order, with an unreadable version sorting below a readable one. */
function compareCoreVersions(a: string | null, b: string | null): number {
  if (!a && !b) return 0
  if (!a) return -1
  if (!b) return 1
  return compareVersions(a, b) ?? 0
}

/**
 * Load the agent-launcher core — the newest one available (see coreTiers),
 * falling through to the next tier if a load throws.
 */
export function loadCore(): Record<string, unknown> | null {
  for (const tier of coreTiers()) {
    try {
      return require(tier.dir)
    } catch (e) {
      console.error(`Failed to load ${tier.source} core:`, e)
    }
  }
  // Every tier failed. Callers surface this as "core not ready", but without
  // the errors above that state is impossible to diagnose from a user's log —
  // this is the single most common failure mode on Windows.
  console.error("loadCore: no core package could be loaded")
  return null
}

/** Version of the core we would run — the first tier that declares one. */
export function readCoreVersion(): string | null {
  for (const tier of coreTiers()) if (tier.version) return tier.version
  return null
}

/**
 * Smoke-test a node binary by running `--version`. Returns false if the
 * binary is missing, blocked by Defender/SmartScreen, has an arch mismatch,
 * or any other CreateProcess failure. Used to avoid spawning the daemon with
 * a bundled node.exe that Windows refuses to load — which would otherwise
 * leave the daemon perpetually offline.
 */
export function canExecuteNode(binaryPath: string): boolean {
  try {
    const r = spawnSync(binaryPath, ["--version"], {
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    return r.status === 0 && !r.error
  } catch {
    return false
  }
}

/**
 * Resolve a working node binary, preferring the bundled portable runtime
 * when it actually launches, otherwise falling back to a system `node` on
 * PATH. Returns null if nothing works.
 */
export function resolveWorkingNode(
  portableNodeDir: string,
  enhancedPath: string,
): string | null {
  const candidates = [
    path.join(
      portableNodeDir,
      "node" + (process.platform === "win32" ? ".exe" : ""),
    ),
    path.join(portableNodeDir, "bin", "node"),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c) && canExecuteNode(c)) return c
  }
  // Bundled node missing or won't run — try the system one.
  try {
    const which = process.platform === "win32" ? "where" : "which"
    const out = require("child_process").execFileSync(which, ["node"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      windowsHide: true,
      env: withPathEnv(enhancedPath),
    }) as string
    for (const line of out
      .split(/\r?\n/)
      .map((s: string) => s.trim())
      .filter(Boolean)) {
      if (canExecuteNode(line)) return line
    }
  } catch {}
  return null
}

/**
 * Resolve how to invoke npm for an install. Prefers running the bundled
 * `node` binary directly against `npm-cli.js` (argv passed array-style, no
 * shell) — on Windows that goes through CreateProcessW as UTF-16, so a home
 * dir with non-ASCII characters (e.g. `C:\Users\用户名\...`) is preserved
 * exactly. The legacy path (spawning `npm.cmd` via `shell:true`) instead
 * relied on a hand-written .cmd batch shim whose UTF-8 bytes cmd.exe decodes
 * with the OEM code page (936/GBK on zh-CN), corrupting the embedded node
 * path and silently breaking every install. We only fall back to that legacy
 * shell path when the bundled node / npm-cli layout is missing, so the common
 * (ASCII) case still works identically.
 */
export function resolveNpmInvocation(): {
  cmd: string
  preArgs: string[]
  useShell: boolean
} {
  const portableNodeDir = path.join(CONFIG_DIR, "nodejs")
  const exists = (p: string): boolean => {
    try {
      return fs.existsSync(p)
    } catch {
      return false
    }
  }
  const nodeBin = [
    path.join(
      portableNodeDir,
      process.platform === "win32" ? "node.exe" : "node",
    ),
    path.join(portableNodeDir, "bin", "node"),
  ].find(exists)
  if (nodeBin) {
    const npmCli = [
      path.join(portableNodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
      path.join(
        portableNodeDir,
        "lib",
        "node_modules",
        "npm",
        "bin",
        "npm-cli.js",
      ),
    ].find(exists)
    if (npmCli) return { cmd: nodeBin, preArgs: [npmCli], useShell: false }
  }
  // Bundled node/npm-cli not found — preserve legacy behaviour exactly.
  return {
    cmd: process.platform === "win32" ? "npm.cmd" : "npm",
    preArgs: [],
    useShell: true,
  }
}
