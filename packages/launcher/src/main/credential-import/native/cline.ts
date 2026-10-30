import path from "node:path"

import {
  makeProfile,
  type CredentialProfile,
  type ImportSource,
} from "../../../shared/credential-import"
import { CLINE_PROVIDERS_FILE } from "../../agents/cline-signin"
import { CLINE_PROVIDERS } from "../providers"
import { compact, dig, readJson, str, type ReadContext } from "../read"

/**
 * Cline's provider settings, from `cline auth`: one entry per provider, each
 * with its own settings. Cline's account sign-in keeps no key here, and its
 * OpenAI-compatible provider is only read when its settings carry the endpoint.
 */
export function readCline(ctx: ReadContext): CredentialProfile[] {
  const file = readJson(path.join(ctx.home, CLINE_PROVIDERS_FILE))
  const source: ImportSource = { kind: "cli", ref: "cline" }
  return compact(
    Object.entries(dig(file, "providers")).map(([id, entry]) => {
      const settings = dig(entry, "settings")
      const known = CLINE_PROVIDERS[id]
      if (!known && id !== "openai") return null
      return makeProfile({
        protocol: known?.protocol ?? "openai",
        vendor: known?.vendor ?? "relay",
        apiKey: str(settings.apiKey),
        baseUrl: str(settings.baseUrl) || str(settings.openAiBaseUrl),
        model: str(settings.model) || str(settings.modelId),
        source,
      })
    }),
  )
}
