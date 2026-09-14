/**
 * OpenCode's own sign-ins, read off disk.
 *
 * `opencode auth login` writes every credential it collects — a provider API
 * key, an OAuth account, OpenCode Zen — into one `auth.json` under the CLI's
 * XDG data directory, keyed by provider id:
 *
 *   { "anthropic": { "type": "api", "key": "…" } }
 *
 * OpenCode resolves XDG paths the same way on every platform, so the file sits
 * under the home directory on Windows too.
 *
 * Only presence is checked here; nothing is read out of an entry.
 */

/** Where the CLI stores its sign-ins, relative to the home dir. */
export const OPENCODE_AUTH_FILE = ".local/share/opencode/auth.json"

/** At least one provider entry — an empty store signs nothing in. */
export function opencodeHasProvider(creds: unknown): boolean {
  if (!creds || typeof creds !== "object" || Array.isArray(creds)) return false
  return Object.values(creds).some((v) => !!v && typeof v === "object")
}
