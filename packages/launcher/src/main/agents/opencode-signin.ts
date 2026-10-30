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
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/** Where the CLI stores its sign-ins, relative to the home dir. */
export const OPENCODE_AUTH_FILE = ".local/share/opencode/auth.json"

/** Global config files, in the order OpenCode merges them. `model` is its default. */
const OPENCODE_CONFIG_FILES = [
  ".config/opencode/config.json",
  ".config/opencode/opencode.json",
  ".config/opencode/opencode.jsonc",
]

/** The TUI's model history: `{ recent: [{ providerID, modelID }] }`. */
const OPENCODE_MODEL_STATE_FILE = ".local/state/opencode/model.json"

/** At least one provider entry — an empty store signs nothing in. */
export function opencodeHasProvider(creds: unknown): boolean {
  if (!creds || typeof creds !== "object" || Array.isArray(creds)) return false
  return Object.values(creds).some((v) => !!v && typeof v === "object")
}

/** JSON with comments and trailing commas (OpenCode's config dialect), or null. */
function readJsonc(file: string): Record<string, unknown> | null {
  let raw: string
  try {
    raw = fs.readFileSync(file, "utf-8")
  } catch {
    return null
  }
  try {
    // Strings are matched first so a `//` inside a URL is kept.
    const json = raw
      .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, s) => s ?? "")
      .replace(/,(\s*[}\]])/g, "$1")
    const parsed: unknown = JSON.parse(json)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * The model to preselect for an OpenCode agent signed in through the CLI, from
 * the ids `opencode models` just listed.
 *
 * The launcher has to pass `--model` (a headless `opencode run` without one
 * waits for a picker nobody can answer), so an empty field is not "whatever
 * OpenCode defaults to" — it is a run that cannot start. Rather than make the
 * user pick blind, name the model they would most likely pick:
 *
 *   1. `model` in OpenCode's global config — what they told OpenCode to use;
 *   2. the most recent model in the TUI's history — what they last ran;
 *   3. the newest model of a provider they signed in to;
 *   4. the newest model listed at all (OpenCode Zen's free ones, signed out).
 *
 * Only ids in the list qualify: a stale config entry would preselect a model
 * this machine can no longer run.
 */
export function opencodeRecommendedModel(
  models: Array<{ id: string; deprecated?: boolean; released?: string }>,
  home: string = os.homedir(),
): string | undefined {
  const listed = new Set(models.map((m) => m.id))

  // Later files override earlier ones, so the last one that names a model wins.
  for (const rel of [...OPENCODE_CONFIG_FILES].reverse()) {
    const model = readJsonc(path.join(home, rel))?.model
    if (typeof model === "string" && listed.has(model.trim())) return model.trim()
  }

  const recent = readJsonc(path.join(home, OPENCODE_MODEL_STATE_FILE))?.recent
  for (const r of Array.isArray(recent) ? recent : []) {
    const { providerID, modelID } = (r || {}) as Record<string, unknown>
    const id = `${providerID}/${modelID}`
    if (typeof providerID === "string" && typeof modelID === "string" && listed.has(id))
      return id
  }

  const auth = readJsonc(path.join(home, OPENCODE_AUTH_FILE))
  const signedIn = new Set(auth ? Object.keys(auth) : [])
  const live = models.filter((m) => !m.deprecated)
  const own = live.filter((m) => signedIn.has(m.id.split("/")[0]))
  const pool = own.length ? own : live
  // Newest first; a stable sort keeps the CLI's order among same-day releases.
  return [...pool].sort((a, b) =>
    (b.released || "").localeCompare(a.released || ""),
  )[0]?.id
}
