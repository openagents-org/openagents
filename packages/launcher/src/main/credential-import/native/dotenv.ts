import path from "node:path"

import type { CredentialProfile } from "../../../shared/credential-import"
import { profilesFromEnv } from "../env-profiles"
import { parseEnvText } from "../env-text"
import { readText, type ReadContext } from "../read"

/** Gemini CLI reads its key from `~/.gemini/.env` when the shell has none. */
export function readGemini(ctx: ReadContext): CredentialProfile[] {
  return fromDotenv(path.join(ctx.home, ".gemini", ".env"), "gemini")
}

/** Hermes keeps the keys `hermes setup` collected in its own `.env`. */
export function readHermes(ctx: ReadContext): CredentialProfile[] {
  const dir = ctx.env.HERMES_HOME || path.join(ctx.home, ".hermes")
  return fromDotenv(path.join(dir, ".env"), "hermes")
}

function fromDotenv(file: string, ref: string): CredentialProfile[] {
  const text = readText(file)
  return text ? profilesFromEnv(parseEnvText(text), { kind: "cli", ref }) : []
}
