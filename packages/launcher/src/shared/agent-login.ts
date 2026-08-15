/**
 * Which agents can be signed in from inside the app, and which need a real
 * terminal window.
 *
 * Shared because both sides need the same answer and must not disagree: main
 * uses it to decide whether to even attempt a piped login, and the renderer
 * uses it to decide whether offering "sign in in a terminal" as a separate
 * action means anything — for a terminal-only agent the primary button already
 * opens one, so a second button beside it does the identical thing.
 */

/**
 * CLIs whose sign-in cannot be driven through pipes, established by running
 * each one that way:
 *
 *   hermes  prints "Running in a non-interactive environment (no TTY detected)"
 *           and exits
 *   gemini  has no login/auth subcommand at all (verified again on 0.54.4 —
 *           only mcp/extensions/skills/hooks/gemma). Its Google sign-in lives
 *           behind the `/auth` picker inside the full-screen TUI, so a pipe
 *           just hangs. The browser still opens; it's reached from the terminal.
 */
export const TERMINAL_ONLY_LOGIN = new Set(["hermes", "gemini"])

/**
 * `"claude auth login"` → `["auth", "login"]`. The binary token is dropped: the
 * orchestrator spawns the ABSOLUTE resolved path instead, so the login never
 * depends on the PATH a GUI-launched Electron process happened to inherit (the
 * Windows "'cursor-agent' is not recognized" failure).
 */
export function loginArgs(loginCommand: string): string[] {
  return loginCommand.trim().split(/\s+/).slice(1)
}

/**
 * A login command with no subcommand — bare `gemini`, bare `copilot` — isn't a
 * login at all: it launches the CLI's full-screen TUI, whose auth picker is
 * where the sign-in lives. Piping that gets you a hung process, so it goes
 * straight to a terminal. Catches new agents without needing a name added to
 * the set above.
 */
export function needsRealTerminal(type: string, loginCommand: string): boolean {
  return TERMINAL_ONLY_LOGIN.has(type) || loginArgs(loginCommand).length === 0
}
