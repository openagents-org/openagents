import path from "node:path"

import type { CredentialProfile } from "../../../shared/credential-import"
import { profilesFromEnv } from "../env-profiles"
import { dig, readJson, stringRecord, type ReadContext } from "../read"

/**
 * Claude Code's user settings. A relay's token and URL go in their `env` block:
 * that is how relays tell people to set Claude Code up, and where provider
 * switchers write them. The subscription sign-in lives in the OS keychain and
 * only works for Claude Code itself, so it is not read.
 */
export function readClaude(ctx: ReadContext): CredentialProfile[] {
  const dir = ctx.env.CLAUDE_CONFIG_DIR || path.join(ctx.home, ".claude")
  const settings = readJson(path.join(dir, "settings.json"))
  return profilesFromEnv(stringRecord(dig(settings, "env")), {
    kind: "cli",
    ref: "claude",
  })
}
