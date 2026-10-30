/**
 * Cline's sign-in, as far as the launcher can honestly read it.
 *
 * `cline auth` is an interactive flow that picks a provider and stores its
 * credential in the CLI's own settings file. There is no `cline auth status`
 * to ask, so the sign-in has to be read off disk — the same shape as gemini's
 * and codebuddy's probes.
 *
 * What makes Cline different from those two is that the file is NOT a complete
 * record of whether the agent can authenticate:
 *
 *   1. Cline fronts many providers. `providers.json` holds one entry per
 *      provider, and only the ones configured with a key carry a credential.
 *      "The file exists" and even "the file lists providers" both fall short of
 *      "this agent can run".
 *   2. Cline's OWN account provider authenticates through an account session
 *      that does not live in this file at all. A missing apiKey there is not
 *      evidence of being signed out.
 *   3. Several env vars authenticate a run on their own, whatever the file says.
 *
 * So this guard only ever reports signed-OUT for the one case it can be sure
 * of: a key-based provider is selected and no credential is stored anywhere.
 * Every other shape reads as signed-in and lets the run result be the
 * authority — the same call the copilot spec makes, and for the same reason. A
 * guard written to be strict here would report "Login required" at users who
 * are signed in through an account session and can run perfectly well.
 *
 * The core adapter classifies the same file in more detail (see
 * `classifyClineAuth` in agent-connector's cline-stream.js, which additionally
 * separates "unknown" from "ready" for its error messages). This is the weaker
 * question the launcher needs — usable or provably not — kept self-contained
 * like codebuddy-signin.ts rather than reaching across the package boundary.
 *
 * Nothing here reads or returns a secret value; only their presence is checked.
 */

/** Where the CLI stores provider settings, relative to the home dir. */
export const CLINE_PROVIDERS_FILE = ".cline/data/settings/providers.json"

/** Settings fields that count as a stored credential, whatever the provider. */
const CREDENTIAL_FIELDS = [
  "apiKey",
  "apikey",
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "sessionToken",
]

/**
 * Env vars Cline reads natively. A key in any of them authenticates the run
 * even when providers.json holds nothing.
 */
export const CLINE_AUTH_ENV_VARS = [
  "CLINE_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "AI_GATEWAY_API_KEY",
  "V0_API_KEY",
]

/**
 * Providers that authenticate WITHOUT a key in providers.json — the credential
 * is an account session kept elsewhere. For these, a missing apiKey says
 * nothing about whether the user is signed in.
 */
const ACCOUNT_PROVIDERS = new Set(["cline"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function hasStoredCredential(settings: unknown): boolean {
  if (!isRecord(settings)) return false
  return CREDENTIAL_FIELDS.some((field) => {
    const value = settings[field]
    return typeof value === "string" && value.trim().length > 0
  })
}

/**
 * Whether a parsed providers.json leaves Cline able to authenticate.
 *
 * Returns false ONLY when a key-based provider is selected and no credential is
 * stored for any provider — the one configuration that is provably unusable.
 */
export function clineCredentialUsable(
  creds: unknown,
  env: Record<string, string> = {},
): boolean {
  // An env key authenticates on its own, whatever the file holds.
  if (CLINE_AUTH_ENV_VARS.some((name) => (env[name] || "").trim())) return true

  if (!isRecord(creds)) return true
  const providers = creds.providers
  if (!isRecord(providers)) return true

  for (const id of Object.keys(providers)) {
    const entry = providers[id]
    if (hasStoredCredential(isRecord(entry) ? entry.settings : null)) return true
  }

  // Nothing stored. Only a selected, key-based provider makes that conclusive:
  // an account provider keeps its session somewhere this file cannot see.
  const active = typeof creds.lastUsedProvider === "string" ? creds.lastUsedProvider : null
  if (!active || ACCOUNT_PROVIDERS.has(active)) return true
  const activeEntry = providers[active]
  return !(isRecord(activeEntry) && isRecord(activeEntry.settings))
}
