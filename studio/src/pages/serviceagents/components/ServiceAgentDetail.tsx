import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import Editor from "@monaco-editor/react";
import {
  getAgentStatus,
  getAgentLogs,
  getAgentSource,
  saveAgentSource,
  restartServiceAgent,
  startServiceAgent,
  stopServiceAgent,
  type AgentStatus,
  type LogEntry,
  type AgentSource,
} from "@/services/serviceAgentsApi";

type TabType = "status" | "logs" | "editor";

/**
 * Service Agent Detail Component
 * Shows detailed agent information, real-time log viewer, and code editor
 */
const ServiceAgentDetail: React.FC = () => {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [logLevelFilter, setLogLevelFilter] = useState<
    "ALL" | "INFO" | "WARN" | "ERROR"
  >("ALL");
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>("status");

  // Code editor state
  const [sourceCode, setSourceCode] = useState<string>("");
  const [originalSourceCode, setOriginalSourceCode] = useState<string>("");
  const [sourceInfo, setSourceInfo] = useState<AgentSource | null>(null);
  const [loadingSource, setLoadingSource] = useState(false);
  const [savingSource, setSavingSource] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Action loading states
  const [startingAgent, setStartingAgent] = useState(false);
  const [stoppingAgent, setStoppingAgent] = useState(false);

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
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  // Fetch source code
  const fetchSource = useCallback(async () => {
    if (!agentId) return;

    try {
      setLoadingSource(true);
      const source = await getAgentSource(agentId);
      setSourceInfo(source);
      setSourceCode(source.content);
      setOriginalSourceCode(source.content);
      setHasUnsavedChanges(false);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to fetch agent source";
      toast.error(errorMessage);
    } finally {
      setLoadingSource(false);
    }
  }, [agentId]);

  // Load source when switching to editor tab
  useEffect(() => {
    if (activeTab === "editor" && !sourceInfo && !loadingSource) {
      fetchSource();
    }
  }, [activeTab, sourceInfo, loadingSource, fetchSource]);

  // Track unsaved changes
  useEffect(() => {
    setHasUnsavedChanges(sourceCode !== originalSourceCode);
  }, [sourceCode, originalSourceCode]);

  // Handle save source
  const handleSaveSource = async () => {
    if (!agentId || !hasUnsavedChanges) return;

    try {
      setSavingSource(true);
      const result = await saveAgentSource(agentId, sourceCode);
      setOriginalSourceCode(sourceCode);
      setHasUnsavedChanges(false);
      toast.success(result.message);

      if (result.needs_restart) {
        toast.info("Agent is running. Restart required for changes to take effect.", {
          action: {
            label: "Restart Now",
            onClick: async () => {
              try {
                await restartServiceAgent(agentId);
                toast.success("Agent restarted successfully");
              } catch (err) {
                toast.error("Failed to restart agent");
              }
            },
          },
        });
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to save source";
      toast.error(errorMessage);
    } finally {
      setSavingSource(false);
    }
  };

  // Handle discard changes
  const handleDiscardChanges = () => {
    setSourceCode(originalSourceCode);
    setHasUnsavedChanges(false);
  };

  // Handle start agent
  const handleStartAgent = async () => {
    if (!agentId) return;
    try {
      setStartingAgent(true);
      await startServiceAgent(agentId);
      toast.success("Agent started successfully");
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start agent");
    } finally {
      setStartingAgent(false);
    }
  };

  // Handle stop agent
  const handleStopAgent = async () => {
    if (!agentId) return;
    try {
      setStoppingAgent(true);
      await stopServiceAgent(agentId);
      toast.success("Agent stopped successfully");
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to stop agent");
    } finally {
      setStoppingAgent(false);
    }
  };

  // Handle restart agent
  const handleRestartAgent = async () => {
    if (!agentId) return;
    try {
      setStartingAgent(true);
      await restartServiceAgent(agentId);
      toast.success("Agent restarted successfully");
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to restart agent");
    } finally {
      setStartingAgent(false);
    }
  };

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

  // Get status color
  const getStatusColor = (statusValue: string) => {
    switch (statusValue) {
      case "running":
        return "text-green-600 dark:text-green-400";
      case "stopped":
        return "text-gray-600 dark:text-gray-400";
      case "error":
        return "text-red-600 dark:text-red-400";
      case "starting":
      case "stopping":
        return "text-yellow-600 dark:text-yellow-400";
      default:
        return "text-gray-600 dark:text-gray-400";
    }
  };

  // Get status badge color
  const getStatusBadgeColor = (statusValue: string) => {
    switch (statusValue) {
      case "running":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
      case "stopped":
        return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
      case "error":
        return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
      case "starting":
      case "stopping":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
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
    <div className="flex flex-col h-full dark:bg-gray-900">
      {/* Header - Fixed height */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate("/studio/agents/service")}
              className="
                inline-flex items-center px-3 py-1.5 border border-gray-300 dark:border-gray-600
                rounded-md text-sm font-medium text-gray-700 dark:text-gray-300
                bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700
                transition-colors
              "
            >
              <svg
                className="w-4 h-4 mr-1.5"
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
              Back
            </button>
            <div className="flex items-center space-x-3">
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {agentId}
              </h1>
              {status && (
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusBadgeColor(status.status)}`}>
                  {status.status}
                </span>
              )}
            </div>
          </div>

          <button
            onClick={fetchData}
            disabled={loading}
            className={`
              inline-flex items-center px-3 py-1.5 border border-gray-300 dark:border-gray-600
              rounded-md text-sm font-medium text-gray-700 dark:text-gray-300
              bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700
              disabled:opacity-50 disabled:cursor-not-allowed transition-colors
            `}
          >
            <svg
              className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`}
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
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs Container - Fills remaining height */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Tab Headers */}
        <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="flex px-4">
            <button
              onClick={() => setActiveTab("status")}
              className={`
                px-4 py-3 text-sm font-medium border-b-2 transition-colors
                ${
                  activeTab === "status"
                    ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }
              `}
            >
              <div className="flex items-center space-x-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <span>Status</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab("logs")}
              className={`
                px-4 py-3 text-sm font-medium border-b-2 transition-colors
                ${
                  activeTab === "logs"
                    ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }
              `}
            >
              <div className="flex items-center space-x-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Logs</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab("editor")}
              className={`
                px-4 py-3 text-sm font-medium border-b-2 transition-colors
                ${
                  activeTab === "editor"
                    ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }
              `}
            >
              <div className="flex items-center space-x-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                <span>Source Code</span>
                {hasUnsavedChanges && (
                  <span className="w-2 h-2 rounded-full bg-orange-500" title="Unsaved changes" />
                )}
              </div>
            </button>
          </div>
        </div>

        {/* Tab Content - Fills remaining height */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Status Tab Content */}
          {activeTab === "status" && status && (
            <div className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-gray-900">
              <div className="max-w-4xl space-y-6">
                {/* Status Overview Card */}
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      Agent Status
                    </h2>
                    <div className="flex items-center space-x-3">
                      {status.status === "stopped" && (
                        <button
                          onClick={handleStartAgent}
                          disabled={startingAgent}
                          className="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md disabled:opacity-50 transition-colors"
                        >
                          {startingAgent ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                          ) : (
                            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                          Start Agent
                        </button>
                      )}
                      {status.status === "running" && (
                        <>
                          <button
                            onClick={handleRestartAgent}
                            disabled={startingAgent}
                            className="inline-flex items-center px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-medium rounded-md disabled:opacity-50 transition-colors"
                          >
                            {startingAgent ? (
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                            ) : (
                              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            )}
                            Restart
                          </button>
                          <button
                            onClick={handleStopAgent}
                            disabled={stoppingAgent}
                            className="inline-flex items-center px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-md disabled:opacity-50 transition-colors"
                          >
                            {stoppingAgent ? (
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                            ) : (
                              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                              </svg>
                            )}
                            Stop Agent
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Status</p>
                      <p className={`text-2xl font-bold capitalize ${getStatusColor(status.status)}`}>
                        {status.status}
                      </p>
                    </div>
                    {status.uptime !== undefined && status.uptime !== null && (
                      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Uptime</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                          {Math.floor(status.uptime / 3600)}h {Math.floor((status.uptime % 3600) / 60)}m
                        </p>
                      </div>
                    )}
                    {status.pid !== undefined && status.pid !== null && (
                      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Process ID</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                          {status.pid}
                        </p>
                      </div>
                    )}
                    {status.file_type && (
                      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Agent Type</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                          {status.file_type.toUpperCase()}
                        </p>
                      </div>
                    )}
                  </div>

                  {status.error_message && (
                    <div className="mt-6 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                      <p className="text-sm font-medium text-red-800 dark:text-red-300 mb-1">Error Message</p>
                      <p className="text-sm text-red-700 dark:text-red-400">
                        {status.error_message}
                      </p>
                    </div>
                  )}
                </div>

                {/* File Information Card */}
                {status.file_path && (
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                      File Information
                    </h2>
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">File Path</p>
                        <p className="text-sm font-mono text-gray-900 dark:text-gray-100 mt-1 bg-gray-50 dark:bg-gray-900 p-2 rounded">
                          {status.file_path}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Logs Tab Content */}
          {activeTab === "logs" && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Logs Header */}
              <div className="flex-shrink-0 p-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    {/* Polling Status */}
                    {status && status.status === "running" && (
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          Live
                        </span>
                      </div>
                    )}
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {filteredLogs.length} logs
                      {logLevelFilter !== "ALL" && ` (${logLevelFilter})`}
                    </span>
                  </div>
                  <div className="flex items-center space-x-3">
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
                        setLogLevelFilter(e.target.value as "ALL" | "INFO" | "WARN" | "ERROR")
                      }
                      className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="ALL">All Levels</option>
                      <option value="INFO">INFO</option>
                      <option value="WARN">WARN</option>
                      <option value="ERROR">ERROR</option>
                    </select>

                    {/* Clear logs button */}
                    <button
                      onClick={() => setLogs([])}
                      className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>

              {/* Logs Container - Fills remaining height */}
              <div
                ref={logsContainerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900 font-mono text-sm"
              >
                {filteredLogs.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
                    No logs available
                  </div>
                ) : (
                  <div className="space-y-1">
                    {filteredLogs.map((log, index) => (
                      <div
                        key={index}
                        className="flex items-start space-x-3 hover:bg-gray-100 dark:hover:bg-gray-800 px-2 py-1 rounded"
                      >
                        {log.timestamp && (
                          <span className="text-gray-500 dark:text-gray-500 text-xs flex-shrink-0 w-36">
                            {formatTimestamp(log.timestamp)}
                          </span>
                        )}
                        {log.level && (
                          <span className={`font-semibold flex-shrink-0 w-14 ${getLogLevelColor(log.level)}`}>
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
            </div>
          )}

          {/* Editor Tab Content */}
          {activeTab === "editor" && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Editor Header */}
              <div className="flex-shrink-0 p-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    {sourceInfo && (
                      <>
                        <span
                          className={`text-xs px-2 py-1 rounded uppercase font-medium
                            ${
                              sourceInfo.file_type === "yaml"
                                ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                                : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                            }
                          `}
                        >
                          {sourceInfo.file_type}
                        </span>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          {sourceInfo.file_name}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {sourceCode.split("\n").length} lines
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center space-x-3">
                    {hasUnsavedChanges && (
                      <span className="text-sm text-orange-600 dark:text-orange-400 flex items-center space-x-1">
                        <span className="w-2 h-2 rounded-full bg-orange-500" />
                        <span>Unsaved</span>
                      </span>
                    )}
                    <button
                      onClick={fetchSource}
                      disabled={loadingSource}
                      className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                    >
                      Reload
                    </button>
                    <button
                      onClick={handleDiscardChanges}
                      disabled={!hasUnsavedChanges}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors
                        ${hasUnsavedChanges
                          ? "text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
                          : "text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 cursor-not-allowed"
                        }
                      `}
                    >
                      Discard
                    </button>
                    <button
                      onClick={handleSaveSource}
                      disabled={!hasUnsavedChanges || savingSource}
                      className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center space-x-2
                        ${hasUnsavedChanges && !savingSource
                          ? "text-white bg-blue-600 hover:bg-blue-700"
                          : "text-gray-400 dark:text-gray-500 bg-gray-200 dark:bg-gray-700 cursor-not-allowed"
                        }
                      `}
                    >
                      {savingSource ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <span>Save</span>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Code Editor - Fills remaining height */}
              <div className="flex-1 min-h-0">
                {loadingSource ? (
                  <div className="h-full flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
                      <p className="text-gray-500 dark:text-gray-400 mt-3">
                        Loading source code...
                      </p>
                    </div>
                  </div>
                ) : (
                  <Editor
                    height="100%"
                    language={sourceInfo?.file_type === "yaml" ? "yaml" : "python"}
                    theme={document.documentElement.classList.contains("dark") ? "vs-dark" : "light"}
                    value={sourceCode}
                    onChange={(value) => setSourceCode(value || "")}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      tabSize: sourceInfo?.file_type === "python" ? 4 : 2,
                      scrollBeyondLastLine: false,
                      wordWrap: "on",
                      automaticLayout: true,
                      lineNumbers: "on",
                      renderLineHighlight: "line",
                      folding: true,
                      bracketPairColorization: { enabled: true },
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ServiceAgentDetail;
