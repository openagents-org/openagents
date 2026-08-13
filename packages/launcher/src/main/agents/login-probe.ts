/**
 * "Is this agent signed in?" for CLIs that own their own login.
 *
 * The answer comes from spawning the CLI's `status` (or, for Gemini, looking
 * for the creds file its OAuth flow writes), which can take seconds — Hermes
 * is ~2.5s. So every read is served from a cache and the spawn happens in the
 * background: the Agents list refreshes every ~1.5s and must never block on a
 * child process.
 */
import path from "path"
import fs from "fs"
import os from "os"
import { spawn } from "child_process"
import {
  DUAL_LOGIN_AGENTS,
  HOSTED_LOGIN_AGENTS,
  type HostedLoginSpec,
} from "./auth-specs"

export interface LoginProbeDeps {
  /** Absolute path to the agent's CLI, via the core's installer.which. */
  resolveBinary: (type: string) => string | null
  /** Saved type-level env, so a configured AMP_URL/AMP_API_KEY is honored. */
  getSavedTypeEnv: (type: string) => Record<string, string>
  /** The loaded core, for its getEnhancedEnv PATH builder. */
  getCore: () => Record<string, unknown> | null
  /** Fired once a probe settles, so callers can refresh what they cached. */
  onSettled: (type: string, value: boolean | null) => void
}

export class LoginProbe {
  // value: true = signed in, false = signed out, null = unknown (probe failed /
  // timed out → treated optimistically). Probing spawns the CLI's `status`, so
  // we cache for 30s and only re-probe off the hot getAgents path.
  private _auth = new Map<string, { value: boolean | null; at: number }>()
  // In-flight `status` probes, so concurrent callers share one CLI spawn.
  private _inFlight = new Map<string, Promise<boolean | null>>()

  constructor(private deps: LoginProbeDeps) {}

  /**
   * The CLI sign-in spec for an agent type, covering both pure hosted-login
   * agents (Cursor, Hermes) and dual-auth agents (Claude — API key OR CLI
   * login). Used by the shared `status`-probe machinery so a single code path
   * detects sign-in for either kind.
   */
  specFor(type: string): HostedLoginSpec | undefined {
    return HOSTED_LOGIN_AGENTS[type] || DUAL_LOGIN_AGENTS[type]
  }

  /**
   * Cached sign-in state: true (signed in) / false (signed out) / null
   * (unknown — never probed, or the probe couldn't decide). NON-BLOCKING:
   * returns the cache immediately and kicks off a background probe when the
   * cache is stale (>30s). The Configure dialog uses the awaitable refresh()
   * instead when it needs a guaranteed-fresh read.
   */
  isAuthed(type: string): boolean | null {
    const spec = this.specFor(type)
    if (!spec) return null
    const cached = this._auth.get(type)
    const fresh = !!cached && Date.now() - cached.at < 30_000
    if (!fresh) void this.refresh(type)
    return cached ? cached.value : null
  }

  /**
   * Spawn the hosted-login CLI's `status` asynchronously and cache the parsed
   * sign-in state. Deduped per type (concurrent callers share one probe) and
   * throttled (no re-spawn within 2s unless `force`d) so polling can't pile up
   * CLI processes.
   */
  refresh(type: string, force = false): Promise<boolean | null> {
    const spec = this.specFor(type)
    if (!spec) return Promise.resolve(null)
    const inflight = this._inFlight.get(type)
    if (inflight) return inflight
    const cached = this._auth.get(type)
    if (!force && cached && Date.now() - cached.at < 2_000) {
      return Promise.resolve(cached.value)
    }
    const p = this._run(type, spec)
    this._inFlight.set(type, p)
    void p.finally(() => this._inFlight.delete(type))
    return p
  }

  /**
   * Child env for a launcher-side CLI probe, built the SAME way the daemon's
   * adapter builds it: the core's getEnhancedEnv adds nvm/fnm/volta/homebrew,
   * ~/.local/bin and ~/.amp/bin to PATH and (on Windows) forces UTF-8 output +
   * ComSpec. This is what makes `amp`/`amp.cmd` resolvable from a GUI-spawned
   * process whose PATH never inherited the installer's edits — so the Agents
   * list and the daemon agree on whether amp is runnable. Never a bare
   * process.env. `extra` (e.g. AMP_API_KEY/AMP_URL) is merged in, never logged.
   */
  childEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
    const base: NodeJS.ProcessEnv = { ...process.env, ...(extra || {}) }
    try {
      // Reuse the SAME core the launcher loaded (loadCore prefers the local
      // workspace copy) so the enhanced PATH matches the daemon's exactly.
      const paths = this.deps.getCore()?.paths as
        | { getEnhancedEnv?: (e?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv }
        | undefined
      if (typeof paths?.getEnhancedEnv === "function")
        return paths.getEnhancedEnv(base)
    } catch {
      /* fall back to the un-enhanced base below */
    }
    return base
  }

  /**
   * Spawn an agent CLI for a short-lived probe (status / usage), the SAME way
   * the daemon's adapter (_spawnAmp) does: shell:true for a Windows `.cmd`/`.bat`
   * shim — Node cannot launch those directly via CreateProcess, so a bare
   * spawn(bin) throws and the probe used to fall back to a misleading "Not
   * installed". Enhanced PATH + windowsHide round it out. The shell rule mirrors
   * the shared core helper (shouldUseShellForBinary) so launcher and daemon
   * never diverge on `.cmd`.
   */
  spawnAgentCli(
    bin: string,
    args: string[],
    extra?: Record<string, string>,
  ): ReturnType<typeof spawn> {
    const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)
    return spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: this.childEnv(extra),
      windowsHide: true,
      shell: useShell,
    })
  }

  private _run(type: string, spec: HostedLoginSpec): Promise<boolean | null> {
    return new Promise((resolve) => {
      const bin = this.deps.resolveBinary(type)

      const settle = (value: boolean | null): void => {
        this._auth.set(type, { value, at: Date.now() })
        // Cache is fresh now, so a re-derive by the callback won't re-probe.
        this.deps.onSettled(type, value)
        resolve(value)
      }

      // File-based sign-in detection for CLIs with no status command (Gemini):
      // the OAuth login just writes a creds file. Check it instead of spawning
      // `statusArgs` — spawning bare `gemini` would launch its TUI and hang.
      if (spec.credsFile) {
        let value: boolean | null = null
        try {
          value = fs.existsSync(path.join(os.homedir(), spec.credsFile))
        } catch {
          value = null
        }
        settle(value)
        return
      }

      if (!bin) {
        settle(null)
        return
      }
      try {
        // Same env + Windows .cmd handling as the daemon adapter, plus the
        // saved type env so a configured AMP_URL / AMP_API_KEY is honored by the
        // `amp usage` sign-in probe (key present is itself a valid auth path).
        const child = this.spawnAgentCli(
          bin,
          spec.statusArgs,
          this.deps.getSavedTypeEnv(type),
        )
        let out = ""
        let settled = false
        const finish = (value: boolean | null): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          settle(value)
        }
        const timer = setTimeout(() => {
          try {
            child.kill()
          } catch {}
          finish(null)
        }, 8000)
        child.stdout?.on("data", (c: Buffer) => (out += c.toString("utf-8")))
        child.stderr?.on("data", (c: Buffer) => (out += c.toString("utf-8")))
        child.on("error", () => finish(null))
        child.on("close", (code) => {
          // Decide via whichever direction the spec declares. A clean run with
          // output but no match is "definitive" → the opposite of the pattern;
          // anything else stays null (unknown) so a hiccup never reads as out.
          const definitive = !!out.trim() && code === 0
          let value: boolean | null = null
          if (spec.loggedInPattern) {
            value = spec.loggedInPattern.test(out)
              ? true
              : definitive
                ? false
                : null
          } else if (spec.loggedOutPattern) {
            value = spec.loggedOutPattern.test(out)
              ? false
              : definitive
                ? true
                : null
          }
          finish(value)
        })
      } catch {
        settle(null)
      }
    })
  }
}
