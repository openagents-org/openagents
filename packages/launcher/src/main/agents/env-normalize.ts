/**
 * Provider URL/env normalization, applied on the way IN (what we persist) so it
 * matches what the connection test probes and what the spawned CLI sends.
 */
import { mirrorPiProviderApiKey } from "../pi-env"

export function normalizeWorkspaceEndpoint(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const raw = value.trim()
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    if (url.hostname === "workspace.openagents.org") {
      return url.origin.replace(
        "workspace.openagents.org",
        "workspace-endpoint.openagents.org",
      )
    }
    return url.origin
  } catch {
    return undefined
  }
}

/**
 * True when an Anthropic base URL points at Anthropic's own API (not a
 * third-party relay/proxy). The official endpoint authenticates with the API
 * key via the `x-api-key` header; everything else is treated as a relay that
 * wants `Authorization: Bearer` (see normalizeEnvForSave). An unparseable value
 * is treated as NON-official so we don't accidentally suppress the relay path.
 */
export function isOfficialAnthropicBase(base: string): boolean {
  try {
    const h = new URL(base).hostname.toLowerCase()
    return h === "anthropic.com" || h.endsWith(".anthropic.com")
  } catch {
    return false
  }
}

/**
 * Normalize provider base URLs before they're persisted to env, so what we
 * SAVE matches what we TEST (testLLMConnection). The mismatch this guards
 * against: a user pastes an Anthropic-compatible relay URL that already ends
 * in `/v1` (e.g. https://relay.example/v1). The connection test strips the
 * trailing `/v1` before probing `${base}/v1/messages`, so it passes — but the
 * spawned `claude` CLI appends `/v1/messages` to the raw value, hitting
 * `…/v1/v1/messages` → 404, which the CLI mis-reports as "model not found".
 *
 * Anthropic's SDK owns the `/v1` segment, so the base must NOT carry it. We do
 * NOT touch OpenAI-style bases (OPENAI_BASE_URL etc.) — those are SUPPOSED to
 * include `/v1` (the defaults do), and the OpenAI client appends only the
 * sub-path. Gemini already tolerates either form in its REST path builder.
 */
export function normalizeEnvForSave(
  env: Record<string, string>,
): Record<string, string> {
  const out = mirrorPiProviderApiKey(env)
  const anthropicBase = out.ANTHROPIC_BASE_URL
  if (typeof anthropicBase === "string" && anthropicBase.trim()) {
    out.ANTHROPIC_BASE_URL = anthropicBase
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/v1$/, "")
  }

  // Route Claude through Bearer auth on third-party relays. The Claude CLI
  // sends ANTHROPIC_API_KEY as the `x-api-key` header, but most Anthropic-
  // compatible relays/proxies — the usual reason a custom ANTHROPIC_BASE_URL is
  // set — only honor `Authorization: Bearer`. With just the API key those relays
  // reject every request as 401 "invalid token / 无效的令牌", which is exactly the
  // failure seen creating a workspace through such a relay. ANTHROPIC_AUTH_TOKEN
  // is sent as Bearer and, per Claude Code's auth precedence, outranks the API
  // key, so mirroring the key into it makes the CLI authenticate the way relays
  // expect. The daemon passes this env straight through to the spawned CLI, so
  // the fix works without changing the installed core. We do this ONLY for a
  // non-official base; for api.anthropic.com x-api-key is correct, so any stale
  // token from a previous relay save is cleared (saving "" drops the line) to
  // stop it overriding the API key.
  const anthropicKey = (out.ANTHROPIC_API_KEY || "").trim()
  const resolvedBase = (out.ANTHROPIC_BASE_URL || "").trim()
  if (anthropicKey && resolvedBase) {
    if (isOfficialAnthropicBase(resolvedBase)) {
      out.ANTHROPIC_AUTH_TOKEN = ""
    } else if (!(out.ANTHROPIC_AUTH_TOKEN || "").trim()) {
      out.ANTHROPIC_AUTH_TOKEN = anthropicKey
    }
  }

  return out
}
