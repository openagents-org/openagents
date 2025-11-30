import React, { useState, useEffect, useMemo, useCallback } from "react";
import { eventLogService, EventLogEntry, HttpRequestLogEntry } from "@/services/eventLogService";

type LogEntry = EventLogEntry | HttpRequestLogEntry;

const ITEMS_PER_PAGE = 20;

type TabType = "events" | "http";
type FilterMode = "include" | "exclude";

const EventLogs: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("events");
  const [searchKeyword, setSearchKeyword] = useState<string>("");
  const [filterMode, setFilterMode] = useState<FilterMode>("include");
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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
  useEffect(() => {
    const loadLogs = () => {
      const allLogs = eventLogService.getAllLogs();
      setLogs(allLogs);
    };

    // Initial load
    loadLogs();

    // Subscribe to updates
    const unsubscribe = eventLogService.subscribe((updatedLogs) => {
      setLogs(updatedLogs);
    });

    return () => {
      unsubscribe();
    };
  }, []);

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
    if (window.confirm("Are you sure you want to clear all event logs?")) {
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

  return (
    <div className="p-6 dark:bg-gray-900 h-full min-h-screen overflow-y-auto">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Event Logs
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            View recent sent or received events
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={handleClearLogs}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
          >
            Clear Logs
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab("events")}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === "events"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
            }`}
          >
            Events
            <span className="ml-2 py-0.5 px-2 text-xs rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
              {logs.filter((log) => !("type" in log) || log.type !== "http_request").length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab("http")}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === "http"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
            }`}
          >
            HTTP Requests
            <span className="ml-2 py-0.5 px-2 text-xs rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
              {logs.filter((log) => "type" in log && log.type === "http_request").length}
            </span>
          </button>
        </nav>
      </div>

      {/* Search Filter */}
      <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-4">
          {/* Search Input */}
          <div className="flex-1">
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => {
                setSearchKeyword(e.target.value);
                setCurrentPage(1); // Reset to first page when search changes
              }}
              placeholder="Search keywords..."
              className="w-full px-4 py-2 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Filter Mode Toggle */}
          <div className="flex items-center gap-2 border-l border-gray-200 dark:border-gray-700 pl-4">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
              Filter:
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFilterMode("include")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filterMode === "include"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}
              >
                Include
              </button>
              <button
                onClick={() => setFilterMode("exclude")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filterMode === "exclude"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}
              >
                Exclude
              </button>
            </div>
          </div>

          {/* Clear Search Button */}
          {searchKeyword && (
            <button
              onClick={() => {
                setSearchKeyword("");
                setCurrentPage(1);
              }}
              className="px-3 py-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              title="Clear search"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Search Result Info */}
        {searchKeyword && (
          <div className="mt-3 text-sm text-gray-600 dark:text-gray-400">
            Showing {filteredLogs.length} {filteredLogs.length === 1 ? "result" : "results"} for "
            <span className="font-medium text-gray-900 dark:text-gray-100">
              {searchKeyword}
            </span>
            " ({filterMode === "include" ? "included" : "excluded"})
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Total {activeTab === "events" ? "Events" : "HTTP Requests"}
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {filteredLogs.length}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">Current Page</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {paginatedData.totalPages > 0 ? currentPage : 0} / {paginatedData.totalPages}
          </div>
        </div>
      </div>

      {/* Event List */}
      <div className="space-y-2">
        {paginatedData.logs.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-left">
            <svg
              className="h-12 w-12 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <p className="mt-4 text-gray-600 dark:text-gray-400">
              No event logs
            </p>
          </div>
        ) : (
          paginatedData.logs.map((entry) => {
            const isExpanded = expandedIds.has(entry.id);
            
            // Check if this is an HTTP request log or event log
            if ('type' in entry && entry.type === 'http_request') {
              const httpEntry = entry as HttpRequestLogEntry;
              const isSuccess = httpEntry.responseStatus && httpEntry.responseStatus >= 200 && httpEntry.responseStatus < 300;
              
              return (
                <div
                  key={entry.id}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
                >
                  {/* HTTP Request Header */}
                  <button
                    onClick={() => toggleExpand(entry.id)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {/* HTTP Icon */}
                      <svg
                        className={`w-5 h-5 flex-shrink-0 ${
                          isSuccess ? "text-green-500" : httpEntry.error ? "text-red-500" : "text-yellow-500"
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                        />
                      </svg>

                      {/* HTTP Request Info */}
                      <div className="flex-1 min-w-0 text-left">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          <span className="font-mono text-xs mr-2">{httpEntry.method}</span>
                          {httpEntry.endpoint}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {formatTime(httpEntry.timestamp)}
                          {httpEntry.host && (
                            <> • {httpEntry.host}:{httpEntry.port}</>
                          )}
                          {httpEntry.responseStatus && (
                            <> • Status: <span className={isSuccess ? "text-green-600" : "text-red-600"}>{httpEntry.responseStatus}</span></>
                          )}
                          {httpEntry.duration !== undefined && (
                            <> • {httpEntry.duration}ms</>
                          )}
                          {httpEntry.error && (
                            <> • <span className="text-red-600">Error</span></>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Expand Icon */}
                    <svg
                      className={`w-5 h-5 text-gray-400 flex-shrink-0 ml-2 transition-transform ${
                        isExpanded ? "transform rotate-180" : ""
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>

                  {/* HTTP Request Details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-200 dark:border-gray-700">
                      <div className="pt-4 space-y-4">
                        {/* Request Info */}
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Request
                          </h4>
                          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 overflow-x-auto">
                            <div className="space-y-1 text-xs">
                              <div><span className="font-medium">URL:</span> <span className="font-mono text-gray-800 dark:text-gray-200">{httpEntry.url}</span></div>
                              <div><span className="font-medium">Method:</span> <span className="font-mono text-gray-800 dark:text-gray-200">{httpEntry.method}</span></div>
                              <div><span className="font-medium">Host:</span> <span className="font-mono text-gray-800 dark:text-gray-200">{httpEntry.host}:{httpEntry.port}</span></div>
                              <div><span className="font-medium">Endpoint:</span> <span className="font-mono text-gray-800 dark:text-gray-200">{httpEntry.endpoint}</span></div>
                            </div>
                          </div>
                        </div>

                        {/* Request Body */}
                        {httpEntry.requestBody && (
                          <div>
                            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                              Request Body
                            </h4>
                            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 overflow-x-auto">
                              <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
                                {formatJSON(httpEntry.requestBody)}
                              </pre>
                            </div>
                          </div>
                        )}

                        {/* Response */}
                        {httpEntry.responseStatus !== undefined && (
                          <div>
                            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                              Response
                            </h4>
                            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 overflow-x-auto">
                              <div className="mb-2">
                                <span
                                  className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                                    isSuccess
                                      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                                      : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                                  }`}
                                >
                                  {httpEntry.responseStatus} {isSuccess ? "Success" : "Error"}
                                </span>
                                {httpEntry.duration !== undefined && (
                                  <span className="ml-2 text-xs text-gray-600 dark:text-gray-400">
                                    {httpEntry.duration}ms
                                  </span>
                                )}
                              </div>
                              {httpEntry.responseBody && (
                                <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
                                  {formatJSON(httpEntry.responseBody)}
                                </pre>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Error */}
                        {httpEntry.error && (
                          <div>
                            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                              Error
                            </h4>
                            <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                              <p className="text-xs text-red-800 dark:text-red-200">
                                {httpEntry.error}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            }
            
            // Event log entry
            const eventEntry = entry as EventLogEntry;
            const isSent = eventEntry.direction === "sent";

            return (
              <div
                key={entry.id}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
              >
                {/* Event Header */}
                <button
                  onClick={() => toggleExpand(entry.id)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {/* Direction Icon */}
                    {isSent ? (
                      <svg
                        className="w-5 h-5 text-green-500 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-5 h-5 text-blue-500 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                        />
                      </svg>
                    )}

                    {/* Event Name */}
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {eventEntry.event.event_name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {formatTime(eventEntry.timestamp)}
                        {eventEntry.event.source_id && (
                          <> • From: {eventEntry.event.source_id}</>
                        )}
                        {eventEntry.event.destination_id && (
                          <> • To: {eventEntry.event.destination_id}</>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expand Icon */}
                  <svg
                    className={`w-5 h-5 text-gray-400 flex-shrink-0 ml-2 transition-transform ${
                      isExpanded ? "transform rotate-180" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>

                {/* Event Details */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="pt-4 space-y-4">
                      {/* Event Data */}
                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          Event Data
                        </h4>
                        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 overflow-x-auto">
                          <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
                            {formatJSON(eventEntry.event)}
                          </pre>
                        </div>
                      </div>

                      {/* Response (for sent events) */}
                      {isSent && eventEntry.response && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            Event Response
                          </h4>
                          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 overflow-x-auto">
                            <div className="mb-2">
                              <span
                                className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                                  eventEntry.response.success
                                    ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                                    : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                                }`}
                              >
                                {eventEntry.response.success ? "Success" : "Failed"}
                              </span>
                            </div>
                            <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
                              {formatJSON(eventEntry.response)}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {paginatedData.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} -{" "}
            {Math.min(currentPage * ITEMS_PER_PAGE, paginatedData.total)} of{" "}
            {paginatedData.total} entries
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() =>
                setCurrentPage((p) => Math.min(paginatedData.totalPages, p + 1))
              }
              disabled={currentPage === paginatedData.totalPages}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default EventLogs;

