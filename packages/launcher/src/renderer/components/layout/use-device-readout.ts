import React from "react"
import { useTranslation } from "react-i18next"

import { useAgentsStore, useAgentsSummary, type AgentsSummaryState } from "@renderer/store/agents"

/**
 * What the window says about the machine it runs on: its name, what its
 * agents are doing and the app version. Shared by the top bar's device icon and the
 * status line along the bottom.
 */
export function useDeviceReadout(): {
  hostname: string | null
  status: AgentsSummaryState
  statusLabel: string
  version: string
} {
  const { t } = useTranslation()
  const { state: status, count } = useAgentsSummary()
  const reportedVersion = useAgentsStore((s) => s.launcherVersion)
  const [appVersion, setAppVersion] = React.useState<string | null>(null)
  const [hostname, setHostname] = React.useState<string | null>(null)

  React.useEffect(() => {
    let active = true
    void window.api.appVersion().then((version) => {
      if (active) setAppVersion(version ? `v${version.replace(/^v/, "")}` : null)
    }).catch(() => {})
    void window.api.getNodeStatus().then((node) => {
      if (active) setHostname(node.hostname || null)
    }).catch(() => {})
    return () => { active = false }
  }, [])

  const statusLabel = t(`nav.agentsSummary.${status}`, { count })

  return { hostname, status, statusLabel, version: appVersion || reportedVersion || "v?" }
}
