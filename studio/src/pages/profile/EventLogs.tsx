import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { eventLogService, EventLogEntry, HttpRequestLogEntry } from "@/services/eventLogService";
import { Button } from "@/components/layout/ui/button";
import { Input } from "@/components/layout/ui/input";
import { Card, CardContent } from "@/components/layout/ui/card";
import { ScrollArea } from "@/components/layout/ui/scroll-area";
import { Badge } from "@/components/layout/ui/badge";
import {
  X,
  FileText,
  ArrowLeftRight,
  ChevronDown,
  Send,
  Circle,
  Trash2,
  Activity,
  Layers,
  RefreshCw
} from "lucide-react";

type LogEntry = EventLogEntry | HttpRequestLogEntry;

const ITEMS_PER_PAGE = 20;

type TabType = "events" | "http";
type FilterMode = "include" | "exclude";

const EventLogs: React.FC = () => {
  const { t } = useTranslation('admin');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("events");
  const [searchKeyword, setSearchKeyword] = useState<string>("");
  const [filterMode, setFilterMode] = useState<FilterMode>("include");
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  // Check if log matches search keyword
  const matchesKeyword = useCallback((log: LogEntry, keyword: string): boolean => {
    if (!keyword.trim()) return true;

    const lowerKeyword = keyword.toLowerCase();

    // Check HTTP request logs
    if ("type" in log && log.type === "http_request") {
      const httpLog = log as HttpRequestLogEntry;
      const searchableText = [
        httpLog.method,
        httpLog.url,
        httpLog.endpoint,
        httpLog.host,
        String(httpLog.port),
        httpLog.error,
        JSON.stringify(httpLog.requestBody),
        JSON.stringify(httpLog.responseBody),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchableText.includes(lowerKeyword);
    }

    // Check event logs
    const eventLog = log as EventLogEntry;
    const searchableText = [
      eventLog.event.event_name,
      eventLog.event.source_id,
      eventLog.event.destination_id,
      JSON.stringify(eventLog.event.payload),
      JSON.stringify(eventLog.event),
      JSON.stringify(eventLog.response),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchableText.includes(lowerKeyword);
  }, []);

  // Filter logs by active tab and search keyword
  const filteredLogs = useMemo(() => {
    let result = logs;

    // Filter by tab type
    if (activeTab === "events") {
      result = result.filter((log) => !("type" in log) || log.type !== "http_request");
    } else {
      // For HTTP requests tab, exclude api/poll endpoint
      result = result.filter((log) => {
        if ("type" in log && log.type === "http_request") {
          const httpLog = log as HttpRequestLogEntry;
          // Exclude api/poll endpoint
          return !httpLog.endpoint.includes("/api/poll");
        }
        return false;
      });
    }

    // Filter by search keyword
    if (searchKeyword.trim()) {
      if (filterMode === "include") {
        result = result.filter((log) => matchesKeyword(log, searchKeyword));
      } else {
        result = result.filter((log) => !matchesKeyword(log, searchKeyword));
      }
    }

    return result;
  }, [logs, activeTab, searchKeyword, filterMode, matchesKeyword]);

  // Get paginated data for filtered logs
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    return {
      logs: filteredLogs.slice(start, end),
      total: filteredLogs.length,
      totalPages: Math.ceil(filteredLogs.length / ITEMS_PER_PAGE),
    };
  }, [filteredLogs, currentPage]);

  // Reset page when tab or filter mode changes
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, filterMode]);

  // Load logs
  const loadLogs = useCallback(() => {
    const allLogs = eventLogService.getAllLogs();
    setLogs(allLogs);
  }, []);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    loadLogs();
    setTimeout(() => setRefreshing(false), 300);
  }, [loadLogs]);

  useEffect(() => {
    // Initial load
    loadLogs();

    // Subscribe to updates
    const unsubscribe = eventLogService.subscribe((updatedLogs) => {
      setLogs(updatedLogs);
    });

    return () => {
      unsubscribe();
    };
  }, [loadLogs]);

  // Toggle expand/collapse
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Clear logs
  const handleClearLogs = () => {
    if (window.confirm(t('eventLogs.clearConfirm'))) {
      eventLogService.clearLogs();
      setCurrentPage(1);
      setExpandedIds(new Set());
    }
  };

  // Format time
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  // Format JSON
  const formatJSON = (obj: any) => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  // Get event counts
  const eventCount = logs.filter((log) => !("type" in log) || log.type !== "http_request").length;
  const httpCount = logs.filter((log) => "type" in log && log.type === "http_request").length;

  return (
    <ScrollArea className="h-full">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {t('eventLogs.title')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {t('eventLogs.subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleRefresh}
              disabled={refreshing}
              variant="outline"
              size="sm"
            >
              <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? t('eventLogs.refreshing') : t('eventLogs.refresh')}
            </Button>
            <Button
              onClick={handleClearLogs}
              variant="destructive"
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <Trash2 className="w-4 h-4 mr-1.5" />
              {t('eventLogs.clearLogs')}
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
              {t('eventLogs.tabs.events')}
              <Badge variant={activeTab === "events" ? "secondary" : "secondary"} appearance="light" size="sm" className="ml-1">
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
              {t('eventLogs.tabs.httpRequests')}
              <Badge variant={activeTab === "http" ? "secondary" : "secondary"} appearance="light" size="sm" className="ml-1">
                {httpCount}
              </Badge>
            </button>
          </div>
        </div>

        {/* Search & Filter */}
        <Card className="mb-6 border-gray-200 dark:border-gray-700">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              {/* Search Input */}
              <div className="flex-1 relative">
                <Input
                  type="text"
                  value={searchKeyword}
                  onChange={(e) => {
                    setSearchKeyword(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder={t('eventLogs.searchPlaceholder')}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10"
                />
                {searchKeyword && (
                  <button
                    onClick={() => {
                      setSearchKeyword("");
                      setCurrentPage(1);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Filter Mode Toggle */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {t('eventLogs.filter')}
                </span>
                <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => setFilterMode("include")}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      filterMode === "include"
                        ? "bg-blue-600 text-white"
                        : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                  >
                    {t('eventLogs.include')}
                  </button>
                  <button
                    onClick={() => setFilterMode("exclude")}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-200 dark:border-gray-700 ${
                      filterMode === "exclude"
                        ? "bg-blue-600 text-white"
                        : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                  >
                    {t('eventLogs.exclude')}
                  </button>
                </div>
              </div>
            </div>

            {/* Search Result Info */}
            {searchKeyword && (
              <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                {filteredLogs.length} {filteredLogs.length === 1 ? "result" : "results"} for "
                <span className="font-medium text-gray-700 dark:text-gray-300">{searchKeyword}</span>"
                ({filterMode === "include" ? t('eventLogs.include') : t('eventLogs.exclude')})
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 gap-4">
          <Card className="border-gray-200 dark:border-gray-700">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t('eventLogs.totalEvents')}
                  </div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    {filteredLogs.length}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-gray-200 dark:border-gray-700">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t('eventLogs.currentPage')}
                  </div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    {paginatedData.totalPages > 0 ? currentPage : 0} / {paginatedData.totalPages}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Event List */}
        <div className="space-y-2">
          {paginatedData.logs.length === 0 ? (
            <Card className="border-gray-200 dark:border-gray-700">
              <CardContent className="p-12">
                <div className="text-center">
                  <FileText className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t('eventLogs.empty')}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            paginatedData.logs.map((entry) => {
              const isExpanded = expandedIds.has(entry.id);

              // Check if this is an HTTP request log or event log
              if ('type' in entry && entry.type === 'http_request') {
                const httpEntry = entry as HttpRequestLogEntry;
                const isSuccess = httpEntry.responseStatus && httpEntry.responseStatus >= 200 && httpEntry.responseStatus < 300;

                return (
                  <Card
                    key={entry.id}
                    className="border-gray-200 dark:border-gray-700 overflow-hidden"
                  >
                    <CardContent className="p-0">
                      {/* HTTP Request Header */}
                      <button
                        onClick={() => toggleExpand(entry.id)}
                        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {/* HTTP Icon */}
                          <div className={`p-1.5 rounded-lg ${
                            isSuccess
                              ? "bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                              : httpEntry.error
                                ? "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                                : "bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400"
                          }`}>
                            <ArrowLeftRight className="w-4 h-4" />
                          </div>

                          {/* HTTP Request Info */}
                          <div className="flex-1 min-w-0 text-left">
                            <div className="flex items-center gap-2">
                              <span className="px-1.5 py-0.5 text-xs font-mono font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded">
                                {httpEntry.method}
                              </span>
                              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                {httpEntry.endpoint}
                              </span>
                              {httpEntry.responseStatus && (
                                <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${
                                  isSuccess
                                    ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                    : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                                }`}>
                                  {httpEntry.responseStatus}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {formatTime(httpEntry.timestamp)}
                              {httpEntry.host && (
                                <span className="mx-1.5">•</span>
                              )}
                              {httpEntry.host && (
                                <span>{httpEntry.host}:{httpEntry.port}</span>
                              )}
                              {httpEntry.duration !== undefined && (
                                <>
                                  <span className="mx-1.5">•</span>
                                  <span>{httpEntry.duration}ms</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Expand Icon */}
                        <ChevronDown
                          className={`w-5 h-5 text-gray-400 flex-shrink-0 ml-2 transition-transform ${
                            isExpanded ? "transform rotate-180" : ""
                          }`}
                        />
                      </button>

                      {/* HTTP Request Details */}
                      {isExpanded && (
                        <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700/50">
                          <div className="pt-4 space-y-4">
                            {/* Request Info */}
                            <div>
                              <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wide">
                                Request
                              </h4>
                              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 overflow-x-auto">
                                <div className="space-y-1 text-xs">
                                  <div><span className="font-medium text-gray-500">URL:</span> <span className="font-mono text-gray-800 dark:text-gray-200">{httpEntry.url}</span></div>
                                  <div><span className="font-medium text-gray-500">Method:</span> <span className="font-mono text-gray-800 dark:text-gray-200">{httpEntry.method}</span></div>
                                  <div><span className="font-medium text-gray-500">Host:</span> <span className="font-mono text-gray-800 dark:text-gray-200">{httpEntry.host}:{httpEntry.port}</span></div>
                                  <div><span className="font-medium text-gray-500">Endpoint:</span> <span className="font-mono text-gray-800 dark:text-gray-200">{httpEntry.endpoint}</span></div>
                                </div>
                              </div>
                            </div>

                            {/* Request Body */}
                            {httpEntry.requestBody && (
                              <div>
                                <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wide">
                                  Request Body
                                </h4>
                                <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 overflow-x-auto">
                                  <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words font-mono">
                                    {formatJSON(httpEntry.requestBody)}
                                  </pre>
                                </div>
                              </div>
                            )}

                            {/* Response */}
                            {httpEntry.responseStatus !== undefined && (
                              <div>
                                <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wide">
                                  {t('eventLogs.response')}
                                </h4>
                                <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 overflow-x-auto">
                                  <div className="mb-2 flex items-center gap-2">
                                    <span
                                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                        isSuccess
                                          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                                          : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                                      }`}
                                    >
                                      {httpEntry.responseStatus} {isSuccess ? "OK" : "Error"}
                                    </span>
                                    {httpEntry.duration !== undefined && (
                                      <span className="text-xs text-gray-500 dark:text-gray-400">
                                        {httpEntry.duration}ms
                                      </span>
                                    )}
                                  </div>
                                  {httpEntry.responseBody && (
                                    <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words font-mono">
                                      {formatJSON(httpEntry.responseBody)}
                                    </pre>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Error */}
                            {httpEntry.error && (
                              <div>
                                <h4 className="text-xs font-semibold text-red-700 dark:text-red-300 mb-2 uppercase tracking-wide">
                                  Error
                                </h4>
                                <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 border border-red-200 dark:border-red-800">
                                  <p className="text-xs text-red-800 dark:text-red-200 font-mono">
                                    {httpEntry.error}
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              }

              // Event log entry
              const eventEntry = entry as EventLogEntry;
              const isSent = eventEntry.direction === "sent";

              return (
                <Card
                  key={entry.id}
                  className="border-gray-200 dark:border-gray-700 overflow-hidden"
                >
                  <CardContent className="p-0">
                    {/* Event Header */}
                    <button
                      onClick={() => toggleExpand(entry.id)}
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {/* Direction Icon */}
                        <div className={`p-1.5 rounded-lg ${
                          isSent
                            ? "bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                            : "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                        }`}>
                          {isSent ? (
                            <Send className="w-4 h-4" />
                          ) : (
                            <Circle className="w-4 h-4" />
                          )}
                        </div>

                        {/* Event Name */}
                        <div className="flex-1 min-w-0 text-left">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {eventEntry.event.event_name}
                            </span>
                            <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${
                              isSent
                                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
                            }`}>
                              {isSent ? "Sent" : "Received"}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {formatTime(eventEntry.timestamp)}
                            {eventEntry.event.source_id && (
                              <>
                                <span className="mx-1.5">•</span>
                                <span>{t('eventLogs.from')}: {eventEntry.event.source_id}</span>
                              </>
                            )}
                            {eventEntry.event.destination_id && (
                              <>
                                <span className="mx-1.5">•</span>
                                <span>{t('eventLogs.to')}: {eventEntry.event.destination_id}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Expand Icon */}
                      <ChevronDown
                        className={`w-5 h-5 text-gray-400 flex-shrink-0 ml-2 transition-transform ${
                          isExpanded ? "transform rotate-180" : ""
                        }`}
                      />
                    </button>

                    {/* Event Details */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700/50">
                        <div className="pt-4 space-y-4">
                          {/* Event Data */}
                          <div>
                            <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wide">
                              Event Data
                            </h4>
                            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 overflow-x-auto">
                              <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words font-mono">
                                {formatJSON(eventEntry.event)}
                              </pre>
                            </div>
                          </div>

                          {/* Response (for sent events) */}
                          {isSent && eventEntry.response && (
                            <div>
                              <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wide">
                                {t('eventLogs.response')}
                              </h4>
                              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 overflow-x-auto">
                                <div className="mb-2">
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                      eventEntry.response.success
                                        ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                                        : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                                    }`}
                                  >
                                    {eventEntry.response.success ? "Success" : "Failed"}
                                  </span>
                                </div>
                                <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words font-mono">
                                  {formatJSON(eventEntry.response)}
                                </pre>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Pagination */}
        {paginatedData.totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {(currentPage - 1) * ITEMS_PER_PAGE + 1} - {Math.min(currentPage * ITEMS_PER_PAGE, paginatedData.total)} / {paginatedData.total}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                variant="outline"
                size="sm"
              >
                {t('eventLogs.previous')}
              </Button>
              <Button
                onClick={() => setCurrentPage((p) => Math.min(paginatedData.totalPages, p + 1))}
                disabled={currentPage === paginatedData.totalPages}
                variant="outline"
                size="sm"
              >
                {t('eventLogs.next')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
};

export default EventLogs;
