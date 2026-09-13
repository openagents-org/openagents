import path from "node:path"

import {
  makeProfile,
  type CredentialProfile,
  type ImportSource,
} from "../../../shared/credential-import"
import {
  compact,
  isRecord,
  readJson,
  readText,
  str,
  type ReadContext,
} from "../read"

/**
 * Codex. `auth.json` holds an API key when codex was signed in with one — a
 * ChatGPT sign-in keeps OAuth tokens there instead, which belong to Codex and
 * are not read. `config.toml` may point codex at another provider, whose key
 * lives in the environment variable that provider's `env_key` names.
 */
export function readCodex(ctx: ReadContext): CredentialProfile[] {
  const dir = ctx.env.CODEX_HOME || path.join(ctx.home, ".codex")
  const source: ImportSource = { kind: "cli", ref: "codex" }
  const config = parseTomlStrings(readText(path.join(dir, "config.toml")) || "")
  const top = config[""]
  const providerId = top.model_provider || "openai"
  const provider = config[`model_providers.${providerId}`] || {}
  const auth = readJson(path.join(dir, "auth.json"))

  return compact([
    providerId === "openai"
      ? null
      : makeProfile({
          protocol: "openai",
          vendor: "relay",
          apiKey:
            str(ctx.env[provider.env_key || ""]) ||
            provider.experimental_bearer_token ||
            "",
          baseUrl: provider.base_url,
          model: top.model,
          source,
        }),
    makeProfile({
      protocol: "openai",
      vendor: "openai",
      apiKey: isRecord(auth) ? str(auth.OPENAI_API_KEY) : "",
      model: providerId === "openai" ? top.model : "",
      source,
    }),
  ])
}

/**
 * The single-line `key = "string"` assignments of a TOML file, by table:
 * `[model_providers.relay]` → `"model_providers.relay"`. That is every value
 * codex's provider config needs; arrays, inline tables and multi-line strings
 * are skipped rather than half-parsed.
 */
export function parseTomlStrings(
  text: string,
): Record<string, Record<string, string>> {
  const tables: Record<string, Record<string, string>> = { "": {} }
  let current: string | null = ""
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith("[[")) {
      // An array of tables — nothing codex keeps a key in.
      current = null
      continue
    }
    const header = /^\[([^[\]]+)\]/.exec(line)
    if (header) {
      current = header[1]
        .split(".")
        .map((part) => part.trim().replace(/^["']|["']$/g, ""))
        .join(".")
      tables[current] = tables[current] || {}
      continue
    }
    if (current === null) continue
    const kv =
      /^([A-Za-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(?:#.*)?$/.exec(
        line,
      )
    if (kv) tables[current][kv[1]] = kv[2] ?? kv[3]
  }
  return tables
}
