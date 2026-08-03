import React, { useState } from "react"
import { Download, FileSearch, RefreshCw, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@renderer/components/layout/page-header"
import { Button } from "@renderer/components/ui/button"
import { Card } from "@renderer/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@renderer/components/ui/empty"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@renderer/components/ui/tabs"
import { useAgentsStore } from "@renderer/store/agents"
import { formatDateTime } from "@renderer/services/logs/log-metrics"
import type { ParsedLog } from "@renderer/services/logs/log-parser"
import type { ToastType } from "@renderer/hooks/useToast"
import { useLogs } from "./use-logs"
import { useLogFilters, type LogsView } from "./use-log-filters"
import { RANGES, useLogView, type RangeKey } from "./use-log-view"
import { LogsStats } from "./components/logs-stats"
import { LogsFilterBar } from "./components/logs-filter-bar"
import { LogTable } from "./components/log-table"
import { LogTableFooter } from "./components/log-table-footer"
import { LogTimeline } from "./components/log-timeline"
import { LogContextDialog } from "./components/log-context-dialog"
import { ClearLogsDialog } from "./components/clear-logs-dialog"

interface LogsProps {
  showToast: (msg: string, type?: ToastType) => void
}

const VIEWS: LogsView[] = ["list", "timeline"]

export default function Logs({ showToast }: LogsProps): React.JSX.Element {
  const { t } = useTranslation()
  const agents = useAgentsStore((s) => s.agents)
  const { filters, update, setPage, setLevels, setBrush, focusLevel, toggleSort } =
    useLogFilters()

  const [clearOpen, setClearOpen] = useState(false)
  const [contextEntry, setContextEntry] = useState<ParsedLog | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [highlightId, setHighlightId] = useState<number | null>(null)

  const feed = useLogs({ agentFilter: filters.agent, autoRefresh: filters.live })
  const now = feed.lastUpdated ?? Date.now()
  const view = useLogView(feed.entries, filters, now, t("logs.unknownAgent"))

  const copy = (text: string): void => {
    navigator.clipboard
      .writeText(text)
      .then(() => showToast(t("logs.toast.copied"), "success"))
      .catch(() => showToast(t("logs.toast.copyFailed"), "error"))
  }

  const copyDetail = (entry: ParsedLog): void => {
    const lines = [
      `${formatDateTime(entry.time)} [${entry.level.toUpperCase()}] ${entry.agent || entry.scope || ""}`,
      entry.message,
      ...entry.tags.map((tag) => `${t(`logs.tag.${tag.key}`)}: ${tag.value}`),
      ...entry.stack,
    ]
    copy(lines.filter(Boolean).join("\n"))
  }

  const exportLogs = (): void => {
    try {
      const body = view.filtered.map((e) => e.raw).join("\n")
      const blob = new Blob([body], { type: "text/plain" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `openagents-${filters.agent || "all"}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast(t("logs.toast.exported", { count: view.filtered.length }), "success")
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
      await feed.refresh(true)
      showToast(t("logs.toast.deleted", { count: result.removed || 0 }), "success")
      return null
    } catch (err: unknown) {
      return (err as Error).message || t("logs.clearModal.errors.generic")
    }
  }

  // Jumping from a timeline dot: switch views, page to the entry, open it.
  const openEntry = (entry: ParsedLog): void => {
    const index = view.ordered.findIndex((e) => e.id === entry.id)
    update({ view: "list" })
    if (index >= 0) setPage(Math.floor(index / filters.pageSize) + 1)
    setExpandedId(entry.id)
    setHighlightId(entry.id)
  }

  const empty = view.filtered.length === 0

  return (
    <section className="flex h-full flex-col">
      <PageHeader
        stacked
        title={t("logs.title")}
        subtitle={t("logs.subtitle")}
        actions={
          <>
            <Tabs
              value={filters.view}
              onValueChange={(v) => update({ view: v as LogsView })}
            >
              <TabsList>
                {VIEWS.map((v) => (
                  <TabsTrigger key={v} value={v} className="text-2xs">
                    {t(`logs.view.${v}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <Select
              value={filters.range}
              onValueChange={(v) => update({ range: v as RangeKey, brush: null })}
            >
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((range) => (
                  <SelectItem key={range} value={range}>
                    {t(`logs.range.${range}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              size="sm"
              variant="outline"
              onClick={() => void feed.refresh(true)}
              disabled={feed.loading}
            >
              <RefreshCw />
              {t("logs.actions.refresh")}
            </Button>
            <Button size="sm" variant="outline" onClick={exportLogs}>
              <Download />
              {t("logs.actions.export")}
            </Button>
            <Button
              size="sm"
              variant="destructive-ghost"
              onClick={() => setClearOpen(true)}
            >
              <Trash2 />
              {t("logs.actions.clear")}
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-9 py-6">
        <LogsStats
          buckets={view.sparkBuckets}
          total={view.scoped.length}
          errors={view.levelCounts.error}
          warnings={view.levelCounts.warn}
          activeAgents={view.activeAgents}
          onFocusLevel={focusLevel}
        />

        <Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden p-0">
          <LogsFilterBar
            agents={agents}
            agentFilter={filters.agent}
            onAgentFilterChange={(agent) => update({ agent })}
            search={filters.search}
            onSearchChange={(search) => update({ search })}
            levels={filters.levels}
            onLevelsChange={setLevels}
            levelCounts={view.levelCounts}
            eventTypes={filters.eventTypes}
            onEventTypesChange={(eventTypes) => update({ eventTypes })}
            onlyWithStack={filters.onlyWithStack}
            onOnlyWithStackChange={(onlyWithStack) => update({ onlyWithStack })}
            live={filters.live}
            onLiveChange={(live) => update({ live })}
          />

          {empty ? (
            <Empty className="flex-1">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileSearch />
                </EmptyMedia>
                <EmptyTitle>
                  {feed.entries.length === 0
                    ? t("logs.empty.noLogs")
                    : t("logs.empty.noMatch")}
                </EmptyTitle>
                <EmptyDescription>
                  {feed.error || t("logs.empty.hint")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : filters.view === "timeline" ? (
            <LogTimeline
              buckets={view.densityBuckets}
              lanes={view.lanes}
              incidents={view.incidents}
              span={view.span}
              brush={filters.brush}
              onBrushChange={setBrush}
              now={now}
              onOpenEntry={openEntry}
              onCopyDetail={copyDetail}
            />
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-auto">
                <LogTable
                  entries={view.pageItems}
                  density={filters.density}
                  sort={filters.sort}
                  onToggleSort={toggleSort}
                  expandedId={expandedId}
                  onToggleExpand={(id) => {
                    setExpandedId((prev) => (prev === id ? null : id))
                    setHighlightId(null)
                  }}
                  highlightId={highlightId}
                  onCopyDetail={copyDetail}
                  onShowContext={setContextEntry}
                />
              </div>
              <LogTableFooter
                loaded={view.filtered.length}
                page={Math.min(filters.page, view.pageCount)}
                pageCount={view.pageCount}
                onPageChange={setPage}
                pageSize={filters.pageSize}
                onPageSizeChange={(pageSize) => update({ pageSize })}
                density={filters.density}
                onDensityChange={(density) => update({ density })}
              />
            </>
          )}
        </Card>
      </div>

      <LogContextDialog
        entry={contextEntry}
        lines={feed.lines}
        onClose={() => setContextEntry(null)}
        onCopy={copy}
      />
      <ClearLogsDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={clearRange}
      />
    </section>
  )
}
