/**
 * Output grammar for the in-app CLI sign-in (see `cli-login.ts`).
 *
 * Every agent CLI drives its browser sign-in by PRINTING things — the authorize
 * URL, a "paste the code" prompt, a success line — and reading stdin. Run under
 * a pipe instead of a terminal, that output is ours to parse, which is what lets
 * the launcher host the whole flow in-app instead of shipping the user off to a
 * terminal window they then have to find (the actual support complaint: "I don't
 * see any URL").
 *
 * These are the verbatim strings, captured by running each CLI under pipes:
 *
 *   claude        "Opening browser to sign in…"
 *                 "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?…"
 *                 "Paste code here if prompted > "        ← blocks on stdin
 *                 "Login successful." / "Login failed: …" / "Invalid code. …"
 *   cursor-agent  "Waiting for browser authentication..."
 *                 "If your browser didn't open, use this link:\nhttps://cursor.com/loginDeepControl?…"
 *                 (no code to paste — it polls its own callback)
 *   amp           "Do you want to log in again? [(y)es, (n)o]: "  ← blocks on stdin
 *   hermes        "Running in a non-interactive environment (no TTY detected)."
 *                 → refuses outright; must open a real terminal
 *
 * Kept separate from the orchestrator so the parsing is unit-testable without
 * spawning anything.
 */

/** CSI / OSC escapes, so a colorized line still matches the patterns below. */
const ANSI =
  // eslint-disable-next-line no-control-regex
  /\u001B\[[0-9;?]*[ -\/]*[@-~]|\u001B\][\s\S]*?(?:\u0007|\u001B\\)/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI, "").replace(/\r/g, "\n")
}

/**
 * CLIs that will NOT do a piped login and must get a real terminal window:
 * hermes prints "no TTY detected" and quits; gemini has no login subcommand at
 * all (auth is a full-screen TUI picker). Everything else is attempted in-app
 * and falls back automatically — see NO_TTY below, which catches any CLI that
 * turns out to refuse a pipe (including a future codex that we can't probe here).
 */
export const TERMINAL_ONLY_LOGIN = new Set(["hermes", "gemini"])

/**
 * A login command with no subcommand — bare `gemini`, bare `copilot` — isn't a
 * login at all: it launches the CLI's full-screen TUI, whose `/auth` picker is
 * where the sign-in lives. Piping that gets you a hung process, so it goes
 * straight to a terminal. Catches new agents without needing a name added above.
 */
export function needsRealTerminal(type: string, loginCommand: string): boolean {
  return TERMINAL_ONLY_LOGIN.has(type) || loginArgs(loginCommand).length === 0
}

/** The CLI is telling us it needs a terminal. Fall back, don't fight it. */
export const NO_TTY =
  /\bno tty\b|not a tty|non-interactive (mode|environment)|requires? (an? )?(interactive )?(tty|terminal)|raw mode is not supported|stdin is not a terminal|must be run in an interactive/i

/** A y/n gate in front of the real login (amp asks before re-authenticating). */
export const YES_NO_PROMPT = /\[\(y\)es,\s*\(n\)o\]|\(y\/n\)|\[y\/n\]/i

/** The CLI is blocked on stdin waiting for the code from the browser. */
export const CODE_PROMPT =
  /paste (the )?code|code here|enter (the )?(auth|authorization|verification|login) code|authorization code:/i

export const LOGIN_SUCCESS =
  /login success|logged in as|successfully (logged|signed) in|authentication successful|you are now (logged|signed) in/i

export const LOGIN_FAILURE =
  /login failed|authentication failed|invalid code|invalid or expired|authorization (failed|denied)/i

/**
 * True when the CLI says it already tried to open a browser itself. Both claude
 * and cursor-agent do, so the launcher must NOT also open the URL — the user
 * would get two tabs of the same PKCE flow. When nothing in the output claims a
 * browser (an unknown CLI that only prints a link), the launcher opens it.
 */
export const BROWSER_CLAIMED =
  /opening (the |a )?browser|browser (did ?n[o']t|didn't) open|waiting for browser|opened your browser|use this link/i

const URL_RE = /https?:\/\/[^\s'"<>`)\]]+/g
/** Only a sign-in URL is worth opening — never a docs/upgrade link. */
const AUTH_URL = /oauth|authorize|\blogin\b|sign-?in|\bauth\b|device|verify|challenge/i

/**
 * The sign-in URL in a chunk of CLI output, or null. Trailing punctuation is
 * trimmed because CLIs like to end the sentence after the link.
 */
export function findAuthUrl(text: string): string | null {
  const matches = stripAnsi(text).match(URL_RE)
  if (!matches) return null
  for (const raw of matches) {
    const url = raw.replace(/[.,;:]+$/, "")
    if (!AUTH_URL.test(url)) continue
    try {
      const parsed = new URL(url)
      if (parsed.protocol === "https:" || parsed.protocol === "http:") return url
    } catch {
      /* not a URL after all */
    }
  }
  return null
}

/**
 * `"claude auth login"` → `["auth", "login"]`. The binary token is dropped: the
 * orchestrator spawns the ABSOLUTE resolved path instead, so the login never
 * depends on the PATH a GUI-launched Electron process happened to inherit (the
 * Windows "'cursor-agent' is not recognized" failure).
 */
export function loginArgs(loginCommand: string): string[] {
  return loginCommand.trim().split(/\s+/).slice(1)
}
