import React, { useState } from "react"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@renderer/components/layout/page-header"
import { Card } from "@renderer/components/shadcn/card"
import { Tabs, TabsList, TabsTrigger } from "@renderer/components/shadcn/tabs"
import { useAgentsStore } from "@renderer/store/agents"
import type { LogLevel } from "@renderer/services/logs/log-parser"
import type { ToastType } from "@renderer/hooks/useToast"
import { LEVEL_ORDER, useLogs } from "./use-logs"
import { LogsToolbar } from "./components/logs-toolbar"
import { LogList, LogTimeline } from "./components/log-entries"
import { ClearLogsDialog } from "./components/clear-logs-dialog"

interface LogsProps {
  showToast: (msg: string, type?: ToastType) => void
}

const VIEWS = ["list", "timeline"] as const
type View = (typeof VIEWS)[number]

export default function Logs({ showToast }: LogsProps): React.JSX.Element {
  const { t } = useTranslation()
  const agents = useAgentsStore((s) => s.agents)

  const [agentFilter, setAgentFilter] = useState("")
  const [search, setSearch] = useState("")
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [view, setView] = useState<View>("list")
  const [clearOpen, setClearOpen] = useState(false)
  const [enabledLevels, setEnabledLevels] = useState<Set<LogLevel>>(
    () => new Set(LEVEL_ORDER),
  )

  const logs = useLogs({ agentFilter, search, enabledLevels, autoRefresh })

  const toggleLevel = (lvl: LogLevel): void =>
    setEnabledLevels((prev) => {
      const next = new Set(prev)
      if (next.has(lvl)) next.delete(lvl)
      else next.add(lvl)
      return next
    })

  const copyLogs = (): void => {
    navigator.clipboard
      .writeText(logs.lines.join("\n"))
      .then(() => showToast(t("logs.toast.copied"), "success"))
      .catch(() => showToast(t("logs.toast.copyFailed"), "error"))
  }

  const exportLogs = (): void => {
    try {
      const blob = new Blob([logs.lines.join("\n")], { type: "text/plain" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `openagents-${agentFilter || "all"}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast(t("logs.toast.exported"), "success")
    } catch (e) {
      showToast(
        t("logs.toast.exportFailed", { message: (e as Error).message }),
        "error",
      )
    }
  }

  const clearRange = async (startIso: string, endIso: string): Promise<string | null> => {
    try {
      const result = await window.api.clearLogsInRange(startIso, endIso)
      logs.resetOffset()
      await logs.refresh(true)
      showToast(t("logs.toast.deleted", { count: result.removed || 0 }), "success")
      return null
    } catch (err: unknown) {
      return (err as Error).message || t("logs.clearModal.errors.generic")
    }
  }

  const manualRefresh = (): void => {
    logs.resetOffset()
    void logs.refresh(true)
  }

  return (
    <section className="flex h-full flex-col">
      <PageHeader
        title={t("logs.title")}
        subtitle={t("logs.subtitle")}
        actions={
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList>
              {VIEWS.map((v) => (
                <TabsTrigger key={v} value={v} className="text-2xs">
                  {t(`logs.view.${v}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />

      <div className="flex flex-1 flex-col overflow-hidden px-9 py-6">
        <LogsToolbar
          agents={agents}
          agentFilter={agentFilter}
          onAgentFilterChange={setAgentFilter}
          search={search}
          onSearchChange={setSearch}
          enabledLevels={enabledLevels}
          onToggleLevel={toggleLevel}
          levelCounts={logs.levelCounts}
          autoRefresh={autoRefresh}
          onAutoRefreshChange={setAutoRefresh}
          onRefresh={manualRefresh}
          onCopy={copyLogs}
          onExport={exportLogs}
          onClear={() => setClearOpen(true)}
        />

        <Card
          ref={logs.containerRef}
          onScroll={logs.onScroll}
          className="flex-1 gap-0 overflow-auto p-0 font-mono text-xs leading-snug"
        >
          {logs.filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              {logs.lines.length === 0
                ? t("logs.empty.noLogs")
                : t("logs.empty.noMatch")}
            </p>
          ) : view === "timeline" ? (
            <LogTimeline entries={logs.filtered} />
          ) : (
            <LogList entries={logs.filtered} />
          )}
        </Card>
      </div>

      <ClearLogsDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={clearRange}
      />
    </section>
  )
}
