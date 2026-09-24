import type { CatalogEntry } from "../types"
import { AUTH_MODE_KEY, CLI_LOGIN, isCliLogin } from "../../shared/agent-auth-mode"

export { AUTH_MODE_KEY, CLI_LOGIN }

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
  if (isCliLogin(saved)) return "cli"
  const configured = fields.some(
    (f) => f.password && (saved[f.name] || "").trim(),
  )
  return configured ? "key" : "cli"
}

const isCredential = (
  name: string,
  fields: Array<{ name: string; password?: boolean }>,
): boolean =>
  name === "LLM_API_KEY" ||
  /BASE_URL$/.test(name) ||
  fields.some((f) => f.name === name && !!f.password)

// A model variable no field shows: LLM_MODEL, a resolved CODEX_MODEL.
const isHiddenModel = (
  name: string,
  fields: Array<{ name: string }>,
): boolean =>
  /(^|_)MODEL(_NAME)?$/.test(name) && !fields.some((f) => f.name === name)

/**
 * The env an agent is saved with for the auth tab it was set up on. The
 * sign-in tab blanks every key and endpoint (an empty value is dropped from
 * the agent's own env), and any model no field shows, which can only have
 * come with the type's key; then sets the marker. The key tab clears it.
 */
export function envForAuthTab(
  tab: "cli" | "key",
  fields: Array<{ name: string; password?: boolean }>,
  values: Record<string, string>,
): Record<string, string> {
  if (tab === "key") return { ...values, [AUTH_MODE_KEY]: "" }
  const next: Record<string, string> = {}
  for (const [name, value] of Object.entries(values)) {
    next[name] = isCredential(name, fields) || isHiddenModel(name, fields) ? "" : value
  }
  next[AUTH_MODE_KEY] = CLI_LOGIN
  return next
}

/**
 * The model fields as a tab shows them. A signed-in agent runs on its own
 * model only (the core's typeEnvFor): the one saved for the type was picked
 * for the key's endpoint, a relay's model the account does not serve. So the
 * sign-in tab drops a model inherited from the type, and the key tab puts it
 * back. A model the user typed, or the agent's own, is left alone either way.
 */
export function modelsForTab(
  tab: "cli" | "key",
  modelNames: string[],
  values: Record<string, string>,
  typeEnv: Record<string, string>,
  instanceEnv: Record<string, string>,
): Record<string, string> {
  const next = { ...values }
  for (const name of modelNames) {
    if (name in instanceEnv || !typeEnv[name]) continue
    if (tab === "cli" && next[name] === typeEnv[name]) next[name] = ""
    if (tab === "key" && !(next[name] || "").trim()) next[name] = typeEnv[name]
  }
  return next
}
