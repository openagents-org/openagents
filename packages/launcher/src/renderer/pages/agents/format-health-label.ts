import type { TFunction } from "i18next"
import type { HealthCheck } from "../../types"

export function formatHealthLabel(
  health: HealthCheck | null,
  t: TFunction,
): string {
  if (!health) return t("agents.list.health.notConfigured")
  if (!health.ready) {
    // "Not installed" is reserved for a genuinely missing executable. Decide
    // from the structured reason / installed flag, NOT the free-text message —
    // an installed-but-signed-out agent must read "Login required", never
    // "Not installed" (the bug this guard removes). Stale messages that still
    // say "not installed" on a resolved binary are suppressed defensively.
    const notInstalled =
      health.reason === "not_installed" || health.installed === false
    if (notInstalled) return t("agents.list.health.notInstalled")
    const msg = health.message
    if (msg && !/not\s+installed/i.test(msg)) return msg
    return t("agents.list.health.loginRequired")
  }
  const parts = [t("agents.list.health.ready")]
  if (health.auth_mode === "api_key") parts.push(t("agents.list.health.apiKey"))
  else if (health.auth_mode === "cli_login")
    parts.push(t("agents.list.health.cliLogin"))
  if (health.execution_mode && health.execution_mode !== "unavailable")
    parts.push(health.execution_mode)
  return parts.join(" · ")
}
