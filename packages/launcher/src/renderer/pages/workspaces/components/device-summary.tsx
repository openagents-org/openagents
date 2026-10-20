import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowRight, Monitor } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import type { NodeConnection, NodeStatus } from "@renderer/types"

/**
 * This device and the workspaces it is paired to, one chip per workspace. It
 * used to head This Computer with a settings link and an install shortcut;
 * here it keeps only what belongs on a page about this device's workspaces.
 */
export function DeviceSummary({
  onOpen,
}: {
  onOpen: (workspace: NodeConnection) => void
}): React.JSX.Element {
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
    <div className="mb-6 flex flex-col gap-4 rounded-2xl border bg-card p-5" data-testid="device-summary">
      <div className="flex items-center gap-4">
        <div className="rounded-xl bg-muted p-3">
          <Monitor className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate font-medium" title={node?.hostname}>
            {node?.hostname || t("agents.shared.thisComputer")}
          </p>
          <p className="m-0 mt-1 text-sm text-muted-foreground">{status}</p>
        </div>
      </div>
      {!!node?.workspaces.length && (
        <div className="flex flex-wrap gap-2">
          {node.workspaces.map((workspace) => {
            const name = workspace.workspaceName || workspace.workspaceSlug || workspace.workspaceId
            return (
              <Button
                key={workspace.workspaceId}
                size="sm"
                variant="outline"
                title={t("workspaces.device.openWorkspace", { name })}
                onClick={() => onOpen(workspace)}
              >
                <span className="max-w-60 truncate">{name}</span>
                <ArrowRight className="size-3.5" />
              </Button>
            )
          })}
        </div>
      )}
    </div>
  )
}
