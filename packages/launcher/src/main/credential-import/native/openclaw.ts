import path from "node:path"

import {
  makeProfile,
  type CredentialProfile,
  type ImportSource,
} from "../../../shared/credential-import"
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
 * OpenClaw. Keys live in the main agent's auth profiles — `api_key` entries
 * from its own setup, `token` entries from the launcher — and custom endpoints
 * in openclaw.json's `models.providers`, whose `apiKey` holds either the key or
 * the name of the variable holding it.
 */
export function readOpenclaw(ctx: ReadContext): CredentialProfile[] {
  const dir = ctx.env.OPENCLAW_STATE_DIR || path.join(ctx.home, ".openclaw")
  const config = readJson(path.join(dir, "openclaw.json"))
  const keys = profileKeys(
    readJson(path.join(dir, "agents", "main", "agent", "auth-profiles.json")),
  )
  const providers = dig(config, "models", "providers")
  const [primaryProvider, ...rest] = str(
    dig(config, "agents", "defaults", "model").primary,
  ).split("/")
  const modelFor = (id: string): string =>
    id === primaryProvider ? rest.join("/") : ""
  const source: ImportSource = { kind: "cli", ref: "openclaw" }

  const custom = Object.entries(providers).map(([id, provider]) => {
    if (!isRecord(provider)) return null
    const models = Array.isArray(provider.models) ? provider.models : []
    return makeProfile({
      protocol: str(provider.api).startsWith("anthropic")
        ? "anthropic"
        : "openai",
      vendor: "relay",
      apiKey: resolveEnvRef(provider.apiKey, ctx.env) || keys[id] || "",
      baseUrl: str(provider.baseUrl),
      model: modelFor(id) || str(dig({ m: models[0] }, "m").id),
      source,
    })
  })
  const native = (["openai", "anthropic"] as const).map((vendor) =>
    providers[vendor]
      ? null
      : makeProfile({
          protocol: vendor,
          vendor,
          apiKey: keys[vendor] || "",
          model: modelFor(vendor),
          source,
        }),
  )
  return compact([...custom, ...native])
}

/** The first usable key per provider in an auth-profiles file. */
function profileKeys(file: unknown): Record<string, string> {
  const keys: Record<string, string> = {}
  for (const p of Object.values(dig(file, "profiles"))) {
    if (!isRecord(p)) continue
    const provider = str(p.provider)
    const key =
      p.type === "api_key" ? str(p.key) : p.type === "token" ? str(p.token) : ""
    if (provider && key && !keys[provider]) keys[provider] = key
  }
  return keys
}
