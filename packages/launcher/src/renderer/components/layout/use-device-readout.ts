import React from "react"
import { useTranslation } from "react-i18next"

import { useAgentsStore, useDaemonStatus } from "@renderer/store/agents"

/**
 * What the window says about the machine it runs on: its name, the daemon's
 * health and the app version. Shared by the top bar's device icon and the
 * status line along the bottom.
 */
export function useDeviceReadout(): {
  hostname: string | null
  status: ReturnType<typeof useDaemonStatus>
  statusLabel: string
  version: string
} {
  const { t } = useTranslation()
  const status = useDaemonStatus()
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

  const statusLabel =
    status === "running"
      ? t("nav.daemon.running")
      : status === "starting"
        ? t("nav.daemon.starting")
        : status === "stopped"
          ? t("nav.daemon.stopped")
          : t("nav.daemon.offline")

  return { hostname, status, statusLabel, version: appVersion || reportedVersion || "v?" }
}
