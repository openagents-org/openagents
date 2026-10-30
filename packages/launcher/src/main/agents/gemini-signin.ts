import fs from "fs"
import path from "path"

import { CONFIG_DIR } from "./paths"

/**
 * A folder the launcher owns, used only as the working directory of the Gemini
 * sign-in terminal. Not the user's home: Gemini reads a workspace settings file
 * from the directory it is started in, and pointing that at home would mean
 * editing the user's own config.
 */
const SIGNIN_DIR_NAME = "gemini-signin"

/**
 * What the workspace settings file asks for — the Google account flow, by the
 * CLI's own name for it (`AuthType.LOGIN_WITH_GOOGLE`).
 */
const GOOGLE_AUTH = "oauth-personal"

/**
 * Prepare a working directory that makes `gemini` open its Google sign-in.
 *
 * Gemini has no `login` subcommand and no auth flag: the method is picked in
 * its TUI and remembered in ~/.gemini/settings.json as
 * `security.auth.selectedType`. Once that says "gemini-api-key" — which is
 * where it lands for anyone who ever configured a key — launching `gemini`
 * goes straight to the chat screen. The Google sign-in never runs, nothing is
 * written, and the launcher's Sign in button looks like it did nothing at all
 * while the panel keeps saying "not signed in", because the sign-in genuinely
 * never happened. `GEMINI_DEFAULT_AUTH_TYPE` is no help: the CLI only uses it
 * to validate a value, never to override the setting.
 *
 * What works without touching the user's own config is Gemini's settings
 * layering. It merges `<cwd>/.gemini/settings.json` OVER the user file, so a
 * directory the launcher owns can ask for the Google flow for that run only.
 * Two conditions come with it:
 *
 *   • workspace settings are honored only in a folder the CLI considers
 *     trusted, and `GEMINI_CLI_TRUST_WORKSPACE=true` is the documented way to
 *     say so non-interactively — it is exactly what the CLI's own
 *     `--skip-trust` flag sets;
 *   • the sign-in itself is global (the account is recorded in ~/.gemini and
 *     the token goes to the OS keychain), so the probe sees it afterwards and
 *     the agent keeps whatever auth method the user actually configured.
 *
 * Returns the cwd + env for the terminal, or null if the directory could not be
 * prepared — in which case the caller should still open the terminal, just
 * without the override. The user can always reach the same place with `/auth`,
 * which is what the terminal prints.
 */
export function prepareGeminiSignIn(configDir: string = CONFIG_DIR): {
  cwd: string
  env: Record<string, string>
} | null {
  try {
    const dir = path.join(configDir, SIGNIN_DIR_NAME)
    const settingsDir = path.join(dir, ".gemini")
    fs.mkdirSync(settingsDir, { recursive: true })
    // Rewritten every time rather than merged: this file is ours, nobody else
    // writes it, and a stale value here would silently put the user back where
    // they started.
    fs.writeFileSync(
      path.join(settingsDir, "settings.json"),
      JSON.stringify(
        { security: { auth: { selectedType: GOOGLE_AUTH } } },
        null,
        2,
      ) + "\n",
      "utf-8",
    )
    return { cwd: dir, env: { GEMINI_CLI_TRUST_WORKSPACE: "true" } }
  } catch {
    return null
  }
}
