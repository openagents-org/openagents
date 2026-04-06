import React, { useState, useEffect, useMemo, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { ColumnDef } from "@tanstack/react-table"
import {
  eventLogService,
  EventLogEntry,
  HttpRequestLogEntry,
} from "@/services/eventLogService"
import { Button } from "@/components/layout/ui/button"
import { DataTable } from "@/components/layout/ui/data-table"
import { Badge } from "@/components/layout/ui/badge"
import {
  X,
  FileText,
  ArrowLeftRight,
  Send,
  ArrowDownToLine,
  Trash2,
  Activity,
  RefreshCw,
  Eye,
} from "lucide-react"

type LogEntry = EventLogEntry | HttpRequestLogEntry

type TabType = "events" | "http"

const EventLogs: React.FC = () => {
  const { t } = useTranslation("admin")
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [activeTab, setActiveTab] = useState<TabType>("events")
  const [refreshing, setRefreshing] = useState(false)
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null)

  // Filter logs by active tab
  const filteredLogs = useMemo(() => {
    if (activeTab === "events") {
      return logs.filter(
        (log) => !("type" in log) || log.type !== "http_request"
      )
    } else {
      return logs.filter((log) => {
        if ("type" in log && log.type === "http_request") {
          const httpLog = log as HttpRequestLogEntry
          return !httpLog.endpoint.includes("/api/poll")
        }
        return false
      })
    }
  }, [logs, activeTab])

  // Load logs
  const loadLogs = useCallback(() => {
    const allLogs = eventLogService.getAllLogs()
    setLogs(allLogs)
  }, [])

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    loadLogs()
    setTimeout(() => setRefreshing(false), 300)
  }, [loadLogs])

  useEffect(() => {
    loadLogs()
    const unsubscribe = eventLogService.subscribe((updatedLogs) => {
      setLogs(updatedLogs)
    })
    return () => {
      unsubscribe()
    }
  }, [loadLogs])

  // Clear logs
  const handleClearLogs = () => {
    if (window.confirm(t("eventLogs.clearConfirm"))) {
      eventLogService.clearLogs()
      setSelectedLog(null)
    }
  }

  // Format time
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  }

  // Format JSON
  const formatJSON = (obj: any) => {
    try {
      return JSON.stringify(obj, null, 2)
    } catch {
      return String(obj)
    }
  }

  // Get event counts
  const eventCount = logs.filter(
    (log) => !("type" in log) || log.type !== "http_request"
  ).length
  const httpCount = logs.filter(
    (log) => "type" in log && log.type === "http_request"
  ).length

  // Event columns
  const eventColumns: ColumnDef<EventLogEntry>[] = useMemo(
    () => [
      {
        accessorKey: "direction",
        header: t("eventLogs.columns.direction"),
        cell: ({ row }) => {
          const isSent = row.original.direction === "sent"
          return (
            <span
              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                isSent
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
              }`}
            >
              {isSent ? (
                <Send className="w-3 h-3 mr-1" />
              ) : (
                <ArrowDownToLine className="w-3 h-3 mr-1" />
              )}
              {isSent
                ? t("eventLogs.columns.sent")
                : t("eventLogs.columns.received")}
            </span>
          )
        },
      },
      {
        accessorKey: "event.event_name",
        header: t("eventLogs.columns.eventName"),
        cell: ({ row }) => (
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {row.original.event.event_name}
          </span>
        ),
      },
      {
        accessorKey: "event.source_id",
        header: t("eventLogs.columns.source"),
        cell: ({ row }) => (
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {row.original.event.source_id || "-"}
          </span>
        ),
      },
      {
        accessorKey: "event.destination_id",
        header: t("eventLogs.columns.destination"),
        cell: ({ row }) => (
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {row.original.event.destination_id || "-"}
          </span>
        ),
      },
      {
        accessorKey: "timestamp",
        header: t("eventLogs.columns.time"),
        cell: ({ row }) => (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {formatTime(row.original.timestamp)}
          </span>
        ),
      },
      {
        id: "status",
        header: t("eventLogs.columns.status"),
        cell: ({ row }) => {
          const entry = row.original
          if (entry.direction === "received") {
            return (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                -
              </span>
            )
          }
          const isSuccess = entry.response?.success
          return (
            <span
              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                isSuccess
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                  isSuccess ? "bg-green-500" : "bg-red-500"
                }`}
              />
              {isSuccess
                ? t("eventLogs.columns.success")
                : t("eventLogs.columns.failed")}
            </span>
          )
        },
      },
      {
        id: "actions",
        header: () => (
          <div className="text-center">{t("eventLogs.columns.actions")}</div>
        ),
        cell: ({ row }) => (
          <div className="text-center">
            <Button
              variant="ghost"
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

  // HTTP columns
  const httpColumns: ColumnDef<HttpRequestLogEntry>[] = useMemo(
    () => [
      {
        accessorKey: "method",
        header: t("eventLogs.columns.method"),
        cell: ({ row }) => (
          <span className="px-2 py-1 text-xs font-mono font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded">
            {row.original.method}
          </span>
        ),
      },
      {
        accessorKey: "endpoint",
        header: t("eventLogs.columns.endpoint"),
        cell: ({ row }) => (
          <span className="font-medium text-gray-900 dark:text-gray-100 truncate max-w-[200px] block">
            {row.original.endpoint}
          </span>
        ),
      },
      {
        accessorKey: "responseStatus",
        header: t("eventLogs.columns.statusCode"),
        cell: ({ row }) => {
          const status = row.original.responseStatus
          const isSuccess = status && status >= 200 && status < 300
          if (!status) {
            return (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                -
              </span>
            )
          }
          return (
            <span
              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                isSuccess
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              }`}
            >
              {status}
            </span>
          )
        },
      },
      {
        accessorKey: "host",
        header: t("eventLogs.columns.host"),
        cell: ({ row }) => (
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {row.original.host}:{row.original.port}
          </span>
        ),
      },
      {
        accessorKey: "duration",
        header: t("eventLogs.columns.duration"),
        cell: ({ row }) => (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {row.original.duration !== undefined
              ? `${row.original.duration}ms`
              : "-"}
          </span>
        ),
      },
      {
        accessorKey: "timestamp",
        header: t("eventLogs.columns.time"),
        cell: ({ row }) => (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {formatTime(row.original.timestamp)}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => (
          <div className="text-center">{t("eventLogs.columns.actions")}</div>
        ),
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
    <div className="h-full flex flex-col">
      <div className="p-6 flex-1 overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {t("eventLogs.title")}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {t("eventLogs.subtitle")}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleRefresh}
              disabled={refreshing}
              variant="outline"
              size="sm"
            >
              <RefreshCw
                className={`w-4 h-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`}
              />
              {refreshing ? t("eventLogs.refreshing") : t("eventLogs.refresh")}
            </Button>
            <Button
              onClick={handleClearLogs}
              variant="destructive"
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <Trash2 className="w-4 h-4 mr-1.5" />
              {t("eventLogs.clearLogs")}
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("events")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === "events"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              <Activity className="w-4 h-4" />
              {t("eventLogs.tabs.events")}
              <Badge
                variant="secondary"
                appearance="light"
                size="sm"
                className="ml-1"
              >
                {eventCount}
              </Badge>
            </button>
            <button
              onClick={() => setActiveTab("http")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === "http"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              <ArrowLeftRight className="w-4 h-4" />
              {t("eventLogs.tabs.httpRequests")}
              <Badge
                variant="secondary"
                appearance="light"
                size="sm"
                className="ml-1"
              >
                {httpCount}
              </Badge>
            </button>
          </div>
        </div>

        {/* Data Table */}
        {activeTab === "events" ? (
          <DataTable
            columns={eventColumns}
            data={filteredLogs as EventLogEntry[]}
            searchable={true}
            searchPlaceholder={t("eventLogs.searchPlaceholder")}
            searchColumn="event.event_name"
            pagination={true}
            pageSize={20}
            emptyMessage={t("eventLogs.empty")}
            emptyIcon={<FileText className="w-12 h-12 text-gray-400" />}
            onRowClick={(row) => setSelectedLog(row)}
          />
        ) : (
          <DataTable
            columns={httpColumns}
            data={filteredLogs as HttpRequestLogEntry[]}
            searchable={true}
            searchPlaceholder={t("eventLogs.searchPlaceholder")}
            searchColumn="endpoint"
            pagination={true}
            pageSize={20}
            emptyMessage={t("eventLogs.empty")}
            emptyIcon={<ArrowLeftRight className="w-12 h-12 text-gray-400" />}
            onRowClick={(row) => setSelectedLog(row)}
          />
        )}
      </div>

      {/* Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {"type" in selectedLog && selectedLog.type === "http_request"
                  ? t("eventLogs.httpDetail")
                  : t("eventLogs.eventDetail")}
              </h2>
              <Button
                onClick={() => setSelectedLog(null)}
                variant="ghost"
                size="sm"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            <div className="p-4 overflow-auto flex-1">
              {"type" in selectedLog && selectedLog.type === "http_request" ? (
                // HTTP Request Detail
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        {t("eventLogs.columns.method")}
                      </span>
                      <p className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">
                        {(selectedLog as HttpRequestLogEntry).method}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        {t("eventLogs.columns.statusCode")}
                      </span>
                      <p className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">
                        {(selectedLog as HttpRequestLogEntry).responseStatus ||
                          "-"}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        {t("eventLogs.columns.host")}
                      </span>
                      <p className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">
                        {(selectedLog as HttpRequestLogEntry).host}:
                        {(selectedLog as HttpRequestLogEntry).port}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        {t("eventLogs.columns.duration")}
                      </span>
                      <p className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">
                        {(selectedLog as HttpRequestLogEntry).duration !==
                        undefined
                          ? `${(selectedLog as HttpRequestLogEntry).duration}ms`
                          : "-"}
                      </p>
                    </div>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      URL
                    </span>
                    <p className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100 break-all">
                      {(selectedLog as HttpRequestLogEntry).url}
                    </p>
                  </div>
                  {(selectedLog as HttpRequestLogEntry).requestBody && (
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        Request Body
                      </span>
                      <pre className="mt-1 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg text-xs font-mono text-gray-800 dark:text-gray-200 overflow-auto max-h-48">
                        {formatJSON(
                          (selectedLog as HttpRequestLogEntry).requestBody
                        )}
                      </pre>
                    </div>
                  )}
                  {(selectedLog as HttpRequestLogEntry).responseBody && (
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        Response Body
                      </span>
                      <pre className="mt-1 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg text-xs font-mono text-gray-800 dark:text-gray-200 overflow-auto max-h-48">
                        {formatJSON(
                          (selectedLog as HttpRequestLogEntry).responseBody
                        )}
                      </pre>
                    </div>
                  )}
                  {(selectedLog as HttpRequestLogEntry).error && (
                    <div>
                      <span className="text-xs font-medium text-red-500 uppercase">
                        Error
                      </span>
                      <p className="mt-1 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-sm text-red-800 dark:text-red-200 font-mono">
                        {(selectedLog as HttpRequestLogEntry).error}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                // Event Detail
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        {t("eventLogs.columns.eventName")}
                      </span>
                      <p className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">
                        {(selectedLog as EventLogEntry).event.event_name}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        {t("eventLogs.columns.direction")}
                      </span>
                      <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                        {(selectedLog as EventLogEntry).direction === "sent"
                          ? t("eventLogs.columns.sent")
                          : t("eventLogs.columns.received")}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        {t("eventLogs.columns.source")}
                      </span>
                      <p className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">
                        {(selectedLog as EventLogEntry).event.source_id || "-"}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        {t("eventLogs.columns.destination")}
                      </span>
                      <p className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">
                        {(selectedLog as EventLogEntry).event.destination_id ||
                          "-"}
                      </p>
                    </div>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Event Data
                    </span>
                    <pre className="mt-1 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg text-xs font-mono text-gray-800 dark:text-gray-200 overflow-auto max-h-48">
                      {formatJSON((selectedLog as EventLogEntry).event)}
                    </pre>
                  </div>
                  {(selectedLog as EventLogEntry).response && (
                    <div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                        {t("eventLogs.response")}
                      </span>
                      <div className="mt-1">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium mb-2 ${
                            (selectedLog as EventLogEntry).response?.success
                              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                              : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                          }`}
                        >
                          {(selectedLog as EventLogEntry).response?.success
                            ? t("eventLogs.columns.success")
                            : t("eventLogs.columns.failed")}
                        </span>
                        <pre className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg text-xs font-mono text-gray-800 dark:text-gray-200 overflow-auto max-h-48">
                          {formatJSON((selectedLog as EventLogEntry).response)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <Button onClick={() => setSelectedLog(null)} variant="outline">
                {t("eventLogs.close")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default EventLogs
