/**
 * Marks an agent that signs in through its CLI rather than a key. The core
 * (env.js stripForCliLogin) then runs it with no key from any source: keys
 * are shared per agent type, and a CLI handed one uses it over its sign-in.
 * Shared so main's health labels the agent the way the core runs it.
 */
export const AUTH_MODE_KEY = "OPENAGENTS_AUTH_MODE"
export const CLI_LOGIN = "cli_login"

/** Whether an agent's own env marks it as signed in through its CLI. */
export const isCliLogin = (env: Record<string, string> | null | undefined): boolean =>
  env?.[AUTH_MODE_KEY] === CLI_LOGIN
