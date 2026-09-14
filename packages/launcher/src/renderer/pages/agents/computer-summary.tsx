import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Monitor, Settings, Download, ArrowRight } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { useUiStore } from "@renderer/store/ui"
import type { NodeStatus } from "@renderer/types"

export function ComputerSummary(): React.JSX.Element {
  const { t } = useTranslation()
  const [node, setNode] = useState<NodeStatus | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = (): void => { void window.api.getNodeStatus().then((next) => { if (active) { setNode(next); setError(false) } }).catch(() => { if (active) setError(true) }) }
    refresh(); const interval = setInterval(refresh, 8000)
    return () => { active = false; clearInterval(interval) }
  }, [])
  const navigate = useUiStore((s) => s.setCurrentTab)
  return <div className="mb-7 rounded-2xl border bg-card p-5 space-y-5">
    <div className="flex items-start gap-4">
      <div className="rounded-xl bg-muted p-3"><Monitor className="size-6" /></div>
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate" title={node?.hostname}>{node?.hostname || t("agents.shared.thisComputer")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{error ? t("agents.shared.statusUnavailable") : !node ? t("agents.shared.loading") : node.workspaces.length ? t("agents.shared.connectedCount", { count: node.workspaces.length }) : t("agents.shared.localDescription")}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => navigate("settings")}><Settings className="size-4" />{t("nav.items.settings.label")}</Button>
    </div>
    {!!node?.workspaces.length && <div className="flex flex-wrap gap-2">
      {node.workspaces.map((workspace) => <Button key={workspace.workspaceId} size="sm" variant="outline" onClick={() => navigate("workspaces")}>
        <span className="max-w-60 truncate">{workspace.workspaceName || workspace.workspaceSlug || workspace.workspaceId}</span><ArrowRight className="size-3.5" />
      </Button>)}
    </div>}
    <div className="flex items-center justify-between border-t pt-3 gap-3">
      <p className="text-xs text-muted-foreground">{t("agents.shared.deviceSettingsHint")}</p>
      <Button variant="ghost" size="sm" onClick={() => navigate("install")}><Download className="size-4" />{t("agents.shared.softwareUpdates")}</Button>
    </div>
  </div>
}
