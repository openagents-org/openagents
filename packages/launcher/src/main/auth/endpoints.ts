/**
 * Where the account half of the app talks to.
 *
 * Three hosts. Two are derived from the single endpoint the user can configure
 * (Settings → workspace endpoint), so a self-hosted deployment moves both at
 * once; the third is where accounts live:
 *
 *   api      workspace-endpoint.openagents.org  REST (sessions, memberships)
 *   web      workspace.openagents.org           the workspace pages
 *   login    openagents.org                     the sign-in page, which the
 *                                               launcher now opens INSIDE the
 *                                               app rather than in a browser
 *   account  endpoint.openagents.org            where accounts actually live:
 *                                               email+password, and the handoff
 *                                               token that opens a workspace
 *
 * The renderer has the same web/api mapping in `lib/workspace-urls.ts`; main
 * cannot import it (different tsconfig root) so the rule is spelled out again
 * here rather than reached for across the boundary.
 */

export const DEFAULT_API_BASE = "https://workspace-endpoint.openagents.org"

/**
 * Where accounts are authenticated. Not derived from the workspace endpoint: a
 * self-hosted workspace still authenticates people against the hosted account
 * system. Overridable for a staging site.
 */
export function loginBase(): string {
  return (
    process.env.OPENAGENTS_LOGIN_BASE?.replace(/\/$/, "") ||
    "https://openagents.org"
  )
}

/**
 * The account service behind openagents.org — a different deployment from the
 * workspace backend, and the one that answers for email and password.
 *
 * openagents.org is a Next.js site with no auth API of its own (`/api/geo` is
 * the only route it serves); its sign-in page posts to this host. Accounts made
 * through that form live HERE, not in Firebase — which is why speaking to
 * Identity Toolkit directly rejects a password the website accepts. Firebase
 * still holds the Google/GitHub/Apple identities.
 *
 * Overridable for a staging deployment, alongside OPENAGENTS_LOGIN_BASE.
 */
export function accountApiBase(): string {
  return (
    process.env.OPENAGENTS_ACCOUNT_API_BASE?.replace(/\/$/, "") ||
    "https://endpoint.openagents.org"
  )
}

/** REST base for the account API — what `workspaceEndpoint` normalizes to. */
export function apiBase(configured?: string): string {
  return (configured || DEFAULT_API_BASE).replace(/\/$/, "")
}

/**
 * The web origin that serves the workspace pages. `workspace-endpoint.x` and
 * `workspace.x` are the same deployment; anything else is assumed to serve
 * both from one origin.
 *
 * The override exists for the case the derivation cannot cover: a front end
 * served from somewhere unrelated to its API — a preview deployment, or a
 * local dev server being pointed at the hosted backend.
 */
export function webBase(configured?: string): string {
  const override = process.env.OPENAGENTS_WORKSPACE_WEB_BASE
  if (override) return override.replace(/\/$/, "")
  return apiBase(configured)
    .replace("workspace-endpoint.", "workspace.")
    .replace(/\/v1$/, "")
}
