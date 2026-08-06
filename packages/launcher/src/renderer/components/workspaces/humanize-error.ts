import type { TFunction } from "i18next"

/** Turns connector/network failures into something a user can act on. */
export function humanizeError(err: unknown, t: TFunction): string {
  const raw = (err as Error)?.message ?? String(err)
  // Raised by AgentManager.connectWorkspace when a pasted workspace link had
  // no `?token=` to work with — the fix is to copy the token, not to retry.
  if (raw.includes("WORKSPACE_LINK_MISSING_TOKEN")) {
    return t("workspaces.quickConnect.error.linkMissingToken")
  }
  if (/invalid or expired token/i.test(raw)) {
    return t("workspaces.quickConnect.error.invalidToken")
  }
  if (/ERR_TLS_CERT_ALTNAME_INVALID|altnames/i.test(raw)) {
    return t("workspaces.quickConnect.error.tls")
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) {
    return t("workspaces.quickConnect.error.dns")
  }
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|timed out/i.test(raw)) {
    return t("workspaces.quickConnect.error.timeout")
  }
  const cleaned = raw.replace(/^Error invoking remote method '[^']+':\s*/i, "")
  return cleaned.length > 220 ? `${cleaned.slice(0, 220)}…` : cleaned
}
