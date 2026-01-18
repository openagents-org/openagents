import React, { useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import {
  oneDark,
  oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism"
import { ColumnDef } from "@tanstack/react-table"
import { useLLMLogStore } from "@/stores/llmLogStore"
import { useThemeStore } from "@/stores/themeStore"
import type { LLMLogEntry } from "@/types/llmLogs"
import { DataTable } from "@/components/layout/ui/data-table"
import { Button } from "@/components/layout/ui/button"
import { Input } from "@/components/layout/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardHeading,
  CardTitle,
  CardToolbar,
} from "@/components/layout/ui/card"
import { Badge } from "@/components/layout/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/layout/ui/select"
import {
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Search,
  Cpu,
  Zap,
  MessageSquare,
  Clock,
  AlertCircle,
  Hash,
  Copy,
  Check,
  Filter,
  Calendar,
  Eye,
  X,
} from "lucide-react"

const LLMLogsView: React.FC = () => {
  const { t } = useTranslation("llmlogs")
  const { theme } = useThemeStore()
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [modelFilter, setModelFilter] = useState("all")
  const [startDate, setStartDate] = useState("")
  const [hasErrorFilter, setHasErrorFilter] = useState<string>("all")
  const [selectedLog, setSelectedLog] = useState<LLMLogEntry | null>(null)

  const {
    logs,
    logsLoading,
    logsError,
    filters,
    searchQuery,
    stats,
    setSearchQuery,
    applyFilters,
    refreshLogs,
    copyToClipboard,
  } = useLLMLogStore()

  // Get unique models from logs
  const availableModels = useMemo(() => {
    const modelSet = new Set<string>()
    logs.forEach((log) => {
      if (log.model) modelSet.add(log.model)
    })
    return Array.from(modelSet).sort()
  }, [logs])

  const handleApplyFilters = () => {
    applyFilters({
      model: modelFilter === "all" ? undefined : modelFilter,
      startDate: startDate || undefined,
      hasError:
        hasErrorFilter === "all" ? undefined : hasErrorFilter === "true",
      searchQuery: searchQuery || undefined,
    })
  }

  const handleResetFilters = () => {
    setModelFilter("all")
    setStartDate("")
    setHasErrorFilter("all")
    setSearchQuery("")
    applyFilters({})
  }

  const handleCopy = async (text: string, logId: string) => {
    await copyToClipboard(text)
    setCopiedId(logId)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  }

  const formatLatency = (ms: number) => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
    return `${(ms / 60000).toFixed(2)}min`
  }

  // Define columns for DataTable
  const columns: ColumnDef<LLMLogEntry>[] = useMemo(
    () => [
      {
        accessorKey: "id",
        header: t("table.id"),
        cell: ({ row }) => (
          <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
            {row.original.id.substring(0, 8)}
          </span>
        ),
      },
      {
        accessorKey: "model",
        header: t("table.model"),
        cell: ({ row }) => (
          <div className="text-sm text-gray-900 dark:text-white font-medium">
            {row.original.model}
            {row.original.provider && (
              <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                ({row.original.provider})
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "agent_id",
        header: t("table.agent"),
        cell: ({ row }) => (
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {row.original.agent_id}
          </span>
        ),
      },
      {
        accessorKey: "latency_ms",
        header: t("table.latency"),
        cell: ({ row }) => (
          <Badge variant="secondary" appearance="light" size="sm">
            {formatLatency(row.original.latency_ms)}
          </Badge>
        ),
      },
      {
        id: "tokens",
        header: t("table.tokens"),
        cell: ({ row }) => (
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {row.original.usage?.total_tokens || "-"}
          </span>
        ),
      },
      {
        id: "status",
        header: t("table.status"),
        cell: ({ row }) => {
          const hasError = !!row.original.error
          return (
            <div className="flex items-center gap-1">
              {hasError ? (
                <Badge variant="destructive" appearance="light" size="sm">
                  {t("table.error")}
                </Badge>
              ) : (
                <Badge variant="success" appearance="light" size="sm">
                  {t("table.success")}
                </Badge>
              )}
              {row.original.has_tool_calls && (
                <Badge variant="info" appearance="light" size="sm">
                  {t("table.hasToolCalls")}
                </Badge>
              )}
            </div>
          )
        },
      },
      {
        accessorKey: "timestamp",
        header: t("table.time"),
        cell: ({ row }) => (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {formatTimestamp(row.original.timestamp)}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <div className="text-center">{t("table.actions")}</div>,
        cell: ({ row }) => (
          <div className="text-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                setSelectedLog(row.original)
              }}
            >
              <Eye className="w-4 h-4" />
            </Button>
          </div>
        ),
      },
    ],
    [t]
  )

  return (
    <div className="h-full p-6 bg-gray-50 dark:bg-zinc-950 overflow-auto">
      <Card variant="default" className="h-full flex flex-col">
        <CardHeader>
          <CardHeading>
            <CardTitle>{t("header.title")}</CardTitle>
            <CardDescription>{t("header.subtitle")}</CardDescription>
          </CardHeading>
          <CardToolbar>
            <Button
              onClick={() => setFiltersExpanded(!filtersExpanded)}
              variant={filtersExpanded ? "secondary" : "outline"}
              size="sm"
            >
              <Filter className="w-4 h-4 mr-1" />
              {filtersExpanded ? t("filters.hide") : t("filters.show")}
            </Button>
            <Button
              onClick={refreshLogs}
              disabled={logsLoading}
              variant="outline"
              size="sm"
            >
              <RefreshCw
                className={`w-4 h-4 mr-1 ${logsLoading ? "animate-spin" : ""}`}
              />
              {t("header.refresh")}
            </Button>
          </CardToolbar>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto space-y-4">
          {/* Stats Cards */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
              <Card className="border-gray-200 dark:border-gray-700">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Hash className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">
                      {t("stats.totalCalls")}
                    </span>
                  </div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    {stats.total_calls}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-gray-200 dark:border-gray-700">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">
                      {t("stats.totalTokens")}
                    </span>
                  </div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    {stats.total_tokens.toLocaleString()}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-gray-200 dark:border-gray-700">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <MessageSquare className="w-3.5 h-3.5 text-green-500" />
                    <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">
                      {t("stats.promptTokens")}
                    </span>
                  </div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    {stats.total_prompt_tokens.toLocaleString()}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-gray-200 dark:border-gray-700">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <MessageSquare className="w-3.5 h-3.5 text-purple-500" />
                    <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">
                      {t("stats.completionTokens")}
                    </span>
                  </div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    {stats.total_completion_tokens.toLocaleString()}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-gray-200 dark:border-gray-700">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="w-3.5 h-3.5 text-orange-500" />
                    <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">
                      {t("stats.avgLatency")}
                    </span>
                  </div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    {formatLatency(stats.average_latency_ms)}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-gray-200 dark:border-gray-700">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">
                      {t("stats.errors")}
                    </span>
                  </div>
                  <div className="text-lg font-semibold text-red-600 dark:text-red-400">
                    {stats.error_count}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-gray-200 dark:border-gray-700">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Cpu className="w-3.5 h-3.5 text-indigo-500" />
                    <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">
                      {t("stats.models")}
                    </span>
                  </div>
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">
                    {Object.keys(stats.models || {}).length}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Filters */}
          <Card className="mb-6 border-gray-200 dark:border-gray-700">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <Filter className="w-4 h-4" />
                  {filtersExpanded
                    ? t("filters.expanded")
                    : t("filters.expandHint")}
                </div>
                <Button
                  onClick={() => setFiltersExpanded((prev) => !prev)}
                  variant="ghost"
                  size="sm"
                >
                  {filtersExpanded ? t("filters.hide") : t("filters.show")}
                  {filtersExpanded ? (
                    <ChevronUp className="w-4 h-4 ml-1" />
                  ) : (
                    <ChevronDown className="w-4 h-4 ml-1" />
                  )}
                </Button>
              </div>

              {filtersExpanded && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1.5">
                        {t("filters.search")}
                      </label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder={t("filters.searchPlaceholder")}
                          variant="lg"
                          className="pl-9"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1.5">
                        {t("filters.model")}
                      </label>
                      <Select
                        value={modelFilter}
                        onValueChange={setModelFilter}
                      >
                        <SelectTrigger size="lg">
                          <Cpu className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
                          <SelectValue placeholder={t("filters.allModels")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">
                            {t("filters.allModels")}
                          </SelectItem>
                          {availableModels.map((model) => (
                            <SelectItem key={model} value={model}>
                              {model}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1.5">
                        {t("filters.startDate")}
                      </label>
                      <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                          type="text"
                          lang="en"
                          placeholder="YYYY-MM-DD"
                          onFocus={(e) => {
                            e.target.type = "date"
                            e.target.showPicker?.()
                          }}
                          onBlur={(e) => {
                            if (!e.target.value) {
                              e.target.type = "text"
                            }
                          }}
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          variant="lg"
                          className="pl-9"
                          title={t("filters.startDateTitle")}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1.5">
                        {t("filters.errorFilter")}
                      </label>
                      <Select
                        value={hasErrorFilter}
                        onValueChange={setHasErrorFilter}
                      >
                        <SelectTrigger size="lg">
                          <AlertCircle className="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" />
                          <SelectValue placeholder={t("filters.all")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">
                            {t("filters.all")}
                          </SelectItem>
                          <SelectItem value="true">
                            {t("filters.errorsOnly")}
                          </SelectItem>
                          <SelectItem value="false">
                            {t("filters.successOnly")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {Object.keys(filters).length > 0 || searchQuery
                        ? t("filters.applied")
                        : t("filters.notApplied")}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={handleApplyFilters}
                        variant="primary"
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        {t("actions.applyFilters")}
                      </Button>
                      <Button
                        onClick={handleResetFilters}
                        variant="outline"
                        size="sm"
                      >
                        {t("actions.resetFilters")}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Error Message */}
          {logsError && (
            <Card className="mb-4 border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10">
              <CardContent className="p-3 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-600 dark:text-red-400">
                  {logsError}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Logs Table */}
          <DataTable
            columns={columns}
            data={logs}
            loading={logsLoading}
            searchable={false}
            pagination={true}
            pageSize={20}
            emptyMessage={t("list.noLogs")}
            emptyIcon={<MessageSquare className="w-12 h-12 text-gray-400" />}
            onRowClick={(row) => setSelectedLog(row)}
            toolbar={
              <Button
                onClick={() => refreshLogs()}
                disabled={logsLoading}
                variant="outline"
                size="sm"
              >
                <RefreshCw
                  className={`w-4 h-4 mr-1.5 ${
                    logsLoading ? "animate-spin" : ""
                  }`}
                />
                {t("actions.refresh")}
              </Button>
            }
          />
        </CardContent>
      </Card>

      {/* Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t("detail.title")}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedLog(null)}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Basic Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    ID
                  </div>
                  <div className="font-mono text-gray-900 dark:text-white">
                    {selectedLog.id.substring(0, 12)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t("table.model")}
                  </div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    {selectedLog.model}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t("table.agent")}
                  </div>
                  <div className="text-gray-900 dark:text-white">
                    {selectedLog.agent_id}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t("table.latency")}
                  </div>
                  <div className="text-gray-900 dark:text-white">
                    {formatLatency(selectedLog.latency_ms)}
                  </div>
                </div>
              </div>

              {/* Error */}
              {selectedLog.error && (
                <div className="rounded-lg border border-red-300 dark:border-red-500/60 bg-red-50 dark:bg-red-950/40 px-4 py-3">
                  <div className="text-sm font-semibold text-red-800 dark:text-red-200 mb-1">
                    {t("card.errorDisplay")}
                  </div>
                  <div className="text-sm text-red-700 dark:text-red-300 font-mono">
                    {selectedLog.error}
                  </div>
                </div>
              )}

              {/* Usage Stats */}
              {selectedLog.usage && (
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t("stats.promptTokens")}
                    </div>
                    <div className="font-semibold text-gray-900 dark:text-white">
                      {selectedLog.usage.prompt_tokens || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t("stats.completionTokens")}
                    </div>
                    <div className="font-semibold text-gray-900 dark:text-white">
                      {selectedLog.usage.completion_tokens || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t("stats.totalTokens")}
                    </div>
                    <div className="font-semibold text-gray-900 dark:text-white">
                      {selectedLog.usage.total_tokens || 0}
                    </div>
                  </div>
                </div>
              )}

              {/* Messages */}
              {selectedLog.messages && selectedLog.messages.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    {t("card.messageHistory")}
                  </div>
                  {selectedLog.messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-800/50"
                    >
                      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                        {msg.role}
                      </div>
                      <div className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Tool Calls */}
              {selectedLog.tool_calls && selectedLog.tool_calls.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    {t("card.toolCallsTitle")}
                  </div>
                  {selectedLog.tool_calls.map((toolCall: any, idx: number) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-blue-200 dark:border-blue-700 p-3 bg-blue-50 dark:bg-blue-900/20"
                    >
                      <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">
                        {toolCall.name} (ID: {toolCall.id})
                      </div>
                      <div className="text-xs text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap">
                        {typeof toolCall.arguments === "string"
                          ? toolCall.arguments
                          : JSON.stringify(toolCall.arguments, null, 2)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Prompt */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    {t("card.prompt")}
                  </div>
                  <Button
                    onClick={() =>
                      handleCopy(selectedLog.prompt, `${selectedLog.id}_prompt`)
                    }
                    variant="ghost"
                    size="sm"
                  >
                    {copiedId === `${selectedLog.id}_prompt` ? (
                      <>
                        <Check className="w-3.5 h-3.5 mr-1" />
                        {t("actions.copied")}
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 mr-1" />
                        {t("actions.copy")}
                      </>
                    )}
                  </Button>
                </div>
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <SyntaxHighlighter
                    language="text"
                    style={theme === "dark" ? oneDark : oneLight}
                    customStyle={{
                      margin: 0,
                      padding: "1rem",
                      fontSize: "0.875rem",
                    }}
                    wrapLongLines={true}
                  >
                    {selectedLog.prompt}
                  </SyntaxHighlighter>
                </div>
              </div>

              {/* Completion */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    {t("card.completion")}
                  </div>
                  <Button
                    onClick={() =>
                      handleCopy(
                        selectedLog.completion,
                        `${selectedLog.id}_completion`
                      )
                    }
                    variant="ghost"
                    size="sm"
                  >
                    {copiedId === `${selectedLog.id}_completion` ? (
                      <>
                        <Check className="w-3.5 h-3.5 mr-1" />
                        {t("actions.copied")}
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 mr-1" />
                        {t("actions.copy")}
                      </>
                    )}
                  </Button>
                </div>
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <SyntaxHighlighter
                    language="text"
                    style={theme === "dark" ? oneDark : oneLight}
                    customStyle={{
                      margin: 0,
                      padding: "1rem",
                      fontSize: "0.875rem",
                    }}
                    wrapLongLines={true}
                  >
                    {selectedLog.completion}
                  </SyntaxHighlighter>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <Button variant="outline" onClick={() => setSelectedLog(null)}>
                {t("detail.close")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default LLMLogsView
