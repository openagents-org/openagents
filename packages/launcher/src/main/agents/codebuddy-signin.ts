/**
 * CodeBuddy's two-sided sign-in, as the launcher has to model it.
 *
 * CodeBuddy Code is one CLI in front of several separate services: the
 * international site (codebuddy.ai / workbuddy.ai), the China site
 * (codebuddy.cn / workbuddy.cn, reached through copilot.tencent.com), Tencent's
 * internal iOA build, and enterprise deployments. `CODEBUDDY_INTERNET_ENVIRONMENT`
 * is what picks one — and the CLI keeps exactly ONE session on disk, tagged with
 * the domain it belongs to. Three consequences drive everything in this file:
 *
 *   1. THE SIGN-IN TERMINAL HAS TO BE PINNED. Launched with no environment, the
 *      CLI signs in against the international site. An agent configured for the
 *      China site then runs with CODEBUDDY_INTERNET_ENVIRONMENT=internal against
 *      a codebuddy.ai session and fails to authenticate — which is what "I chose
 *      China, the terminal says I'm logged in, and it still doesn't work" is.
 *      `codebuddyLoginEnv` gives the terminal the same value the agent runs with.
 *
 *   2. THE SESSION IS READABLE, THE STATUS IS NOT. There is no `codebuddy login
 *      status` (verified against 2.146.0: the CLI has no login/auth/whoami
 *      subcommand at all — signing in is the `/login` slash command inside the
 *      interactive session). What the sign-in does leave is a session file, in
 *      the CLI's own extension data directory, named after the `authentication.id`
 *      in its product.json. Its existence is the sign-in probe.
 *
 *   3. A SESSION FOR THE OTHER SITE IS WORSE THAN NO SESSION. The file records
 *      `auth.domain`, so an agent pinned to the China site can tell a China
 *      sign-in from an international one instead of reporting "Ready" for an
 *      agent that cannot authenticate. Only the domain is read; the token in the
 *      same file is never touched.
 */

/** Where the CLI keeps its data, per platform, relative to the home dir. */
const EXTENSION_DIRS = [
  // macOS
  "Library/Application Support/CodeBuddyExtension",
  // Windows
  "AppData/Local/CodeBuddyExtension",
  // Linux
  ".local/share/CodeBuddyExtension",
]

/**
 * The session file's name, from `authentication.id` in the CLI's product.json.
 * The per-environment product configs (product.internal.json, product.ioa.json,
 * …) override only the endpoint and model list, so every site shares this one
 * file — which is exactly why the domain inside it has to be checked.
 */
const SESSION_FILE = "Tencent-Cloud.coding-copilot.info"

/**
 * Home-relative paths to try, in order, for the CLI's session file. Only one
 * exists on any given machine; the others are simply absent and skipped.
 */
export const CODEBUDDY_SESSION_FILES = EXTENSION_DIRS.map(
  (dir) => `${dir}/Data/Public/auth/${SESSION_FILE}`,
)

/**
 * The regions the launcher offers (registry `CODEBUDDY_REGION`), mapped to the
 * CLI's own `CODEBUDDY_INTERNET_ENVIRONMENT` value and the domains an account on
 * that site signs in from.
 *
 * `international` deliberately forces NOTHING. The CLI's startup derives the
 * environment from the session file when the variable is unset, so leaving it
 * alone is both the documented default AND the setting that adapts to whatever
 * the user actually signed into — there is no `product.external.json` to select.
 * Only a region that pins the variable can disagree with a session.
 */
const REGIONS: Record<string, { env?: string; domains?: RegExp }> = {
  international: {},
  china: {
    env: "internal",
    // The CLI's own internalDomain list, as a suffix match so the staging hosts
    // (staging-copilot.tencent.com, staging.codebuddy.cn) match too.
    domains: /(?:codebuddy|workbuddy)\.cn$|copilot\.tencent\.com$/i,
  },
}

/** The configured region, normalized; unknown values fall back to the default. */
function regionOf(env: Record<string, string> | undefined): {
  env?: string
  domains?: RegExp
} {
  const raw = String(env?.CODEBUDDY_REGION || "")
    .trim()
    .toLowerCase()
  return REGIONS[raw] || REGIONS.international
}

/**
 * The environment a CodeBuddy CLI must be launched with to reach the site this
 * agent is configured for — for the sign-in terminal, so the account the user
 * signs into is the account the agent will run as.
 *
 * Mirrors the adapter's own overlay (agent-connector's codebuddy-stream
 * `resolveCodeBuddyEnv`); keep the two in step when a region is added.
 */
export function codebuddyLoginEnv(
  env: Record<string, string> | undefined,
): Record<string, string> {
  const value = regionOf(env).env
  return value ? { CODEBUDDY_INTERNET_ENVIRONMENT: value } : {}
}

/**
 * Whether the session on disk can authenticate THIS agent: true when it belongs
 * to the configured site, false when it belongs to another one, and true when
 * the region pins nothing (the CLI then follows the session's own domain) or the
 * session predates the domain field and there is nothing to disagree with.
 *
 * `creds` is the parsed session file. Only `auth.domain` is read.
 */
export function codebuddySessionMatchesRegion(
  creds: unknown,
  env: Record<string, string> | undefined,
): boolean {
  const domains = regionOf(env).domains
  if (!domains) return true
  const auth = (creds as { auth?: { domain?: unknown } } | null)?.auth
  const domain = typeof auth?.domain === "string" ? auth.domain.trim() : ""
  if (!domain) return true
  return domains.test(domain)
}
