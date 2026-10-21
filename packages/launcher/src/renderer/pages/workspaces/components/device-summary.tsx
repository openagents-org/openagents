import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Monitor } from "lucide-react"

import type { NodeStatus } from "@renderer/types"

/**
 * This device and how many workspaces it is paired to. The workspaces
 * themselves are the table below, so they are not listed again here, where
 * any number of them would have to fit on one line.
 */
export function DeviceSummary(): React.JSX.Element {
  const { t } = useTranslation()
  const [node, setNode] = useState<NodeStatus | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    const refresh = (): void => {
      void window.api
        .getNodeStatus()
        .then((next) => {
          if (!active) return
          setNode(next)
          setError(false)
        })
        .catch(() => {
          if (active) setError(true)
        })
    }
    refresh()
    const interval = setInterval(refresh, 8000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  const status = error
    ? t("workspaces.device.statusUnavailable")
    : !node
      ? t("workspaces.device.loading")
      : node.workspaces.length
        ? t("workspaces.device.connectedCount", { count: node.workspaces.length })
        : t("workspaces.device.localOnly")

  return (
    <div className="mb-5 flex min-w-0 items-center border-b pb-5 text-sm" data-testid="device-summary">
      <Monitor className="mr-2.5 size-5 shrink-0" />
      <span className="truncate text-base font-medium" title={node?.hostname}>
        {node?.hostname || t("agents.shared.thisComputer")}
      </span>
      <span aria-hidden className="mx-4 h-4 w-px shrink-0 bg-border" />
      <span className="shrink-0 text-muted-foreground">{status}</span>
    </div>
  )
}
