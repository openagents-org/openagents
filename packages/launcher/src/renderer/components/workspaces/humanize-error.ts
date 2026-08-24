import type { TFunction } from "i18next"

import { cleanIpcError } from "@renderer/lib/pairing-code"

/** Turns connector/network failures into something a user can act on. */
export function humanizeError(err: unknown, t: TFunction): string {
  const raw = (err as Error)?.message ?? String(err)
  if (/ERR_TLS_CERT_ALTNAME_INVALID|altnames/i.test(raw)) {
    return t("workspaces.quickConnect.error.tls")
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) {
    return t("workspaces.quickConnect.error.dns")
  }
  // AbortError is what the connector's own request deadline looks like once it
  // has crossed IPC — "The operation was aborted" told the user nothing and
  // named nothing they could do.
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|timed out|AbortError|aborted/i.test(raw)) {
    return t("workspaces.quickConnect.error.timeout")
  }
  // Anything else is the workspace's own message ("code already used",
  // "expired") — more specific than anything we could write, so it comes back
  // stripped of Electron's IPC framing but otherwise untouched.
  const cleaned = cleanIpcError(raw)
  return cleaned.length > 220 ? `${cleaned.slice(0, 220)}…` : cleaned
}
