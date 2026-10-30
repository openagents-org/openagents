import React, { useState } from "react"
import { Download, FileSearch, RefreshCw, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@renderer/components/layout/page-header"
import { Button } from "@renderer/components/ui/button"
import { Label } from "@renderer/components/ui/label"
import { Switch } from "@renderer/components/ui/switch"
import { FilterChips } from "@renderer/components/ui-kit"
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
import { cn } from "@renderer/lib/utils"
import { useAgentsStore } from "@renderer/store/agents"
import { formatDateTime } from "@renderer/services/logs/log-metrics"
import type { ParsedLog } from "@renderer/services/logs/log-parser"
import type { ToastType } from "@renderer/hooks/useToast"
import { useLogs } from "./use-logs"
import { useLogFilters, type LogsView } from "./use-log-filters"
import { RANGES, useLogView, type RangeKey } from "./use-log-view"
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
/** Shortest spin that reads as "it did something" rather than a flicker. */
const MIN_SPIN_MS = 450

export default function Logs({ showToast }: LogsProps): React.JSX.Element {
  const { t } = useTranslation()
  const agents = useAgentsStore((s) => s.agents)
  const { filters, update, setPage, setLevels, setBrush, toggleSort } =
    useLogFilters()

  const [clearOpen, setClearOpen] = useState(false)
  const [contextEntry, setContextEntry] = useState<ParsedLog | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [highlightId, setHighlightId] = useState<number | null>(null)

  const feed = useLogs({ agentFilter: filters.agent, autoRefresh: filters.live })
  const now = feed.lastUpdated ?? Date.now()
  const view = useLogView(feed.entries, filters, now, t("logs.unknownAgent"))

  // The tail returns in single-digit milliseconds, so a spinner tied purely to
  // the read would never paint. Hold the spin briefly so the button visibly
  // responds to the press.
  const [refreshing, setRefreshing] = useState(false)
  const runRefresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await Promise.all([
        feed.refresh(true),
        new Promise((resolve) => window.setTimeout(resolve, MIN_SPIN_MS)),
      ])
    } finally {
      setRefreshing(false)
    }
  }

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
        title={t("logs.title")}
        subtitle={t("logs.subtitle")}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => void runRefresh()}
              disabled={refreshing || feed.loading}
            >
              <RefreshCw className={cn(refreshing && "animate-spin")} />
              {t("logs.actions.refresh")}
            </Button>
            <Button variant="outline" onClick={exportLogs}>
              <Download />
              {t("logs.actions.export")}
            </Button>
            <Button variant="destructive-ghost" onClick={() => setClearOpen(true)}>
              <Trash2 />
              {t("logs.actions.clear")}
            </Button>
            <span aria-hidden className="mx-2 h-6 w-px bg-border" />
            <Label className="cursor-pointer gap-2.5 text-sm font-normal whitespace-nowrap">
              {t("logs.actions.live")}
              <Switch checked={filters.live} onCheckedChange={(live) => update({ live })} />
            </Label>
          </>
        }
      />

      <div className="shrink-0 px-9">
        <div className="flex h-11 border-b">
          <FilterChips
            variant="underline"
            value={filters.view}
            onChange={(v) => update({ view: v as LogsView })}
            options={VIEWS.map((v) => ({ value: v, label: t(`logs.view.${v}`) }))}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-9 pt-4 pb-5">
          <LogsFilterBar
            leading={
              <Select
                value={filters.range}
                onValueChange={(v) => update({ range: v as RangeKey, brush: null })}
              >
                <SelectTrigger className="w-36 shrink-0">
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
            }
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
          />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">

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
        </div>
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
