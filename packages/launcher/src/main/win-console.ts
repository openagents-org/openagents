/**
 * Stop Windows from popping a console window for every child process.
 *
 * An Electron main process is a GUI process: it owns no console. When such a
 * process launches a console executable *without* CREATE_NO_WINDOW, Windows
 * allocates a brand-new console for the child — an empty black cmd / Windows
 * Terminal window that appears out of nowhere and steals focus. Nothing is ever
 * drawn in it because we pipe the child's stdio, so all the user sees is a
 * blank window (titled with the child's path, e.g. `…\.openagents\nodejs\node.exe`).
 *
 * Node exposes CREATE_NO_WINDOW as the `windowsHide` spawn option. Our own call
 * sites pass it, but the agent-launcher core is loaded *in-process* here, and an
 * older core installed under ~/.openagents predates its own fix — so the default
 * is applied process-wide instead of trusting every caller.
 *
 * Two things this deliberately does NOT do:
 *   - override an explicit `windowsHide: false` — the CLI sign-in flow opens a
 *     real terminal that way, and that window is the point; and
 *   - break interactive output: libuv only applies CREATE_NO_WINDOW when no
 *     stdio handle is inherited, so inherit-stdio children are untouched.
 *
 * ComSpec is pinned to cmd.exe here too, for the same reason — see pinComSpec.
 *
 * This module is imported for its side effect and must stay the FIRST import in
 * main/index.ts — imports run in order, and the core is required (and captures
 * its child_process references) while they do.
 */
import childProcess from "child_process"
import fs from "fs"
import path from "path"

type AnyFn = (...args: unknown[]) => unknown

const PATCHED = Symbol.for("openagents.windowsHideDefault")
const WRAPPED = [
  "spawn",
  "spawnSync",
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
] as const

// Node's own test for "the shell is cmd.exe" (normalizeSpawnArguments in
// lib/child_process.js). A shell that fails it is handed `-c <command>` rather
// than `/d /s /c "<command>"`.
const CMD_EXE = /^(?:.*\\)?cmd(?:\.exe)?$/i

/**
 * A copy of `args` whose options object carries `windowsHide: true`.
 *
 * Every child_process signature ends with `[options][, callback]`, so the
 * options object — when there is one — is the last non-function argument. The
 * caller's object is copied, never mutated: callers reuse option objects and
 * must not see ours leak into their state.
 */
export function withWindowsHide(args: unknown[]): unknown[] {
  const out = args.slice()
  const cbIdx = typeof out[out.length - 1] === "function" ? out.length - 1 : -1
  const optIdx = cbIdx === -1 ? out.length - 1 : cbIdx - 1
  const opts = optIdx >= 0 ? out[optIdx] : undefined

  if (opts && typeof opts === "object" && !Array.isArray(opts)) {
    if ("windowsHide" in opts) return args // explicit wins, either way
    out[optIdx] = { ...(opts as Record<string, unknown>), windowsHide: true }
    return out
  }
  // No options argument at all — insert one ahead of any callback.
  out.splice(cbIdx === -1 ? out.length : cbIdx, 0, { windowsHide: true })
  return out
}

/** Default `windowsHide: true` for this process. No-op off Windows; idempotent. */
export function installWindowsHideDefault(): void {
  if (process.platform !== "win32") return
  const cp = childProcess as unknown as Record<string | symbol, unknown>
  if (cp[PATCHED]) return

  for (const name of WRAPPED) {
    const original = cp[name]
    if (typeof original !== "function") continue
    const fn = original as AnyFn
    const wrapper = function (this: unknown, ...args: unknown[]): unknown {
      return fn.apply(this, withWindowsHide(args))
    }
    // Keep util.promisify(exec) and friends working.
    for (const sym of Object.getOwnPropertySymbols(fn)) {
      ;(wrapper as unknown as Record<symbol, unknown>)[sym] = (
        fn as unknown as Record<symbol, unknown>
      )[sym]
    }
    Object.defineProperty(wrapper, "name", { value: name })
    cp[name] = wrapper
  }
  cp[PATCHED] = true
}

/**
 * Point ComSpec at the real cmd.exe, in `env` (default: this process).
 *
 * ComSpec is what Windows runs a batch file with (`%ComSpec% /c "x.cmd" …`)
 * and the shell Node picks for every `shell: true` spawn and exec. On a machine
 * that points it at PowerShell, an agent CLI's .cmd shim starts as
 * `pwsh /c "x.cmd"`, which runs x.cmd again — an endless chain of pwsh
 * processes (seen: 1,048 of them under this launcher) — and `where`, which
 * PowerShell reads as Where-Object, finds nothing, so installed CLIs show as
 * "not installed". Set here, it covers the launcher's own spawns and the
 * daemon, which inherits it; the core pins it too, but the core loaded
 * in-process may predate that.
 *
 * Only a value that fails Node's cmd.exe test is replaced; a missing one is
 * filled in. The key keeps its casing so a copied env never ends up with two.
 * Mirrors pinComSpec in agent-connector's win-console.js; keep the two in step.
 * Returns true when it changed `env`.
 */
export function pinComSpec(
  env: NodeJS.ProcessEnv = process.env,
  // Injected so the Windows branch is testable from any machine.
  platform: string = process.platform,
  exists: (p: string) => boolean = fs.existsSync,
): boolean {
  if (platform !== "win32") return false
  const keyOf = (lower: string) =>
    Object.keys(env).find((k) => k.toLowerCase() === lower)
  const key = keyOf("comspec") || "ComSpec"
  if (CMD_EXE.test(env[key] || "")) return false
  const rootKey = keyOf("systemroot") || keyOf("windir")
  const cmdExe = path.win32.join(
    (rootKey && env[rootKey]) || "C:\\Windows",
    "System32",
    "cmd.exe",
  )
  let found = false
  try {
    found = exists(cmdExe)
  } catch {
    /* unreadable — fall back to the bare name */
  }
  // Bare `cmd.exe` when System32 isn't where we looked: PATH still finds it,
  // and it passes the same test.
  env[key] = found ? cmdExe : "cmd.exe"
  return true
}

installWindowsHideDefault()
pinComSpec()
