// ── One-time userData relocation after the app was renamed ──
//
// The app used to call app.setName("OpenAgents Launcher"); it now calls
// app.setName("OpenAgents"). Electron derives the userData directory from that
// name, so on the first run of the renamed build every existing profile would
// point at an empty directory: paired workspaces (connections.json), imported
// credentials, per-agent repo bindings and settings.json all live there. The
// user would come back from an ordinary update to what looks like a fresh
// install.
//
// So before the name is set, move the old directory to where the new name will
// look. A single rename inside the same parent is atomic and carries the
// Chromium profile along with our own files. If it fails (a leftover lock on
// Windows, a stray directory at the target), fall back to copying just the
// files that hold user state — losing a browser cache is survivable, losing a
// workspace pairing is not.
import fs from "fs"
import path from "path"

/** Files and directories worth copying when the rename cannot be done. */
const DATA_ENTRIES = [
  "settings.json",
  "connections.json",
  "credentials.json",
  "github-bindings.json",
  "update-install-attempt.json",
  ".updaterId",
]

export type MigrationResult = "renamed" | "copied" | "skipped" | "failed"

/**
 * Move `<appData>/<legacyName>` to `<appData>/<nextName>` if the legacy profile
 * is the only one present. Never overwrites an existing new-name profile, and
 * never throws: a failed migration must not stop the app from starting.
 */
export function migrateLegacyUserData(
  appDataDir: string,
  legacyName: string,
  nextName: string,
): MigrationResult {
  const legacy = path.join(appDataDir, legacyName)
  const next = path.join(appDataDir, nextName)

  try {
    if (!fs.existsSync(legacy) || fs.existsSync(next)) return "skipped"
  } catch {
    return "skipped"
  }

  try {
    fs.renameSync(legacy, next)
    return "renamed"
  } catch {
    // Fall through to the per-file copy below.
  }

  try {
    fs.mkdirSync(next, { recursive: true })
    let copied = 0
    for (const entry of DATA_ENTRIES) {
      const from = path.join(legacy, entry)
      const to = path.join(next, entry)
      try {
        if (!fs.existsSync(from) || fs.existsSync(to)) continue
        fs.copyFileSync(from, to)
        copied++
      } catch {
        // One unreadable file must not abort the rest of the migration.
      }
    }
    return copied > 0 ? "copied" : "failed"
  } catch {
    return "failed"
  }
}
