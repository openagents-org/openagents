import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  getAgentStatus,
  getAgentLogs,
  type AgentStatus,
  type LogEntry,
} from "@/services/serviceAgentsApi";

/**
 * Service Agent Detail Component
 * Shows detailed agent information and real-time log viewer
 */
const ServiceAgentDetail: React.FC = () => {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logLevelFilter, setLogLevelFilter] = useState<
    "ALL" | "INFO" | "WARN" | "ERROR"
  >("ALL");
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  // Check if user scrolled up manually
  const handleScroll = useCallback(() => {
    if (logsContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10;
      setAutoScroll(isAtBottom);
    }
  }, []);

  // Fetch initial status and logs
  const fetchData = useCallback(async () => {
    if (!agentId) return;

    try {
      setLoading(true);
      setError(null);

      // Fetch status and logs in parallel
      const [statusData, logsData] = await Promise.all([
        getAgentStatus(agentId),
        getAgentLogs(agentId, 100),
      ]);

      setStatus(statusData);
      setLogs(logsData.logs || []);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to fetch agent information";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  // Poll logs for running agents (WebSocket not available, use polling)
  useEffect(() => {
    if (!agentId || !status || status.status !== "running") {
      return;
    }

    // Poll logs every 2 seconds for running agents
    const logInterval = setInterval(async () => {
      try {
        const logsData = await getAgentLogs(agentId, 100);
        setLogs(logsData.logs || []);
      } catch (err) {
        console.error("Failed to fetch logs:", err);
      }
    }, 2000);

    return () => clearInterval(logInterval);
  }, [agentId, status]);

  // Initial load
  useEffect(() => {
    fetchData();
    // Refresh status every 5 seconds
    const interval = setInterval(async () => {
      if (agentId) {
        try {
          const statusData = await getAgentStatus(agentId);
          setStatus(statusData);
        } catch (err) {
          console.error("Failed to refresh status:", err);
        }
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [agentId, fetchData]);

  // Filter logs by level
  const filteredLogs = logs.filter((log) => {
    if (logLevelFilter === "ALL") return true;
    return log.level === logLevelFilter;
  });

  // Get log level color
  const getLogLevelColor = (level: string) => {
    switch (level) {
      case "ERROR":
        return "text-red-600 dark:text-red-400";
      case "WARN":
        return "text-yellow-600 dark:text-yellow-400";
      case "INFO":
        return "text-blue-600 dark:text-blue-400";
      case "DEBUG":
        return "text-gray-600 dark:text-gray-400";
      default:
        return "text-gray-600 dark:text-gray-400";
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp?: string) => {
    if (!timestamp) return "";
    try {
      // Try parsing as ISO string first
      let date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        // Try parsing as "YYYY-MM-DD HH:MM:SS" format
        date = new Date(timestamp.replace(" ", "T"));
      }
      if (!isNaN(date.getTime())) {
        return date.toLocaleString("en-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
      }
      return timestamp;
    } catch {
      return timestamp;
    }
  };

  if (!agentId) {
    return (
      <div className="p-6 dark:bg-gray-900 h-full">
        <div className="text-red-600 dark:text-red-400">
          Invalid agent ID
        </div>
      </div>
    );
  }

  if (loading && !status) {
    return (
      <div className="p-6 dark:bg-gray-900 h-full">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-400">
            Loading agent information...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 dark:bg-gray-900 h-full min-h-screen overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate("/studio/agents/service")}
            className="
              inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600
              rounded-md text-sm font-medium text-gray-700 dark:text-gray-300
              bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700
              transition-colors
            "
          >
            <svg
              className="w-4 h-4 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
            Back to List
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {agentId}
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Service agent details and logs
            </p>
          </div>
        </div>

        <button
          onClick={fetchData}
          disabled={loading}
          className={`
            inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600
            rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300
            bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700
            focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors
          `}
        >
          <svg
            className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Status Card */}
      {status && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow mb-6 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Status Information
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Status</p>
              <p className="text-lg font-medium text-gray-900 dark:text-gray-100 mt-1">
                {status.status === "running"
                  ? "Running"
                  : status.status === "stopped"
                  ? "Stopped"
                  : status.status}
              </p>
            </div>
            {status.uptime !== undefined && status.uptime !== null && (
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Uptime</p>
                <p className="text-lg font-medium text-gray-900 dark:text-gray-100 mt-1">
                  {Math.floor(status.uptime / 3600)}h{" "}
                  {Math.floor((status.uptime % 3600) / 60)}m
                </p>
              </div>
            )}
            {status.pid !== undefined && status.pid !== null && (
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Process ID</p>
                <p className="text-lg font-medium text-gray-900 dark:text-gray-100 mt-1">
                  {status.pid}
                </p>
              </div>
            )}
            {status.file_type && (
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">File Type</p>
                <p className="text-lg font-medium text-gray-900 dark:text-gray-100 mt-1">
                  {status.file_type.toUpperCase()}
                </p>
              </div>
            )}
            {status.error_message && (
              <div className="col-span-full">
                <p className="text-sm text-gray-600 dark:text-gray-400">Error Message</p>
                <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                  {status.error_message}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Logs Viewer */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Log Viewer
            </h2>
            <div className="flex items-center space-x-4">
              {/* Polling Status */}
              {status && status.status === "running" && (
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Real-time polling
                  </span>
                </div>
              )}

              {/* Auto-scroll toggle */}
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Auto-scroll
                </span>
              </label>

              {/* Log level filter */}
              <select
                value={logLevelFilter}
                onChange={(e) =>
                  setLogLevelFilter(
                    e.target.value as "ALL" | "INFO" | "WARN" | "ERROR"
                  )
                }
                className="
                  rounded-md border-gray-300 dark:border-gray-600
                  bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
                  text-sm focus:ring-blue-500 focus:border-blue-500
                "
              >
                <option value="ALL">All Levels</option>
                <option value="INFO">INFO</option>
                <option value="WARN">WARN</option>
                <option value="ERROR">ERROR</option>
              </select>

              {/* Clear logs button */}
              <button
                onClick={() => setLogs([])}
                className="
                  text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100
                  px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700
                  transition-colors
                "
              >
                Clear Logs
              </button>
            </div>
          </div>
        </div>

        {/* Logs Container */}
        <div
          ref={logsContainerRef}
          onScroll={handleScroll}
          className="h-96 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900 font-mono text-sm"
        >
          {filteredLogs.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              No logs
            </div>
          ) : (
            <div className="space-y-1">
              {filteredLogs.map((log, index) => (
                <div
                  key={index}
                  className="flex items-start space-x-3 hover:bg-gray-100 dark:hover:bg-gray-800 px-2 py-1 rounded"
                >
                  {log.timestamp && (
                    <span className="text-gray-500 dark:text-gray-500 text-xs flex-shrink-0 w-32">
                      {formatTimestamp(log.timestamp)}
                    </span>
                  )}
                  {log.level && (
                    <span
                      className={`font-semibold flex-shrink-0 w-16 ${getLogLevelColor(
                        log.level
                      )}`}
                    >
                      {log.level}
                    </span>
                  )}
                  <span className="text-gray-900 dark:text-gray-100 flex-1 break-words">
                    {log.message}
                  </span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>

        {/* Logs Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400">
          Total {filteredLogs.length} logs
          {logLevelFilter !== "ALL" && ` (Filtered: ${logLevelFilter})`}
        </div>
      </div>
    </div>
  );
};

export default ServiceAgentDetail;

