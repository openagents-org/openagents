import * as React from "react"
import { useTranslation } from "react-i18next"
import type { CredentialSummary } from "../../types"

/**
 * Where this credential is referenced. Driven by the credential's
 * `usedByAgents` / `usedByConnections` fields plus the in-renderer
 * connections cross-reference.
 */
export function CredentialUsage({
  cred,
}: {
  cred: CredentialSummary
}): React.JSX.Element {
  const { t } = useTranslation()
  const agents = cred.usedByAgents || []
  const conns = cred.usedByConnections || []
  const total = agents.length + conns.length
  if (total === 0) {
    return (
      <div className="text-2xs text-muted-foreground">
        {t("credentials.usage.notUsed")}
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
      <span>{t("credentials.usage.usedBy")}</span>
      {agents.map((a) => (
        <span
          key={`agent:${a}`}
          className="inline-flex items-center rounded-sm bg-muted px-1.5 py-px text-foreground"
        >
          {a}
        </span>
      ))}
      {conns.map((c) => (
        <span
          key={`conn:${c}`}
          className="inline-flex items-center rounded-sm bg-primary/10 px-1.5 py-px text-(--text-link)"
        >
          conn:{c.slice(0, 6)}
        </span>
      ))}
    </div>
  )
}
