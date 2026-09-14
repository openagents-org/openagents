import path from "node:path"

import {
  makeProfile,
  type CredentialProfile,
  type ImportSource,
} from "../../../shared/credential-import"
import { PI_PROVIDERS } from "../providers"
import {
  compact,
  dig,
  isRecord,
  readJson,
  resolveEnvRef,
  str,
  type ReadContext,
} from "../read"

/**
 * Pi. Its sign-in store keeps one entry per provider — key entries are read,
 * OAuth logins stay Pi's — and `models.json` declares custom providers with an
 * endpoint, a wire protocol and a key (or the variable holding it).
 */
export function readPi(ctx: ReadContext): CredentialProfile[] {
  const dir = path.join(ctx.home, ".pi", "agent")
  const source: ImportSource = { kind: "cli", ref: "pi" }

  const stored = Object.entries(dig(readJson(path.join(dir, "auth.json")))).map(
    ([id, entry]) => {
      const known = PI_PROVIDERS[id]
      if (!known || !isRecord(entry) || entry.type === "oauth") return null
      return makeProfile({
        protocol: known.protocol,
        vendor: known.vendor,
        apiKey: str(entry.key),
        source,
      })
    },
  )

  const declared = Object.values(
    dig(readJson(path.join(dir, "models.json")), "providers"),
  ).map((provider) => {
    if (!isRecord(provider)) return null
    const api = str(provider.api)
    const models = Array.isArray(provider.models) ? provider.models : []
    return makeProfile({
      protocol: api.startsWith("anthropic")
        ? "anthropic"
        : api.startsWith("google")
          ? "gemini"
          : "openai",
      vendor: "relay",
      apiKey: resolveEnvRef(provider.apiKey, ctx.env),
      baseUrl: str(provider.baseUrl),
      model: str(dig({ m: models[0] }, "m").id),
      source,
    })
  })

  return compact([...stored, ...declared])
}
