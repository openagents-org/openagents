/**
 * The launcher's own local state — the part that lives in the renderer's
 * localStorage rather than in settings.json.
 *
 * Theme, accent, skin, UI scale, sidebar state, the command palette's history:
 * all of it is read synchronously on the very first paint, which is why it is
 * in localStorage and not behind async IPC. The cost is that it survives things
 * users expect to clear it — "Reset all settings" only touches settings.json,
 * and even a reinstall leaves the Chromium profile in place — so the app could
 * come back up wearing a theme the user thought they had thrown away.
 *
 * This module is the one place that knows how to throw it away.
 */
import { STORAGE_KEY as LANGUAGE_KEY } from "@renderer/i18n"
import { useAppearanceStore } from "@renderer/store/appearance"
import { useThemeStore } from "@renderer/store/theme"

/**
 * Swept by prefix rather than by an explicit key list: a list would rot the
 * first time someone renamed a key and nothing would fail. Every key the app
 * writes for its own chrome carries one of these.
 */
const OWNED_PREFIXES = [
  "launcher:", // theme, accent, skin, scale, sidebar, last tab, history
  "openagents:", // dismissed update notices
  "oa.", // marketplace view/sort/filter
]

/**
 * Deliberately left behind:
 *
 * - the UI language, which has its own picker and is not chrome the user would
 *   expect a "reset appearance" to undo;
 * - `workspace-prefs:v1`, which holds starred workspaces and group labels —
 *   content the user typed, not view state;
 * - the onboarding/tour completion flags, since re-running the wizard is a
 *   different request than repainting the app.
 */
const KEEP = new Set<string>([LANGUAGE_KEY])

function ownedKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || KEEP.has(key)) continue
    if (OWNED_PREFIXES.some((p) => key.startsWith(p))) keys.push(key)
  }
  return keys
}

/**
 * Put the interface back to a fresh install and forget the stored copy.
 *
 * Defaults are applied through the stores first, so the running window
 * repaints and main gets the default accent for the next startup splash — the
 * splash reads its colour from settings.json, which is the mirror those setters
 * maintain. The sweep comes second so nothing is left on disk either.
 */
export function resetLocalPreferences(): void {
  useThemeStore.getState().reset()
  useAppearanceStore.getState().reset()
  for (const key of ownedKeys()) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* Private mode / quota — the in-memory reset above still stands. */
    }
  }
}
