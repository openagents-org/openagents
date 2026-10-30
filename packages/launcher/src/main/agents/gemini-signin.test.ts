import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { prepareGeminiSignIn } from "./gemini-signin"

/**
 * The contract the Gemini sign-in terminal depends on, verified against the
 * CLI's real settings loader (gemini-cli 0.56):
 *
 *   sign-in dir, no trust env  → gemini-api-key   (workspace settings dropped)
 *   sign-in dir + trust env    → oauth-personal   (what we want)
 *   the user's home            → gemini-api-key   (untouched)
 *
 * Both halves matter — without GEMINI_CLI_TRUST_WORKSPACE the CLI discards
 * workspace settings entirely, so the override would silently do nothing.
 */
describe("prepareGeminiSignIn", () => {
  let configDir: string

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-config-"))
  })
  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true })
  })

  const settingsOf = (cwd: string): Record<string, never> =>
    JSON.parse(
      fs.readFileSync(path.join(cwd, ".gemini", "settings.json"), "utf-8"),
    )

  it("asks for the Google flow in a directory of ours, not the user's home", () => {
    const prep = prepareGeminiSignIn(configDir)!
    expect(prep.cwd.startsWith(configDir)).toBe(true)
    expect(prep.cwd).not.toBe(os.homedir())
    expect(settingsOf(prep.cwd)).toEqual({
      security: { auth: { selectedType: "oauth-personal" } },
    })
  })

  it("marks the folder trusted — without it the CLI ignores workspace settings", () => {
    expect(prepareGeminiSignIn(configDir)!.env).toEqual({
      GEMINI_CLI_TRUST_WORKSPACE: "true",
    })
  })

  it("never touches the user's own ~/.gemini/settings.json", () => {
    // The whole reason for the workspace file: the daemon reads the user's
    // selectedType when it runs the agent headless, so a sign-in the user
    // abandons must not leave an agent that worked on its API key broken.
    const prep = prepareGeminiSignIn(configDir)!
    expect(prep.cwd).not.toContain(path.join(os.homedir(), ".gemini"))
  })

  it("rewrites a stale file rather than merging into it", () => {
    const prep = prepareGeminiSignIn(configDir)!
    fs.writeFileSync(
      path.join(prep.cwd, ".gemini", "settings.json"),
      JSON.stringify({ security: { auth: { selectedType: "gemini-api-key" } } }),
    )
    prepareGeminiSignIn(configDir)
    expect(settingsOf(prep.cwd)).toEqual({
      security: { auth: { selectedType: "oauth-personal" } },
    })
  })

  it("returns null instead of throwing when the directory can't be made", () => {
    // A file where the directory needs to be — the caller falls back to a
    // plain terminal, which still reaches the sign-in via /auth.
    const blocked = path.join(configDir, "blocked")
    fs.writeFileSync(blocked, "not a directory")
    expect(prepareGeminiSignIn(blocked)).toBeNull()
  })
})
