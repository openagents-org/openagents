import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Search, Download, Trash2, RefreshCw, Copy, ChevronDown, ChevronRight } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "../../components/ui/Button"
import { TopBar } from "../../components/TopBar"
import { Modal, ModalTitle } from "../../components/ui/Modal"
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/Tabs"
import { useAgentsStore } from "../../store/agents"
import { LogLevelBadge } from "../../components/logs/LogLevelBadge"
import { JsonViewer } from "../../components/logs/JsonViewer"
import {
  parseLines,
  type LogLevel,
  type ParsedLog,
} from "../../services/logs/log-parser"
import { cn } from "../../lib/utils"
import type { ToastType } from "../../hooks/useToast"

const LOGS_INITIAL_LINES = 400
const LOGS_MAX_BUFFER = 2000

interface LogsProps {
  showToast: (msg: string, type?: ToastType) => void
}

function toDateTimeLocalValue(date: Date): string {
  const pad = (v: number): string => String(v).padStart(2, "0")
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
  ].join("")
}

const LEVEL_ORDER: LogLevel[] = ["error", "warn", "info", "debug", "trace", "unknown"]

export default function Logs({ showToast }: LogsProps): React.JSX.Element {
  const { t } = useTranslation()
  const agents = useAgentsStore((s) => s.agents)
  const [logLines, setLogLines] = useState<string[]>([])
  const [agentFilter, setAgentFilter] = useState("")
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearStart, setClearStart] = useState("")
  const [clearEnd, setClearEnd] = useState("")
  const [clearInFlight, setClearInFlight] = useState(false)
  const [clearError, setClearError] = useState("")
  const [search, setSearch] = useState("")
  const [enabledLevels, setEnabledLevels] = useState<Set<LogLevel>>(
    () => new Set(LEVEL_ORDER),
  )
  const [view, setView] = useState<"list" | "timeline">("list")
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const logsOffset = useRef(0)
  const filterRef = useRef("")
  const containerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refreshLogs = useCallback(async (reset = false) => {
    if (!mounted.current) return
    try {
      const filter = filterRef.current
      const shouldReset = reset || logsOffset.current === 0
      const result = await window.api.tailAgentLogs(
        filter,
        LOGS_INITIAL_LINES,
        shouldReset ? 0 : logsOffset.current,
      )
      if (!mounted.current) return
      logsOffset.current = result.size || 0
      if (shouldReset) {
        setLogLines(result.lines && result.lines.length > 0 ? result.lines : [])
      } else if (result.lines && result.lines.length > 0) {
        setLogLines((prev) =>
          [...prev, ...result.lines].slice(-LOGS_MAX_BUFFER),
        )
      }
      if (stickToBottomRef.current) {
        setTimeout(() => {
          if (containerRef.current)
            containerRef.current.scrollTop = containerRef.current.scrollHeight
        }, 0)
      }
    } catch (err: unknown) {
      if (mounted.current)
        setLogLines([`Error loading logs: ${(err as Error).message}`])
    }
  }, [])

  useEffect(() => {
    logsOffset.current = 0
    refreshLogs(true)
  }, [refreshLogs])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => refreshLogs(false), 3000)
    return () => clearInterval(interval)
  }, [autoRefresh, refreshLogs])

  const handleFilterChange = (value: string): void => {
    setAgentFilter(value)
    filterRef.current = value
    logsOffset.current = 0
    refreshLogs(true)
  }

  const parsed = useMemo(() => parseLines(logLines), [logLines])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return parsed
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => {
        if (!enabledLevels.has(p.level)) return false
        if (!q) return true
        return (
          p.message.toLowerCase().includes(q) ||
          (p.source || "").toLowerCase().includes(q) ||
          p.raw.toLowerCase().includes(q)
        )
      })
  }, [parsed, search, enabledLevels])

  const levelCounts = useMemo(() => {
    const c: Record<LogLevel, number> = {
      error: 0, warn: 0, info: 0, debug: 0, trace: 0, unknown: 0,
    }
    for (const p of parsed) c[p.level] += 1
    return c
  }, [parsed])

  const onScroll = (): void => {
    if (!containerRef.current) return
    const el = containerRef.current
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 40
    stickToBottomRef.current = atBottom
  }

  const toggleExpanded = (i: number): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const copyLogs = (): void => {
    navigator.clipboard
      .writeText(logLines.join("\n"))
      .then(() => showToast(t("logs.toast.copied"), "success"))
      .catch(() => showToast(t("logs.toast.copyFailed"), "error"))
  }

  const exportLogs = (): void => {
    try {
      const blob = new Blob([logLines.join("\n")], { type: "text/plain" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      a.download = `openagents-${agentFilter || "all"}-${stamp}.log`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast(t("logs.toast.exported"), "success")
    } catch (e) {
      showToast(t("logs.toast.exportFailed", { message: (e as Error).message }), "error")
    }
  }

  const openClearModal = (): void => {
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
    setClearStart(toDateTimeLocalValue(oneHourAgo))
    setClearEnd(toDateTimeLocalValue(now))
    setClearError("")
    setClearOpen(true)
  }

  const doClearLogs = async (): Promise<void> => {
    if (clearInFlight) return
    const start = clearStart ? new Date(clearStart) : null
    const end = clearEnd ? new Date(clearEnd) : null
    if (!start || isNaN(start.getTime()) || !end || isNaN(end.getTime())) {
      setClearError(t("logs.clearModal.errors.invalidRange"))
      return
    }
    if (start.getTime() > end.getTime()) {
      setClearError(t("logs.clearModal.errors.startAfterEnd"))
      return
    }
    setClearInFlight(true)
    setClearError("")
    try {
      const result = await window.api.clearLogsInRange(
        start.toISOString(),
        end.toISOString(),
      )
      setClearOpen(false)
      logsOffset.current = 0
      await refreshLogs(true)
      showToast(
        t("logs.toast.deleted", { count: result.removed || 0 }),
        "success",
      )
    } catch (err: unknown) {
      setClearError((err as Error).message || t("logs.clearModal.errors.generic"))
    } finally {
      setClearInFlight(false)
    }
  }

  return (
    <section className="flex flex-col h-full">
      <TopBar
        title={t("logs.title")}
        subtitle={t("logs.subtitle")}
        actions={
          <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
            <TabsList>
              {(["list", "timeline"] as const).map((v) => (
                <TabsTrigger key={v} value={v} className="px-3 py-1 text-[11px]">
                  {v === "list" ? t("logs.view.list") : t("logs.view.timeline")}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />

      <div className="flex-1 overflow-hidden flex flex-col px-9 py-6">

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          value={agentFilter}
          onChange={(e) => handleFilterChange(e.target.value)}
          className="px-3 py-1.5 text-xs bg-(--bg-input) text-(--text-primary) rounded-sm border border-transparent outline-none"
        >
          <option value="">{t("logs.allAgents")}</option>
          {agents.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1 px-2.5 py-1 rounded-sm bg-(--bg-input) text-[11px]">
          <Search className="w-3 h-3 text-(--text-tertiary)" />
          <input
            placeholder={t("logs.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent border-0 outline-none w-[180px] text-[12px] py-0.5"
          />
        </div>
        <div className="flex items-center gap-1">
          {LEVEL_ORDER.map((lvl) => {
            const on = enabledLevels.has(lvl)
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => {
                  setEnabledLevels((prev) => {
                    const next = new Set(prev)
                    if (next.has(lvl)) next.delete(lvl)
                    else next.add(lvl)
                    return next
                  })
                }}
                className={cn(
                  "border-0 cursor-pointer rounded-sm transition-opacity",
                  on ? "opacity-100" : "opacity-35",
                )}
                title={t("logs.toggleLevel", { level: lvl })}
              >
                <LogLevelBadge level={lvl} />
                <span className="ml-1 text-[10px] text-(--text-tertiary)">
                  {levelCounts[lvl]}
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={() => {
            logsOffset.current = 0
            refreshLogs(true)
          }}
        >
          <RefreshCw className="w-3 h-3" />
          {t("logs.actions.refresh")}
        </Button>
        <Button size="sm" onClick={copyLogs} title={t("logs.actions.copy")}>
          <Copy className="w-3 h-3" />
          {t("logs.actions.copy")}
        </Button>
        <Button size="sm" onClick={exportLogs}>
          <Download className="w-3 h-3" />
          {t("logs.actions.export")}
        </Button>
        <Button size="sm" variant="destructive" onClick={openClearModal}>
          <Trash2 className="w-3 h-3" />
          {t("logs.actions.clear")}
        </Button>
        <label className="flex items-center gap-1 ml-1 text-xs text-(--text-secondary) cursor-pointer">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="accent-(--accent)"
          />
          {t("logs.actions.auto")}
        </label>
      </div>

      <div
        ref={containerRef}
        onScroll={onScroll}
        className="flex-1 bg-(--bg-card) border border-(--border) rounded-(--radius-sm) overflow-auto font-mono text-[12px] leading-snug"
      >
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12px] text-(--text-tertiary)">
            {logLines.length === 0
              ? t("logs.empty.noLogs")
              : t("logs.empty.noMatch")}
          </div>
        ) : view === "timeline" ? (
          <TimelineView entries={filtered} />
        ) : (
          <ul className="m-0 p-0 list-none">
            {filtered.map(({ p, i }) => {
              const isExpanded = expanded.has(i)
              return (
                <li
                  key={i}
                  className={cn(
                    "px-3 py-1.5 border-b border-(--border) flex items-start gap-2 hover:bg-(--bg-input)/40",
                    p.level === "error" && "bg-(--danger-bg)/30",
                  )}
                >
                  <span className="shrink-0 text-[10px] text-(--text-tertiary) tabular-nums w-[80px]">
                    {p.timestamp ? p.timestamp.split(/[ T]/).pop()?.slice(0, 8) : "—"}
                  </span>
                  <span className="shrink-0 mt-[1px]">
                    <LogLevelBadge level={p.level} />
                  </span>
                  {p.source && (
                    <span className="shrink-0 text-[10px] text-(--accent) bg-(--accent-bg) px-1.5 py-0.5 rounded-sm">
                      {p.source}
                    </span>
                  )}
                  <div className="flex-1 min-w-0 wrap-break-word">
                    <span style={levelStyle(p.level)}>{p.message || p.raw}</span>
                    {p.json !== null && (
                      <div className="mt-1">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(i)}
                          className="inline-flex items-center gap-1 text-[10px] text-(--text-secondary) bg-transparent border-0 cursor-pointer p-0"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3 h-3" />
                          ) : (
                            <ChevronRight className="w-3 h-3" />
                          )}
                          {isExpanded ? t("logs.json.hide") : t("logs.json.show")}
                        </button>
                        {isExpanded && (
                          <pre className="bg-(--bg-input) rounded-sm px-3 py-2 mt-1 overflow-x-auto text-[11px]">
                            <JsonViewer value={p.json} collapsed={false} />
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      </div>

      <Modal open={clearOpen} onClose={() => setClearOpen(false)}>
        <ModalTitle>{t("logs.clearModal.title")}</ModalTitle>
        <p className="hint">{t("logs.clearModal.description")}</p>
        <div className="form-group">
          <label htmlFor="clear-start">{t("logs.clearModal.startTime")}</label>
          <input
            id="clear-start"
            type="datetime-local"
            value={clearStart}
            onChange={(e) => setClearStart(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="clear-end">{t("logs.clearModal.endTime")}</label>
          <input
            id="clear-end"
            type="datetime-local"
            value={clearEnd}
            onChange={(e) => setClearEnd(e.target.value)}
          />
        </div>
        {clearError && (
          <p className="text-xs text-(--danger-text) m-0 mb-2.5 min-h-4.5">
            {clearError}
          </p>
        )}
        <div className="form-actions">
          <Button onClick={() => setClearOpen(false)}>{t("logs.clearModal.cancel")}</Button>
          <Button
            variant="destructive"
            onClick={doClearLogs}
            disabled={clearInFlight}
          >
            {clearInFlight ? t("logs.clearModal.deleting") : t("logs.clearModal.delete")}
          </Button>
        </div>
      </Modal>
    </section>
  )
}

function levelStyle(level: LogLevel): React.CSSProperties {
  switch (level) {
    case "error":
      return { color: "var(--danger-text)" }
    case "warn":
      return { color: "var(--warning-text)" }
    case "info":
      return { color: "var(--text-primary)" }
    case "debug":
    case "trace":
      return { color: "var(--text-tertiary)" }
    default:
      return { color: "var(--text-primary)" }
  }
}

function TimelineView({
  entries,
}: {
  entries: Array<{ p: ParsedLog; i: number }>
}): React.JSX.Element {
  const { t } = useTranslation()
  // Group by date / hour bucket
  const groups = useMemo(() => {
    const map = new Map<string, Array<{ p: ParsedLog; i: number }>>()
    for (const e of entries) {
      const stamp = e.p.iso || e.p.timestamp || ""
      const key = stamp ? stamp.slice(0, 16) : t("logs.timeline.noTimestamp")
      const arr = map.get(key) || []
      arr.push(e)
      map.set(key, arr)
    }
    return Array.from(map.entries())
  }, [entries, t])

  return (
    <ol className="m-0 p-0 list-none">
      {groups.map(([bucket, list]) => (
        <li key={bucket} className="border-b border-(--border)">
          <div className="px-3 py-1.5 bg-(--bg-input) text-[10px] uppercase tracking-wide text-(--text-tertiary) font-semibold sticky top-0">
            {bucket}
          </div>
          <ul className="m-0 p-0 list-none">
            {list.map(({ p, i }) => (
              <li
                key={i}
                className="px-4 py-1.5 flex items-start gap-2 hover:bg-(--bg-input)/40"
              >
                <span className="shrink-0">
                  <LogLevelBadge level={p.level} />
                </span>
                {p.source && (
                  <span className="shrink-0 text-[10px] text-(--accent) bg-(--accent-bg) px-1.5 py-0.5 rounded-sm">
                    {p.source}
                  </span>
                )}
                <span
                  className="flex-1 min-w-0 wrap-break-word"
                  style={levelStyle(p.level)}
                >
                  {p.message || p.raw}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}

