import React from "react"
import { FolderPlus, Play, Plug, Plus, Square } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "../ui/button"

interface Props {
  onStartAll: () => void
  onStopAll: () => void
  onNewWorkspace: () => void
  onAddConnection: () => void
  onNewAgent: () => void
  hasRunning: boolean
  hasIdle: boolean
}

export function QuickActions({
  onStartAll,
  onStopAll,
  onNewWorkspace,
  onAddConnection,
  onNewAgent,
  hasRunning,
  hasIdle,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={onStartAll} disabled={!hasIdle}>
        <Play />
        {t("dashboard.quickActions.startAll")}
      </Button>
      {/* Stops every running agent at once — the destructive one in this row,
          so it drops the outline and carries the tone instead. */}
      <Button
        size="sm"
        variant="ghost"
        onClick={onStopAll}
        disabled={!hasRunning}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Square />
        {t("dashboard.quickActions.stopAll")}
      </Button>
      <Button size="sm" variant="outline" onClick={onNewWorkspace}>
        <FolderPlus />
        {t("dashboard.quickActions.newWorkspace")}
      </Button>
      <Button size="sm" variant="outline" onClick={onAddConnection}>
        <Plug />
        {t("dashboard.quickActions.addConnection")}
      </Button>
      <Button size="sm" onClick={onNewAgent}>
        <Plus />
        {t("dashboard.quickActions.newAgent")}
      </Button>
    </div>
  )
}
