/**
 * The login shell's environment, for the keys people export in their profile.
 *
 * A launcher started from Finder or the Dock inherits none of `~/.zshrc`, so
 * `process.env` alone misses exactly the variables an import is looking for.
 * This is the probe the core already runs for PATH (agent-connector paths.js,
 * `loginShellDirs`), except that it runs only when the user asks to import —
 * never at startup — and its result lives for that one scan. Windows GUI apps
 * do inherit the user's variables, so the process env is the answer there.
 */
import { spawn } from "node:child_process"

const DELIM = "__OPENAGENTS_IMPORT_ENV__"
const TIMEOUT_MS = 6000

export function readShellEnv(): Promise<Record<string, string>> {
  const base: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v != null) base[k] = v
  if (process.platform === "win32") return Promise.resolve(base)

  return new Promise((resolve) => {
    let out = ""
    let settled = false
    let child: ReturnType<typeof spawn> | null = null
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ...base, ...parseEnvBlock(out) })
    }
    const timer = setTimeout(() => {
      try {
        child?.kill("SIGKILL")
      } catch {}
      finish()
    }, TIMEOUT_MS)
    try {
      child = spawn(
        process.env.SHELL || "/bin/zsh",
        ["-ilc", `echo ${DELIM}; command env; echo ${DELIM}`],
        // stdin closed and stderr dropped: an interactive shell without a tty
        // writes job-control warnings there.
        { stdio: ["ignore", "pipe", "ignore"] },
      )
    } catch {
      finish()
      return
    }
    child.stdout?.on("data", (c: Buffer) => (out += c.toString("utf-8")))
    child.on("error", finish)
    child.on("close", finish)
  })
}

/**
 * The `env` output between the delimiters. A chatty rc file — a banner, a
 * version manager announcing itself — prints around them, not between.
 */
export function parseEnvBlock(out: string): Record<string, string> {
  const parts = out.split(DELIM)
  if (parts.length < 3) return {}
  const env: Record<string, string> = {}
  for (const line of parts[1].split(/\r?\n/)) {
    const i = line.indexOf("=")
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1)
  }
  return env
}
