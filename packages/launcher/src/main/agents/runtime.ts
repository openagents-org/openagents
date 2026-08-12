/**
 * Finding the pieces the launcher runs agents with: the agent-launcher core,
 * a node binary that actually launches, and a way to invoke npm.
 */
import path from "path"
import fs from "fs"
import { spawnSync } from "child_process"
import { withPathEnv } from "../env"
import { CONFIG_DIR, GLOBAL_CORE, LOCAL_CORE } from "./paths"

/** The install-command key for this OS, as the shared registry spells it. */
export function platformKey(): "macos" | "linux" | "windows" {
  if (process.platform === "darwin") return "macos"
  if (process.platform === "win32") return "windows"
  return "linux"
}

/**
 * Load the agent-launcher core, preferring the monorepo copy (dev), then the
 * one the runtime bootstrap installed, then the copy bundled with the app.
 */
export function loadCore(): Record<string, unknown> | null {
  if (fs.existsSync(path.join(LOCAL_CORE, "package.json"))) {
    try {
      return require(LOCAL_CORE)
    } catch (e) {
      console.error("Failed to load local core:", e)
    }
  }
  if (fs.existsSync(path.join(GLOBAL_CORE, "package.json"))) {
    try {
      return require(GLOBAL_CORE)
    } catch (e) {
      console.error("Failed to load global core:", e)
    }
  }
  try {
    return require("@openagents-org/agent-launcher")
  } catch (e) {
    console.error("Failed to load bundled core:", e)
  }
  // All three tiers failed. Callers surface this as "core not ready", but
  // without the errors above that state is impossible to diagnose from a user's
  // log — this is the single most common failure mode on Windows.
  console.error("loadCore: no core package could be loaded")
  return null
}

/** The version of whichever core tier loadCore would pick, or null. */
export function readCoreVersion(): string | null {
  for (const dir of [LOCAL_CORE, GLOBAL_CORE]) {
    try {
      const pkg = path.join(dir, "package.json")
      if (fs.existsSync(pkg))
        return JSON.parse(fs.readFileSync(pkg, "utf-8")).version
    } catch {}
  }
  try {
    return require("@openagents-org/agent-launcher/package.json").version
  } catch {}
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
