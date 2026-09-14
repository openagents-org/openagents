import type { CredentialProfile } from "../../../shared/credential-import"
import type { ReadContext } from "../read"
import { readClaude } from "./claude"
import { readCline } from "./cline"
import { readCodex } from "./codex"
import { readGemini, readHermes } from "./dotenv"
import { readOpenclaw } from "./openclaw"
import { readOpencode } from "./opencode"
import { readPi } from "./pi"

const READERS: Array<(ctx: ReadContext) => CredentialProfile[]> = [
  readClaude,
  readCodex,
  readOpencode,
  readOpenclaw,
  readGemini,
  readPi,
  readCline,
  readHermes,
]

/**
 * Every credential the other AI tools on this machine keep in their own config.
 * A file one tool reshaped in a new version costs only that tool's offers.
 */
export function readNativeProfiles(ctx: ReadContext): CredentialProfile[] {
  return READERS.flatMap((read) => {
    try {
      return read(ctx)
    } catch {
      return []
    }
  })
}
