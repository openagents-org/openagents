import type { TFunction } from "i18next"

/**
 * Turn the account layer's error codes into something a person can act on.
 *
 * Main throws bare codes across IPC on purpose — a sign-in failure is one of a
 * handful of known situations, and the wording for each belongs in the locale
 * files, not in the main process, which has no i18n.
 */
const CODES: Record<string, string> = {
  SIGN_IN_TIMED_OUT: "account.error.timeout",
  SIGN_IN_UNREACHABLE: "account.error.unreachable",
  SIGN_IN_EMPTY_HANDOFF: "account.error.empty",
  SIGN_IN_BROWSER_UNAVAILABLE: "account.error.browserUnavailable",
  SIGN_IN_BAD_CREDENTIALS: "account.error.badCredentials",
  SIGN_IN_TOO_MANY_ATTEMPTS: "account.error.tooManyAttempts",
  SESSION_EXPIRED: "account.error.expired",
  NOT_SIGNED_IN: "account.error.expired",
}

export function accountError(err: unknown, t: TFunction): string {
  const raw = typeof err === "string" ? err : ((err as Error)?.message ?? "")
  for (const [code, key] of Object.entries(CODES)) {
    if (raw.includes(code)) return t(key)
  }
  // Electron prefixes anything thrown in a handler with its own framing; the
  // server's own message is more specific than anything we could write, so it
  // comes through with only that framing removed.
  const cleaned = raw.replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "")
    .trim()
  return cleaned || t("account.error.generic")
}
