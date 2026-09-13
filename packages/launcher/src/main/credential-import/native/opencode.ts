import path from "node:path"

import {
  makeProfile,
  type CredentialProfile,
  type ImportSource,
} from "../../../shared/credential-import"
import { OPENCODE_PROVIDERS } from "../providers"
import {
  compact,
  dig,
  isRecord,
  readJson,
  resolveEnvRef,
  str,
  type ReadContext,
} from "../read"

const CONFIG_FILES = ["opencode.json", "opencode.jsonc", "config.json"]

/**
 * OpenCode. Keys come from its sign-in store — `type: "api"` entries only; OAuth
 * accounts belong to OpenCode — and from its config, where a provider may carry
 * `options.apiKey` (literal or `{env:VAR}`) and a custom one declares the
 * `options.baseURL` it lives at. OpenCode Zen's key is skipped: it only works
 * against Zen, which no other agent is set up to call.
 */
export function readOpencode(ctx: ReadContext): CredentialProfile[] {
  const dataHome =
    ctx.env.XDG_DATA_HOME || path.join(ctx.home, ".local", "share")
  const configHome = ctx.env.XDG_CONFIG_HOME || path.join(ctx.home, ".config")
  const auth = dig(readJson(path.join(dataHome, "opencode", "auth.json")))
  const config = CONFIG_FILES.map((f) =>
    readJson(path.join(configHome, "opencode", f)),
  ).find(isRecord)
  const providers = dig(config, "provider")
  const [defaultProvider, ...rest] = str(config?.model).split("/")
  const source: ImportSource = { kind: "cli", ref: "opencode" }

  const ids = new Set([...Object.keys(auth), ...Object.keys(providers)])
  ids.delete("opencode")
  return compact(
    [...ids].map((id) => {
      const stored = dig(auth, id)
      const declared = dig(providers, id)
      const options = dig(declared, "options")
      const known = OPENCODE_PROVIDERS[id]
      return makeProfile({
        protocol:
          known?.protocol ??
          (str(declared.npm).includes("anthropic") ? "anthropic" : "openai"),
        vendor: known?.vendor ?? "relay",
        apiKey:
          (stored.type === "api" ? str(stored.key) : "") ||
          resolveEnvRef(options.apiKey, ctx.env),
        baseUrl: str(options.baseURL) || known?.base || "",
        model: id === defaultProvider ? rest.join("/") : "",
        source,
      })
    }),
  )
}
