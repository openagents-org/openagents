import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import LazyMonacoEditor from "@/components/editors/LazyMonacoEditor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/layout/ui/select';
import { Label } from "@/components/layout/ui/label";
import { Input, InputGroup, InputAddon } from "@/components/layout/ui/input";
import { Key, Tag } from "lucide-react";
import {
  getAgentStatus,
  getAgentLogs,
  getAgentSource,
  saveAgentSource,
  getAgentEnvVars,
  saveAgentEnvVars,
  restartServiceAgent,
  startServiceAgent,
  stopServiceAgent,
  type AgentStatus,
  type LogEntry,
  type AgentSource,
  type AgentEnvVars,
} from "@/services/serviceAgentsApi";

type TabType = "status" | "logs" | "editor" | "env";

/**
 * Service Agent Detail Component
 * Shows detailed agent information, real-time log viewer, and code editor
 */
const ServiceAgentDetail: React.FC = () => {
  const { t } = useTranslation('serviceAgent');
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [logLevelFilter, setLogLevelFilter] = useState<
    "ALL" | "INFO" | "WARN" | "ERROR"
  >("ALL");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedLogs, setCopiedLogs] = useState(false);
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

  // Environment variables state
  const [envVars, setEnvVars] = useState<AgentEnvVars>({});
  const [originalEnvVars, setOriginalEnvVars] = useState<AgentEnvVars>({});
  const [loadingEnvVars, setLoadingEnvVars] = useState(false);
  const [savingEnvVars, setSavingEnvVars] = useState(false);
  const [hasUnsavedEnvChanges, setHasUnsavedEnvChanges] = useState(false);
  const [envVarsFetched, setEnvVarsFetched] = useState(false);
  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvValue, setNewEnvValue] = useState("");

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
        err instanceof Error ? err.message : t('detail.messages.fetchStatusFailed');
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [agentId, t]);

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
        err instanceof Error ? err.message : t('detail.messages.fetchSourceFailed');
      toast.error(errorMessage);
    } finally {
      setLoadingSource(false);
    }
  }, [agentId, t]);

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

  // Fetch environment variables
  const fetchEnvVars = useCallback(async () => {
    if (!agentId) return;

    try {
      setLoadingEnvVars(true);
      const vars = await getAgentEnvVars(agentId);
      setEnvVars(vars || {});
      setOriginalEnvVars(vars || {});
      setHasUnsavedEnvChanges(false);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to fetch environment variables";
      toast.error(errorMessage);
    } finally {
      setLoadingEnvVars(false);
      setEnvVarsFetched(true);
    }
  }, [agentId]);

  // Load env vars when switching to env tab
  useEffect(() => {
    if (activeTab === "env" && !envVarsFetched && !loadingEnvVars) {
      fetchEnvVars();
    }
  }, [activeTab, envVarsFetched, loadingEnvVars, fetchEnvVars]);

  // Track unsaved env changes
  useEffect(() => {
    setHasUnsavedEnvChanges(JSON.stringify(envVars) !== JSON.stringify(originalEnvVars));
  }, [envVars, originalEnvVars]);

  // Handle save env vars
  const handleSaveEnvVars = async () => {
    if (!agentId || !hasUnsavedEnvChanges) return;

    try {
      setSavingEnvVars(true);
      const result = await saveAgentEnvVars(agentId, envVars);
      setOriginalEnvVars({ ...envVars });
      setHasUnsavedEnvChanges(false);
      toast.success(result.message);

      if (result.needs_restart) {
        toast.info(t('detail.env.restartRequired'), {
          action: {
            label: t('detail.actions.restartNow'),
            onClick: async () => {
              try {
                await restartServiceAgent(agentId);
                toast.success(t('detail.messages.restartSuccess'));
              } catch (err) {
                toast.error(t('detail.messages.restartFailed'));
              }
            },
          },
        });
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : t('detail.env.saveFailed');
      toast.error(errorMessage);
    } finally {
      setSavingEnvVars(false);
    }
  };

  // Handle discard env changes
  const handleDiscardEnvChanges = () => {
    setEnvVars({ ...originalEnvVars });
    setHasUnsavedEnvChanges(false);
  };

  // Handle add new env var
  const handleAddEnvVar = () => {
    if (!newEnvKey.trim()) {
      toast.error(t('detail.env.variableNameRequired'));
      return;
    }
    if (envVars[newEnvKey]) {
      toast.error(t('detail.env.variableExists'));
      return;
    }
    setEnvVars({ ...envVars, [newEnvKey]: newEnvValue });
    setNewEnvKey("");
    setNewEnvValue("");
  };

  // Handle update env var
  const handleUpdateEnvVar = (key: string, value: string) => {
    setEnvVars({ ...envVars, [key]: value });
  };

  // Handle delete env var
  const handleDeleteEnvVar = (key: string) => {
    const newVars = { ...envVars };
    delete newVars[key];
    setEnvVars(newVars);
  };

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
        toast.info(t('detail.env.restartRequired'), {
          action: {
            label: t('detail.actions.restartNow'),
            onClick: async () => {
              try {
                await restartServiceAgent(agentId);
                toast.success(t('detail.messages.restartSuccess'));
              } catch (err) {
                toast.error(t('detail.messages.restartFailed'));
              }
            },
          },
        });
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : t('detail.messages.saveSourceFailed');
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
      toast.success(t('detail.messages.startSuccess'));
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('detail.messages.startFailed'));
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
      toast.success(t('detail.messages.stopSuccess'));
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('detail.messages.stopFailed'));
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
      toast.success(t('detail.messages.restartSuccess'));
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('detail.messages.restartFailed'));
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

  // Strip ANSI escape codes from log messages
  const stripAnsiCodes = (text: string): string => {
    // Remove ANSI escape sequences (color codes, cursor movements, etc.)
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1B\[[0-9;]*[A-Za-z]|\x1B\].*?\x07|\[([0-9;]*)m/g, '');
  };

  // Copy logs to clipboard
  const handleCopyLogs = useCallback(async () => {
    const logsText = filteredLogs
      .map((log) => {
        const level = log.level ? `[${log.level}]` : '';
        const message = stripAnsiCodes(log.message);
        return level ? `${level} ${message}` : message;
      })
      .join('\n');

    try {
      await navigator.clipboard.writeText(logsText);
      setCopiedLogs(true);
      setTimeout(() => setCopiedLogs(false), 2000);
    } catch (err) {
      toast.error('Failed to copy logs to clipboard');
    }
  }, [filteredLogs]);

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

  // Format timestamp (used for future timestamp display features)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _formatTimestamp = (timestamp?: string) => {
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

  // Get status label
  const getStatusLabel = (statusValue: string) => {
    switch (statusValue) {
      case "running":
        return t('list.status.running');
      case "stopped":
        return t('list.status.stopped');
      case "error":
        return t('list.status.error');
      case "starting":
        return t('list.status.starting');
      case "stopping":
        return t('list.status.stopping');
      default:
        return statusValue;
    }
  };

  if (!agentId) {
    return (
      <div className="p-6 dark:bg-gray-900 h-full">
        <div className="text-red-600 dark:text-red-400">
          {t('detail.messages.invalidId')}
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
            {t('detail.messages.loadingInfo')}
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
              onClick={() => navigate("/admin/service-agents")}
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
              {t('detail.actions.back')}
            </button>
            <div className="flex items-center space-x-3">
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {agentId}
              </h1>
              {status && (
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusBadgeColor(status.status)}`}>
                  {getStatusLabel(status.status)}
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
            {t('detail.actions.refresh')}
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
                ${activeTab === "status"
                  ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }
              `}
            >
              <div className="flex items-center space-x-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <span>{t('detail.tabs.status')}</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab("logs")}
              className={`
                px-4 py-3 text-sm font-medium border-b-2 transition-colors
                ${activeTab === "logs"
                  ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }
              `}
            >
              <div className="flex items-center space-x-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>{t('detail.tabs.logs')}</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab("editor")}
              className={`
                px-4 py-3 text-sm font-medium border-b-2 transition-colors
                ${activeTab === "editor"
                  ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }
              `}
            >
              <div className="flex items-center space-x-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                <span>{t('detail.tabs.editor')}</span>
                {hasUnsavedChanges && (
                  <span className="w-2 h-2 rounded-full bg-orange-500" title={t('detail.editor.unsaved')} />
                )}
              </div>
            </button>
            <button
              onClick={() => setActiveTab("env")}
              className={`
                px-4 py-3 text-sm font-medium border-b-2 transition-colors
                ${activeTab === "env"
                  ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }
              `}
            >
              <div className="flex items-center space-x-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                <span>{t('detail.tabs.env')}</span>
                {hasUnsavedEnvChanges && (
                  <span className="w-2 h-2 rounded-full bg-orange-500" title={t('detail.editor.unsaved')} />
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
                      {t('detail.status.title')}
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
                          {t('detail.status.startAgent')}
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
                            {t('detail.status.restart')}
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
                            {t('detail.status.stopAgent')}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{t('detail.tabs.status')}</p>
                      <p className={`text-2xl font-bold capitalize ${getStatusColor(status.status)}`}>
                        {getStatusLabel(status.status)}
                      </p>
                    </div>
                    {status.uptime !== undefined && status.uptime !== null && (
                      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{t('detail.status.uptime')}</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                          {Math.floor(status.uptime / 3600)}h {Math.floor((status.uptime % 3600) / 60)}m
                        </p>
                      </div>
                    )}
                    {status.pid !== undefined && status.pid !== null && (
                      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{t('detail.status.pid')}</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                          {status.pid}
                        </p>
                      </div>
                    )}
                    {status.file_type && (
                      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{t('detail.status.type')}</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                          {status.file_type.toUpperCase()}
                        </p>
                      </div>
                    )}
                  </div>

                  {status.error_message && (
                    <div className="mt-6 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                      <p className="text-sm font-medium text-red-800 dark:text-red-300 mb-1">{t('detail.status.error')}</p>
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
                      {t('detail.status.fileInfo')}
                    </h2>
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{t('detail.status.filePath')}</p>
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
                          {t('detail.logs.live')}
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
                        {t('detail.logs.autoScroll')}
                      </span>
                    </label>

                    {/* Log level filter */}
                    <Select
                      value={logLevelFilter}
                      onValueChange={(value) =>
                        setLogLevelFilter(value as "ALL" | "INFO" | "WARN" | "ERROR")
                      }
                    >
                      <SelectTrigger size="sm" className="rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:ring-blue-500 focus:border-blue-500">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">{t('detail.logs.allLevels')}</SelectItem>
                        <SelectItem value="INFO">INFO</SelectItem>
                        <SelectItem value="WARN">WARN</SelectItem>
                        <SelectItem value="ERROR">ERROR</SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Copy logs button */}
                    <button
                      onClick={handleCopyLogs}
                      disabled={filteredLogs.length === 0}
                      className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {copiedLogs ? t('detail.logs.copied') : t('detail.logs.copy')}
                    </button>

                    {/* Clear logs button */}
                    <button
                      onClick={() => setLogs([])}
                      className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      {t('detail.logs.clear')}
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
                    {t('detail.logs.noLogs')}
                  </div>
                ) : (
                  <div className="space-y-0 max-w-full overflow-hidden">
                    {filteredLogs.map((log, index) => (
                      <div
                        key={index}
                        className="flex items-start space-x-2 hover:bg-gray-100 dark:hover:bg-gray-800 px-2 py-0.5 rounded max-w-full"
                      >
                        {log.level && (
                          <span className={`font-semibold flex-shrink-0 w-12 ${getLogLevelColor(log.level)}`}>
                            {log.level}
                          </span>
                        )}
                        <span className="text-gray-900 dark:text-gray-100 flex-1 break-all overflow-hidden min-w-0">
                          {stripAnsiCodes(log.message)}
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
                            ${sourceInfo.file_type === "yaml"
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
                          {t('detail.editor.lines', { count: sourceCode.split("\n").length })}
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
                      {t('detail.actions.reload')}
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
                      {t('detail.actions.discard')}
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
                          <span>{t('detail.actions.saving')}</span>
                        </>
                      ) : (
                        <span>{t('detail.actions.save')}</span>
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
                        {t('detail.editor.loading')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <LazyMonacoEditor
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

          {/* Environment Tab Content */}
          {activeTab === "env" && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Environment Header */}
              <div className="flex-shrink-0 p-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {t('detail.env.variables', { count: Object.keys(envVars).length })}
                    </span>
                  </div>
                  <div className="flex items-center space-x-3">
                    {hasUnsavedEnvChanges && (
                      <span className="text-sm text-orange-600 dark:text-orange-400 flex items-center space-x-1">
                        <span className="w-2 h-2 rounded-full bg-orange-500" />
                        <span>Unsaved</span>
                      </span>
                    )}
                    <button
                      onClick={fetchEnvVars}
                      disabled={loadingEnvVars}
                      className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                    >
                      Reload
                    </button>
                    <button
                      onClick={handleDiscardEnvChanges}
                      disabled={!hasUnsavedEnvChanges}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors
                        ${hasUnsavedEnvChanges
                          ? "text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
                          : "text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 cursor-not-allowed"
                        }
                      `}
                    >
                      {t('detail.actions.discard')}
                    </button>
                    <button
                      onClick={handleSaveEnvVars}
                      disabled={!hasUnsavedEnvChanges || savingEnvVars}
                      className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center space-x-2
                        ${hasUnsavedEnvChanges && !savingEnvVars
                          ? "text-white bg-blue-600 hover:bg-blue-700"
                          : "text-gray-400 dark:text-gray-500 bg-gray-200 dark:bg-gray-700 cursor-not-allowed"
                        }
                      `}
                    >
                      {savingEnvVars ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                          <span>{t('detail.actions.saving')}</span>
                        </>
                      ) : (
                        <span>{t('detail.actions.save')}</span>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Environment Variables List */}
              <div className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900">
                {loadingEnvVars ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
                      <p className="text-gray-500 dark:text-gray-400 mt-3">
                        {t('detail.env.loading')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-4xl space-y-4">
                    {/* Add New Variable Form */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
                        {t('detail.env.addNew')}
                      </h3>
                      <div className="flex items-end space-x-3">
                        <div className="flex-1 space-y-2">
                          <Label htmlFor="newEnvKey" className="text-xs">
                            {t('detail.env.name')}
                          </Label>
                          <InputGroup>
                            <InputAddon mode="icon">
                              <Tag size={16} />
                            </InputAddon>
                            <Input
                              id="newEnvKey"
                              type="text"
                              value={newEnvKey}
                              onChange={(e) => setNewEnvKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
                              placeholder="OPENAI_API_KEY"
                              className="font-mono"
                            />
                          </InputGroup>
                        </div>
                        <div className="flex-1 space-y-2">
                          <Label htmlFor="newEnvValue" className="text-xs">
                            {t('detail.env.value')}
                          </Label>
                          <InputGroup>
                            <InputAddon mode="icon">
                              <Key size={16} />
                            </InputAddon>
                            <Input
                              id="newEnvValue"
                              type="password"
                              value={newEnvValue}
                              onChange={(e) => setNewEnvValue(e.target.value)}
                              placeholder="sk-..."
                              className="font-mono"
                            />
                          </InputGroup>
                        </div>
                        <button
                          onClick={handleAddEnvVar}
                          disabled={!newEnvKey.trim()}
                          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {t('detail.env.add')}
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        {t('detail.env.commonVars')}
                      </p>
                    </div>

                    {/* Existing Variables */}
                    {Object.keys(envVars).length > 0 ? (
                      <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
                        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {t('detail.env.title')}
                          </h3>
                        </div>
                        <div className="divide-y divide-gray-200 dark:divide-gray-700">
                          {Object.entries(envVars).map(([key, value]) => (
                            <div key={key} className="p-4 flex items-center space-x-4">
                              <div className="flex-shrink-0 w-48">
                                <span className="font-mono text-sm text-gray-900 dark:text-gray-100">
                                  {key}
                                </span>
                              </div>
                              <div className="flex-1">
                                <InputGroup>
                                  <InputAddon mode="icon">
                                    <Key size={16} />
                                  </InputAddon>
                                  <Input
                                    type="password"
                                    value={value}
                                    onChange={(e) => handleUpdateEnvVar(key, e.target.value)}
                                    className="font-mono"
                                  />
                                </InputGroup>
                              </div>
                              <button
                                onClick={() => handleDeleteEnvVar(key)}
                                className="flex-shrink-0 p-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                                title="Delete variable"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
                        <svg className="w-12 h-12 mx-auto text-gray-400 dark:text-gray-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                        </svg>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                          {t('detail.env.noVars')}
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400">
                          {t('detail.env.noVarsHint')}
                        </p>
                      </div>
                    )}

                    {/* Security Notice */}
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 border border-yellow-200 dark:border-yellow-800">
                      <div className="flex items-start space-x-3">
                        <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <div>
                          <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                            {t('detail.env.securityNotice')}
                          </h4>
                          <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                            {t('detail.env.securityText')}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
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
