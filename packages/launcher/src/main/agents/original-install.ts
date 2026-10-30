/**
 * Updating an agent where the user installed it.
 *
 * An agent the user installed themselves (`npm i -g`, outside ~/.openagents/)
 * used to be "updated" by installing a second, launcher-managed copy under
 * ~/.openagents/runtimes/ and switching workspaces over to it. The user's own
 * copy stayed behind, out of date, and they ended up with two installs of
 * one CLI. Now the update goes into the npm prefix the existing copy lives in.
 *
 * Only npm's own global layout qualifies. Homebrew, pnpm, bun, Volta and
 * vendor installers keep their own bookkeeping, and running npm into their
 * directories would corrupt it — those keep the managed-copy behaviour.
 */
import fs from "fs"
import os from "os"
import path from "path"
import { spawn } from "child_process"

/**
 * How an update reaches the user's own install:
 *   none   — the prefix is writable; npm runs as the user
 *   prompt — needs admin rights, and the OS can ask for them (macOS)
 *   manual — needs admin rights we cannot request; the user runs the command
 */
export type Elevation = "none" | "prompt" | "manual"

export interface OriginalInstall {
  /** npm prefix the existing copy was installed into. */
  prefix: string
  elevation: Elevation
}

function readPackageName(manifest: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf-8"))
    return typeof pkg?.name === "string" ? pkg.name : null
  } catch {
    return null
  }
}

/**
 * The npm global prefix `bin` was installed into, or null when it is not an
 * npm global install of `npmPkg`.
 *
 * Windows: npm writes `<prefix>\<bin>.cmd` beside `<prefix>\node_modules\<pkg>`.
 * Elsewhere: `<prefix>/bin/<bin>` links into `<prefix>/lib/node_modules/<pkg>`.
 * The link has to sit in that prefix's own bin dir — Homebrew links
 * /opt/homebrew/bin/x into a Cellar libexec that merely has the same shape.
 */
export function npmGlobalPrefix(
  bin: string,
  npmPkg: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform === "win32") {
    const prefix = path.dirname(bin)
    const manifest = path.join(prefix, "node_modules", npmPkg, "package.json")
    return readPackageName(manifest) === npmPkg ? prefix : null
  }
  const p = path.posix
  let real: string
  try {
    real = fs.realpathSync(bin)
  } catch {
    return null
  }
  const marker = p.join(p.sep, "lib", "node_modules", npmPkg) + p.sep
  const at = real.indexOf(marker)
  if (at <= 0) return null
  const prefix = real.slice(0, at)
  if (p.dirname(bin) !== p.join(prefix, "bin")) return null
  const manifest = p.join(prefix, "lib", "node_modules", npmPkg, "package.json")
  return readPackageName(manifest) === npmPkg ? prefix : null
}

/** Where npm puts packages under a global prefix. */
export function globalModulesDir(
  prefix: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32"
    ? path.join(prefix, "node_modules")
    : path.join(prefix, "lib", "node_modules")
}

/**
 * Whether this process can write into `dir`. Probed by writing, not by
 * fs.access: on Windows access() only checks the read-only attribute and says
 * yes to Program Files, where the npm run would then fail.
 */
export function canWriteDir(dir: string): boolean {
  const probe = path.join(dir, `.openagents-write-test-${process.pid}`)
  try {
    fs.writeFileSync(probe, "")
    fs.unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

/** The user's own npm install of an agent, and what updating it needs. */
export function findOriginalInstall(
  bin: string | null,
  npmPkg: string,
): OriginalInstall | null {
  if (!bin) return null
  const prefix = npmGlobalPrefix(bin, npmPkg)
  if (!prefix) return null
  const dirs = [globalModulesDir(prefix)]
  if (process.platform !== "win32") dirs.push(path.join(prefix, "bin"))
  if (dirs.every(canWriteDir)) return { prefix, elevation: "none" }
  return {
    prefix,
    elevation: process.platform === "darwin" ? "prompt" : "manual",
  }
}

/** The npm arguments that update `npmPkg` inside `prefix`. */
export function originalUpdateArgs(
  prefix: string,
  npmPkg: string,
  spec: string,
): string[] {
  return ["install", "-g", "--prefix", prefix, `${npmPkg}@${spec}`]
}

function quoteArg(arg: string, platform: NodeJS.Platform): string {
  if (/^[\w@./:=+-]+$/.test(arg)) return arg
  return platform === "win32" ? `"${arg}"` : `'${arg.replace(/'/g, `'\\''`)}'`
}

/**
 * The command a user runs themselves for a `manual` update. Says `npm`, not
 * the launcher's bundled npm path: it is for pasting into their own terminal.
 */
export function originalUpdateCommand(
  install: OriginalInstall,
  npmPkg: string,
  spec: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const cmd = ["npm", ...originalUpdateArgs(install.prefix, npmPkg, spec)]
    .map((a) => quoteArg(a, platform))
    .join(" ")
  return install.elevation !== "none" && platform !== "win32"
    ? `sudo ${cmd}`
    : cmd
}

/** Environment the elevated shell must carry over: `do shell script` starts bare. */
const CARRIED_ENV = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "npm_config_registry",
]

/**
 * The shell command the macOS administrator prompt runs. npm's cache goes to
 * a throwaway directory: run as root against ~/.npm, it would leave
 * root-owned files there and break every later npm run as the user.
 */
export function elevatedShellCommand(
  npmCmd: string,
  npmPreArgs: string[],
  args: string[],
  pathEnv: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const q = (a: string): string => quoteArg(a, "darwin")
  const cache = path.join(os.tmpdir(), `openagents-npm-cache-${process.pid}`)
  const exports = [`PATH=${q(pathEnv)}`]
  for (const key of CARRIED_ENV) {
    const value = env[key]
    if (value) exports.push(`${key}=${q(value)}`)
  }
  const npm = [npmCmd, ...npmPreArgs, ...args, "--cache", cache].map(q)
  return `export ${exports.join(" ")}; ${npm.join(" ")} 2>&1`
}

/**
 * Run a shell command as root behind the macOS administrator prompt. The
 * command travels as an argv item, so it needs no AppleScript escaping.
 * Output arrives in one piece when it finishes; `do shell script` does not
 * stream.
 */
export function runWithAdminPrompt(
  shellCommand: string,
  onData: (data: string) => void,
): Promise<{ success: boolean; cancelled: boolean; error?: string }> {
  const script = [
    "on run argv",
    "do shell script (item 1 of argv) with administrator privileges",
    "end run",
  ]
  const args = script.flatMap((line) => ["-e", line]).concat(shellCommand)
  return new Promise((resolve) => {
    let out = ""
    let err = ""
    const proc = spawn("/usr/bin/osascript", args, {
      stdio: ["ignore", "pipe", "pipe"],
    })
    proc.stdout?.setEncoding("utf-8")
    proc.stderr?.setEncoding("utf-8")
    proc.stdout?.on("data", (d) => (out += d))
    proc.stderr?.on("data", (d) => (err += d))
    proc.on("error", (e) =>
      resolve({ success: false, cancelled: false, error: e.message }),
    )
    proc.on("close", (code) => {
      if (out) onData(out.endsWith("\n") ? out : `${out}\n`)
      if (code === 0) return resolve({ success: true, cancelled: false })
      // -128 is AppleScript's "User canceled."
      const cancelled = /-128\b/.test(err)
      if (err && !cancelled) onData(err)
      resolve({ success: false, cancelled, error: err.trim() || `exit ${code}` })
    })
  })
}
