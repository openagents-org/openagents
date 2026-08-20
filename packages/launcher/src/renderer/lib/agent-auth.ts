import type { CatalogEntry } from "../types"

/**
 * A "login-only" agent authenticates exclusively through its own CLI sign-in
 * (e.g. `cursor-agent login`, `hermes setup`) and exposes NO API-key fields —
 * getEnvFields returns [] for it. The setup wizard (enter key → test
 * connection → create instance) is meaningless for these: there's no key to
 * collect and nothing to test. Their sign-in lives in the Agents-page Configure
 * dialog (the CLI login flow), so the post-install wizard and the "Setup
 * wizard" button must be skipped for them.
 *
 * Dual-auth agents like Claude carry a login_command AND key fields
 * (ANTHROPIC_API_KEY etc.), so getEnvFields is non-empty — they are NOT
 * login-only and keep the wizard.
 *
 * Note: a catalog entry's own `env_config` can't be trusted here — Cursor's
 * registry entry still lists CURSOR_API_KEY even though the launcher hides it
 * (getEnvFields → []). Always pass the resolved getEnvFields result.
 */
export function isLoginOnlyAgent(
  entry: Pick<CatalogEntry, "check_ready">,
  envFields: { length: number } | null | undefined,
): boolean {
  return !!entry.check_ready?.login_command && (envFields?.length ?? 0) === 0
}

/**
 * Decide whether the CLI-login tab may say "signed in". `ready` alone is not
 * enough for dual-auth agents: an API key also makes them ready. Newer health
 * results identify the auth mode; older login-only agents may only expose the
 * aggregate ready bit, so retain that fallback only when no key fields exist.
 */
export function isCliLoginDetected(
  health:
    | { logged_in?: unknown; auth_mode?: unknown; ready?: unknown }
    | null
    | undefined,
  hasEnvFields: boolean,
): boolean {
  if (!health) return false
  if (typeof health.logged_in === "boolean") return health.logged_in
  if (typeof health.auth_mode === "string") {
    return health.ready === true && health.auth_mode === "cli_login"
  }
  return !hasEnvFields && health.ready === true
}

/**
 * Which tab a dual-auth agent's Configure dialog should open on.
 *
 * Claude (and any other agent offering BOTH a CLI sign-in and API-key fields)
 * shows the two as tabs. That tab used to always open on "cli", which meant
 * someone who had configured an API key reopened Configure, landed on the CLI
 * tab, saw "not signed in", and concluded the key had not saved — it had, it
 * was simply on the tab they were not looking at. Opening on the tab the user
 * actually configured is the whole fix.
 *
 * A saved secret decides it: `password` fields are the credentials (API key,
 * OAuth token), while base URL and model carry defaults and would otherwise
 * make every agent look key-configured.
 */
export function preferredAuthTab(
  fields: Array<{ name: string; password?: boolean }>,
  saved: Record<string, string> | null | undefined,
): "cli" | "key" {
  if (!saved) return "cli"
  const configured = fields.some(
    (f) => f.password && (saved[f.name] || "").trim(),
  )
  return configured ? "key" : "cli"
}
