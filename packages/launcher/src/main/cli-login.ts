import { execFile, spawn, type ChildProcess } from "child_process"

import {
  BROWSER_CLAIMED,
  CODE_PROMPT,
  findAuthUrl,
  LOGIN_FAILURE,
  LOGIN_SUCCESS,
  loginArgs,
  needsRealTerminal,
  NO_TTY,
  stripAnsi,
  YES_NO_PROMPT,
} from "./cli-login-patterns"

/**
 * In-app CLI sign-in: run `<cli> login` under PIPES inside the launcher and
 * host its browser flow in the UI, instead of throwing the user at a terminal
 * window and hoping they find the URL in it.
 *
 * The old flow opened Terminal.app / a cmd window and then let go — the launcher
 * only polled `status` for 24s. Users reported "there is no URL": it sat in
 * another app's window, wrapped across lines, sometimes with the browser having
 * failed to open and a code that had to be pasted BACK into a terminal they'd
 * already closed. Here the URL is a button in the launcher, the code has a text
 * field, and the result is read off the CLI's own stdout.
 *
 * Not every CLI cooperates — hermes and gemini demand a real TTY — so this
 * degrades on its own: the terminal path stays as the fallback and is taken
 * automatically when the CLI says it needs a terminal, when it dies immediately,
 * or when it prints nothing at all. See `cli-login-patterns.ts` for the captured
 * output each CLI actually produces.
 */

export type CliLoginPhase =
  | "starting"
  | "browser"
  | "code"
  | "verifying"
  | "success"
  | "failed"
  | "cancelled"
  | "terminal"

export interface CliLoginEvent {
  agentType: string
  phase: CliLoginPhase
  /** The sign-in URL, once the CLI has printed it. */
  url?: string
  /** The CLI's own words, for the failure and terminal-fallback cases. */
  message?: string
}

export interface CliLoginDeps {
  /** Absolute path to the agent's CLI, or null when it isn't installed. */
  resolveBinary(type: string): string | null
  /** e.g. "claude auth login" — the same string the terminal path runs. */
  loginCommandFor(type: string): string | null
  /** The core's enhanced-PATH child env (what the daemon spawns agents with). */
  childEnv(extra?: Record<string, string>): NodeJS.ProcessEnv
  /** A FRESH sign-in probe — the authority on whether the login worked. */
  verifyLogin(type: string): Promise<boolean>
  openExternal(url: string): void
  openTerminal(cmd: string): void
  emit(ev: CliLoginEvent): void
}

/** How often the sign-in probe re-checks while a login is in flight. */
const POLL_MS = 2_500
/** …and for how long. The old flow gave up after 24s, which was the bug. */
const POLL_LIMIT_MS = 5 * 60_000
/** A CLI that prints nothing this long isn't going to drive a piped login. */
const SILENT_MS = 15_000
/** An exit this fast, with no URL, means the piped attempt was refused. */
const INSTANT_EXIT_MS = 4_000
/** Kept only to quote the CLI back at the user on failure. */
const TAIL_LIMIT = 8_000

const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms))

/** The first non-empty line of `text`, trimmed — used for error messages. */
function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) || ""
  )
}

class LoginSession {
  private child: ChildProcess | null = null
  private buffer = ""
  private url: string | null = null
  private answeredPrompt = false
  private settled = false
  private startedAt = Date.now()
  private baseline: boolean | null = null
  private poll: ReturnType<typeof setInterval> | null = null
  private silent: ReturnType<typeof setTimeout> | null = null
  private grace: ReturnType<typeof setTimeout> | null = null
  private pollStartedAt = 0

  constructor(
    private readonly type: string,
    private readonly cmd: string,
    private readonly deps: CliLoginDeps,
  ) {}

  /**
   * Try the in-app flow, falling back to a terminal window when this CLI (or
   * this machine) can't support it. Either way the sign-in probe starts polling,
   * so the UI flips to "signed in" on its own once the user finishes.
   */
  start(forceTerminal = false): { mode: "in-app" | "terminal" } {
    // Whether the agent was ALREADY signed in when we started. A re-login can't
    // be detected by polling (the probe reads true the whole time), so in that
    // case only the CLI's own output counts as success.
    void this.deps
      .verifyLogin(this.type)
      .then((v) => {
        this.baseline = v
      })
      .catch(() => {
        this.baseline = false
      })
    this.startPolling()

    const bin = this.deps.resolveBinary(this.type)
    if (forceTerminal || needsRealTerminal(this.type, this.cmd) || !bin) {
      this.useTerminal()
      return { mode: "terminal" }
    }
    try {
      this.spawnCli(bin)
    } catch (e) {
      this.useTerminal((e as Error).message)
      return { mode: "terminal" }
    }
    this.emit("starting")
    return { mode: "in-app" }
  }

  private spawnCli(bin: string): void {
    // Windows `.cmd`/`.bat` shims can't be launched via CreateProcess directly —
    // same rule the daemon's adapter and the status probe use.
    const useShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)
    const child = spawn(bin, loginArgs(this.cmd), {
      stdio: ["pipe", "pipe", "pipe"],
      // A wide COLUMNS keeps the 300-character PKCE URL on ONE line: wrapped at
      // 80 it would arrive split and neither openable nor copyable. Colour off
      // so the patterns match plain text.
      env: this.deps.childEnv({
        COLUMNS: "400",
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      }),
      windowsHide: true,
      shell: useShell,
    })
    this.child = child
    this.startedAt = Date.now()
    child.stdout?.on("data", (d: Buffer) => this.onOutput(String(d)))
    child.stderr?.on("data", (d: Buffer) => this.onOutput(String(d)))
    child.on("error", (e: Error) => this.useTerminal(e.message))
    child.on("exit", (code) => this.onExit(code))
    this.silent = setTimeout(() => this.useTerminal(), SILENT_MS)
  }

  private onOutput(raw: string): void {
    if (this.settled) return
    const text = stripAnsi(raw)
    this.buffer = (this.buffer + text).slice(-TAIL_LIMIT)
    if (this.silent) {
      clearTimeout(this.silent)
      this.silent = null
    }

    if (NO_TTY.test(text)) {
      this.useTerminal(firstLine(text))
      return
    }
    if (!this.url) {
      const url = findAuthUrl(text)
      if (url) {
        this.url = url
        // Only open it ourselves when the CLI didn't already — claude and
        // cursor-agent both open one, and two tabs of the same PKCE flow is a
        // worse first impression than one.
        if (!BROWSER_CLAIMED.test(this.buffer)) this.deps.openExternal(url)
        this.emit("browser")
      }
    }
    // amp gates the real login behind "Do you want to log in again? [(y)es,
    // (n)o]:" — answer it, or the login never starts.
    if (!this.answeredPrompt && YES_NO_PROMPT.test(text)) {
      this.answeredPrompt = true
      this.write("y")
      return
    }
    if (LOGIN_SUCCESS.test(text)) {
      void this.finish()
      return
    }
    if (LOGIN_FAILURE.test(text)) {
      this.settle("failed", firstLine(text))
      return
    }
    if (this.url && CODE_PROMPT.test(text)) this.emit("code")
  }

  private onExit(code: number | null): void {
    this.child = null
    if (this.settled) return
    // Refused the pipe without even saying so: give the user the terminal.
    if (!this.url && Date.now() - this.startedAt < INSTANT_EXIT_MS) {
      this.useTerminal(firstLine(this.buffer))
      return
    }
    if (code === 0) {
      void this.finish()
      return
    }
    void this.deps
      .verifyLogin(this.type)
      .then((ok) =>
        ok
          ? this.settle("success")
          : this.settle("failed", firstLine(this.buffer)),
      )
      .catch(() => this.settle("failed", firstLine(this.buffer)))
  }

  /** The user pasted the code the browser showed them. */
  submitCode(code: string): void {
    if (this.settled) return
    this.write(code.trim())
    this.emit("verifying")
  }

  private write(line: string): void {
    try {
      this.child?.stdin?.write(line + "\n")
    } catch {
      /* the CLI closed stdin — the exit handler settles this */
    }
  }

  /**
   * The CLI says it worked. Re-probe so the cached health (and the Agents list)
   * catches up, but don't let a probe that lags behind the credentials file
   * overrule the CLI's own verdict.
   */
  private async finish(): Promise<void> {
    if (this.settled) return
    this.emit("verifying")
    for (let i = 0; i < 3; i++) {
      try {
        if (await this.deps.verifyLogin(this.type)) break
      } catch {
        /* keep trying */
      }
      if (this.settled) return
      await delay(1_500)
    }
    this.settle("success")
  }

  private useTerminal(message?: string): void {
    if (this.settled) return
    // Never leave a half-alive piped attempt holding the CLI's lock/stdin while
    // a second copy of it runs in the terminal.
    this.killChild()
    try {
      this.deps.openTerminal(this.cmd)
    } catch (e) {
      this.settle("failed", (e as Error).message)
      return
    }
    this.emit("terminal", message)
  }

  private startPolling(): void {
    if (this.poll) return
    this.pollStartedAt = Date.now()
    this.poll = setInterval(() => void this.pollOnce(), POLL_MS)
  }

  /**
   * The sign-in probe is the one signal that works for EVERY path — in-app,
   * terminal fallback, or the user signing in somewhere else entirely — so it
   * runs for the full five minutes rather than the button's lifetime.
   */
  private async pollOnce(): Promise<void> {
    if (this.settled) return
    if (Date.now() - this.pollStartedAt > POLL_LIMIT_MS) {
      this.stopTimers()
      return
    }
    // Already signed in before we started: a `true` here proves nothing.
    if (this.baseline !== false) return
    try {
      if (await this.deps.verifyLogin(this.type)) this.settle("success")
    } catch {
      /* transient probe failure — the next tick retries */
    }
  }

  private settle(phase: CliLoginPhase, message?: string): void {
    if (this.settled) return
    this.settled = true
    this.stopTimers()
    if (phase === "success") {
      // Let the CLI finish writing its credentials and exit on its own; killing
      // it the instant it prints "Login successful." can truncate that write.
      this.grace = setTimeout(() => this.killChild(), 20_000)
    } else {
      this.killChild()
    }
    this.emit(phase, message)
  }

  cancel(): void {
    if (this.settled) return
    this.settled = true
    this.stopTimers()
    this.killChild()
    this.emit("cancelled")
  }

  dispose(): void {
    this.settled = true
    this.stopTimers()
    if (this.grace) clearTimeout(this.grace)
    this.killChild()
  }

  private stopTimers(): void {
    if (this.poll) clearInterval(this.poll)
    if (this.silent) clearTimeout(this.silent)
    this.poll = null
    this.silent = null
  }

  private killChild(): void {
    const child = this.child
    this.child = null
    if (!child || child.exitCode !== null) return
    try {
      // A shell-wrapped .cmd on Windows leaves the real CLI running when only
      // cmd.exe is killed — take the tree.
      if (process.platform === "win32" && child.pid) {
        execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {})
      } else {
        child.kill()
      }
    } catch {
      /* already gone */
    }
  }

  private emit(phase: CliLoginPhase, message?: string): void {
    this.deps.emit({
      agentType: this.type,
      phase,
      ...(this.url ? { url: this.url } : {}),
      ...(message ? { message } : {}),
    })
  }
}

export class CliLoginManager {
  private readonly sessions = new Map<string, LoginSession>()

  constructor(private readonly deps: CliLoginDeps) {}

  /**
   * Begin (or restart) the sign-in for `type`. `terminal: true` is the user
   * explicitly asking for the old behaviour from the fallback link in the UI.
   */
  start(
    type: string,
    opts?: { terminal?: boolean },
  ): { mode: "in-app" | "terminal" } {
    const cmd = this.deps.loginCommandFor(type)
    if (!cmd) throw new Error(`Agent type '${type}' has no login command.`)
    this.sessions.get(type)?.dispose()
    const session = new LoginSession(type, cmd, this.deps)
    this.sessions.set(type, session)
    return session.start(opts?.terminal === true)
  }

  submitCode(type: string, code: string): void {
    this.sessions.get(type)?.submitCode(code)
  }

  cancel(type: string): void {
    this.sessions.get(type)?.cancel()
    this.sessions.delete(type)
  }

  /** App shutdown — never leave a login child behind. */
  disposeAll(): void {
    for (const s of this.sessions.values()) s.dispose()
    this.sessions.clear()
  }
}
