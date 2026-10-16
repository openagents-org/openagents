/**
 * MiMo Code's Xiaomi-account sign-in, read off disk.
 *
 * `mimo providers login -p xiaomi` is a browser sign-in on the MiMo platform,
 * but what it leaves behind is not a session: the platform issues the CLI an
 * API key of its own (named `mimo-code-cli-key-…` in the user's key list) and
 * the CLI stores it in its `auth.json`, under the XDG data directory as
 * OpenCode's is — on Windows too:
 *
 *   { "xiaomi": { "type": "api", "key": "…", "metadata": { "uid": "…", "base_url": "…" } } }
 *
 * `base_url` is set for a Token Plan account, whose key only works there; the
 * CLI routes to it on its own. The key does not expire, so there is no refresh
 * to account for — it is good until the user deletes it on the platform.
 *
 * Only presence is checked here; nothing is read out of an entry.
 */
import { stripAnsi } from "../cli-login-patterns"
import type { ModelChoice } from "./model-catalog"

/** Where the CLI stores its sign-ins, relative to the home dir. */
export const MIMO_AUTH_FILE = ".local/share/mimocode/auth.json"

/** …and relative to XDG_DATA_HOME, which the CLI follows when it is set. */
export const MIMO_AUTH_XDG_PATH = "mimocode/auth.json"

/** The provider a Xiaomi-account sign-in is stored under. */
const XIAOMI = "xiaomi"

/** What a run on the sign-in uses when no model is picked (the adapter's default). */
export const MIMO_SIGNIN_DEFAULT_MODEL = "xiaomi/mimo-v2.5-pro"

/** A `xiaomi` entry that holds a key. Other providers in the store sign nothing in here. */
export function mimoHasXiaomiSignIn(creds: unknown): boolean {
  if (!creds || typeof creds !== "object" || Array.isArray(creds)) return false
  const entry = (creds as Record<string, unknown>)[XIAOMI]
  if (!entry || typeof entry !== "object") return false
  const key = (entry as Record<string, unknown>).key
  return typeof key === "string" && key.trim().length > 0
}

/**
 * `mimo models xiaomi`: one `xiaomi/<model>` per line, followed by the context
 * window — `xiaomi/mimo-v2.5-pro — window 1.05M, compacts at 944K`. The ids
 * come qualified, the form the adapter takes for a run on the sign-in. MiMo
 * lists its catalog signed in or not.
 */
export function parseMimoModels(out: string): ModelChoice[] {
  const models: ModelChoice[] = []
  const seen = new Set<string>()
  for (const line of stripAnsi(out).split(/\r?\n/)) {
    const m = line.trim().match(/^(xiaomi\/[\w.-]+)(?:\s+[—-]+\s+(.*))?$/)
    if (!m || seen.has(m[1])) continue
    seen.add(m[1])
    const note = (m[2] || "").trim()
    models.push(note ? { id: m[1], note } : { id: m[1] })
  }
  return models
}

/** The adapter's default when the list has it, else the first one listed. */
export function mimoRecommendedModel(models: ModelChoice[]): string | undefined {
  if (models.some((m) => m.id === MIMO_SIGNIN_DEFAULT_MODEL))
    return MIMO_SIGNIN_DEFAULT_MODEL
  return models[0]?.id
}
