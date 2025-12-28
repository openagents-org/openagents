import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  getServiceAgents,
  startServiceAgent,
  stopServiceAgent,
  restartServiceAgent,
  getGlobalEnvVars,
  saveGlobalEnvVars,
  type ServiceAgent,
  type AgentEnvVars,
} from "@/services/serviceAgentsApi";
import { Button } from "@/components/layout/ui/button";
import { Badge } from "@/components/layout/ui/badge";
import { AlertCircle, RefreshCw, FileText, Eye, EyeOff, Play, Square, Loader2, Settings, Plus, Trash2, Save, ChevronDown, ChevronUp, Cpu, ChevronRight } from "lucide-react";

// Helper to check if a variable name is sensitive (should be masked)
const isSensitiveVariable = (name: string): boolean => {
  const sensitivePatterns = ['KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'CREDENTIAL', 'AUTH'];
  const upperName = name.toUpperCase();
  return sensitivePatterns.some(pattern => upperName.includes(pattern));
};

// Helper to mask a value
const maskValue = (value: string): string => {
  if (!value || value.length <= 8) return '••••••••';
  return value.substring(0, 4) + '••••••••' + value.substring(value.length - 4);
};

/**
 * Service Agent List Component
 * Displays all service agents with status indicators and control buttons
 */
const ServiceAgentList: React.FC = () => {
  const { t } = useTranslation('serviceAgent');
  const [agents, setAgents] = useState<ServiceAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();

  // Global environment variables state
  const [globalEnvExpanded, setGlobalEnvExpanded] = useState(false);
  const [globalEnvVars, setGlobalEnvVars] = useState<AgentEnvVars>({});
  const [originalGlobalEnvVars, setOriginalGlobalEnvVars] = useState<AgentEnvVars>({});
  const [loadingGlobalEnv, setLoadingGlobalEnv] = useState(false);
  const [savingGlobalEnv, setSavingGlobalEnv] = useState(false);
  const [globalEnvFetched, setGlobalEnvFetched] = useState(false);
  const [newGlobalEnvName, setNewGlobalEnvName] = useState("");
  const [newGlobalEnvValue, setNewGlobalEnvValue] = useState("");
  const [visibleSensitiveVars, setVisibleSensitiveVars] = useState<Set<string>>(new Set());

  // Fetch agents
  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getServiceAgents();
      setAgents(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : t('list.messages.fetchFailed');
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Initial load
  useEffect(() => {
    fetchAgents();
    // Auto-refresh every 5 seconds
    const interval = setInterval(fetchAgents, 5000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  // Fetch global environment variables when expanded
  const fetchGlobalEnvVars = useCallback(async () => {
    try {
      setLoadingGlobalEnv(true);
      const envVars = await getGlobalEnvVars();
      setGlobalEnvVars(envVars);
      setOriginalGlobalEnvVars(envVars);
    } catch (err) {
      console.error("Failed to fetch global env vars:", err);
      toast.error(t('list.globalEnv.fetchFailed'));
    } finally {
      setLoadingGlobalEnv(false);
      setGlobalEnvFetched(true);
    }
  }, [t]);

  useEffect(() => {
    if (globalEnvExpanded && !globalEnvFetched && !loadingGlobalEnv) {
      fetchGlobalEnvVars();
    }
  }, [globalEnvExpanded, globalEnvFetched, loadingGlobalEnv, fetchGlobalEnvVars]);

  // Handle adding new global env var
  const handleAddGlobalEnvVar = () => {
    const name = newGlobalEnvName.trim();
    if (!name) {
      toast.error(t('list.globalEnv.variableNameRequired'));
      return;
    }
    if (globalEnvVars[name] !== undefined) {
      toast.error(t('list.globalEnv.variableExists'));
      return;
    }
    setGlobalEnvVars({ ...globalEnvVars, [name]: newGlobalEnvValue });
    setNewGlobalEnvName("");
    setNewGlobalEnvValue("");
  };

  // Handle deleting global env var
  const handleDeleteGlobalEnvVar = (name: string) => {
    const newEnvVars = { ...globalEnvVars };
    delete newEnvVars[name];
    setGlobalEnvVars(newEnvVars);
  };

  // Handle updating global env var value
  const handleUpdateGlobalEnvVar = (name: string, value: string) => {
    setGlobalEnvVars({ ...globalEnvVars, [name]: value });
  };

  // Toggle visibility of sensitive variable
  const toggleSensitiveVarVisibility = (name: string) => {
    setVisibleSensitiveVars(prev => {
      const newSet = new Set(prev);
      if (newSet.has(name)) {
        newSet.delete(name);
      } else {
        newSet.add(name);
      }
      return newSet;
    });
  };

  // Handle saving global env vars
  const handleSaveGlobalEnvVars = async () => {
    try {
      setSavingGlobalEnv(true);
      await saveGlobalEnvVars(globalEnvVars);
      setOriginalGlobalEnvVars(globalEnvVars);
      toast.success(t('list.globalEnv.saveSuccess'));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : t('list.globalEnv.saveFailed');
      toast.error(errorMessage);
    } finally {
      setSavingGlobalEnv(false);
    }
  };

  // Check if global env vars have changed
  const hasGlobalEnvChanges = JSON.stringify(globalEnvVars) !== JSON.stringify(originalGlobalEnvVars);

  // Handle agent action (start/stop/restart)
  const handleAction = async (
    agentId: string,
    action: "start" | "stop" | "restart"
  ) => {
    try {
      setActionLoading((prev) => ({ ...prev, [agentId]: true }));

      switch (action) {
        case "start":
          await startServiceAgent(agentId);
          toast.success(t('list.messages.started', { id: agentId }));
          break;
        case "stop":
          await stopServiceAgent(agentId);
          toast.success(t('list.messages.stopped', { id: agentId }));
          break;
        case "restart":
          await restartServiceAgent(agentId);
          toast.success(t('list.messages.restarted', { id: agentId }));
          break;
      }

      // Refresh agents list after action
      await fetchAgents();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : t('list.messages.failed');
      toast.error(errorMessage);
    } finally {
      setActionLoading((prev) => ({ ...prev, [agentId]: false }));
    }
  };

  // Get status badge variant
  const getStatusVariant = (status: string): "success" | "destructive" | "warning" | "secondary" => {
    switch (status) {
      case "running":
        return "success";
      case "stopped":
        return "secondary";
      case "error":
        return "destructive";
      case "starting":
      case "stopping":
        return "warning";
      default:
        return "secondary";
    }
  };

  // Get status text
  const getStatusText = (status: string) => {
    switch (status) {
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
        return status;
    }
  };

  // Loading state
  if (loading && agents.length === 0) {
    return (
      <div className="p-6 dark:bg-gray-900 h-full">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-400">
            {t('list.loading')}
          </span>
        </div>
      </div>
    );
  }

  // Error state
  if (error && agents.length === 0) {
    return (
      <div className="p-6 dark:bg-gray-900 h-full">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <AlertCircle className="h-5 w-5 text-red-400" />
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
                {t('list.loadFailed')}
              </h3>
              <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                {error}
              </p>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={fetchAgents}
                className="mt-2 text-sm bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200 px-3 py-1 rounded hover:bg-red-200 dark:hover:bg-red-700 transition-colors"
              >
                {t('list.retry')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 dark:bg-gray-900 h-full min-h-screen overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('list.title')}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {t('list.subtitle')}
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={fetchAgents}
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
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          {loading ? t('list.refreshing') : t('list.refresh')}
        </Button>
      </div>

      {/* Model Configuration - Link to Default Models Page */}
      <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow">
        <button
          type="button"
          onClick={() => navigate("/admin/default-models")}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
        >
          <div className="flex items-center space-x-3">
            <Cpu className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <div>
              <h3 className="font-medium text-gray-900 dark:text-gray-100">
                {t('list.modelConfig.title')}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('list.modelConfig.subtitle')}
              </p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-400" />
        </button>
      </div>

      {/* Global Environment Variables */}
      <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow">
        <button
          type="button"
          onClick={() => setGlobalEnvExpanded(!globalEnvExpanded)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
        >
          <div className="flex items-center space-x-3">
            <Settings className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <div>
              <h3 className="font-medium text-gray-900 dark:text-gray-100">
                {t('list.globalEnv.title')}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('list.globalEnv.subtitle')}
              </p>
            </div>
          </div>
          {globalEnvExpanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </button>

        {globalEnvExpanded && (
          <div className="border-t border-gray-200 dark:border-gray-700 p-4">
            {loadingGlobalEnv ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                <span className="ml-2 text-gray-600 dark:text-gray-400">{t('list.globalEnv.loading')}</span>
              </div>
            ) : (
              <>
                {/* Add new variable */}
                <div className="flex items-center space-x-2 mb-4">
                  <input
                    type="text"
                    placeholder={t('list.globalEnv.variableName')}
                    value={newGlobalEnvName}
                    onChange={(e) => setNewGlobalEnvName(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    placeholder={t('list.globalEnv.value')}
                    value={newGlobalEnvValue}
                    onChange={(e) => setNewGlobalEnvValue(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddGlobalEnvVar}
                    className="px-3 py-2"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>

                {/* Variable list */}
                <div className="space-y-2">
                  {Object.keys(globalEnvVars).length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                      {t('list.globalEnv.empty')}
                    </p>
                  ) : (
                    Object.entries(globalEnvVars).map(([name, value]) => {
                      const isSensitive = isSensitiveVariable(name);
                      const isVisible = visibleSensitiveVars.has(name);
                      const displayValue = isSensitive && !isVisible ? maskValue(value) : value;

                      return (
                        <div key={name} className="flex items-center space-x-2">
                          <input
                            type="text"
                            value={name}
                            disabled
                            className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm"
                          />
                          <div className="flex-1 relative">
                            <input
                              type={isSensitive && !isVisible ? "password" : "text"}
                              value={isSensitive && !isVisible ? value : value}
                              onChange={(e) => handleUpdateGlobalEnvVar(name, e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                              placeholder={isSensitive && !isVisible ? displayValue : ""}
                            />
                            {isSensitive && (
                              <button
                                type="button"
                                onClick={() => toggleSensitiveVarVisibility(name)}
                                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                              >
                                {isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteGlobalEnvVar(name)}
                            className="px-2 py-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Save button */}
                {hasGlobalEnvChanges && (
                  <div className="mt-4 flex justify-end">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={handleSaveGlobalEnvVars}
                      disabled={savingGlobalEnv}
                      className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md"
                    >
                      {savingGlobalEnv ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {t('list.globalEnv.saving')}
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4 mr-2" />
                          {t('list.globalEnv.saveChanges')}
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {/* Note about restart */}
                <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                  {t('list.globalEnv.note')}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Agents List */}
      {agents.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
          <FileText className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">
            {t('list.noAgents')}
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('list.noAgentsHint')}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {agents.map((agent) => {
            const isLoading = actionLoading[agent.agent_id] || false;
            const isRunning = agent.status === "running";

            return (
              <div
                key={agent.agent_id}
                className="bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between">
                    {/* Agent Info */}
                    <div className="flex-1">
                      <div className="flex items-center space-x-3">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                          {agent.agent_id}
                        </h3>
                        <Badge
                          variant={getStatusVariant(agent.status)}
                          appearance="light"
                          size="sm"
                        >
                          {getStatusText(agent.status)}
                        </Badge>
                      </div>
                      <div className="mt-2 flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-500">
                        {agent.file_type && (
                          <span>Type: {agent.file_type.toUpperCase()}</span>
                        )}
                        {agent.pid && (
                          <span>PID: {agent.pid}</span>
                        )}
                        {agent.error_message && (
                          <span className="text-red-600 dark:text-red-400">
                            Error: {agent.error_message}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center space-x-2 ml-4">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/admin/service-agents/${agent.agent_id}`)}
                        className="
                          inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600
                          rounded-md text-sm font-medium text-gray-700 dark:text-gray-300
                          bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700
                          focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
                          transition-colors
                        "
                      >
                        <Eye className="w-4 h-4 mr-1.5" />
                        {t('list.viewDetails')}
                      </Button>

                      {!isRunning && (
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          onClick={() => handleAction(agent.agent_id, "start")}
                          disabled={isLoading}
                          className="
                            inline-flex items-center px-3 py-2 border border-transparent
                            rounded-md text-sm font-medium text-white
                            bg-green-600 hover:bg-green-700
                            focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500
                            disabled:opacity-50 disabled:cursor-not-allowed
                            transition-colors
                          "
                        >
                          {isLoading ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                              {t('list.starting')}
                            </>
                          ) : (
                            <>
                              <Play className="w-4 h-4 mr-1.5" />
                              {t('list.start')}
                            </>
                          )}
                        </Button>
                      )}

                      {isRunning && (
                        <>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => handleAction(agent.agent_id, "stop")}
                            disabled={isLoading}
                            className="
                              inline-flex items-center px-3 py-2 border border-transparent
                              rounded-md text-sm font-medium text-white
                              bg-red-600 hover:bg-red-700
                              focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500
                              disabled:opacity-50 disabled:cursor-not-allowed
                              transition-colors
                            "
                          >
                            {isLoading ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                                {t('list.stopping')}
                              </>
                            ) : (
                              <>
                                <Square className="w-4 h-4 mr-1.5" />
                                {t('list.stop')}
                              </>
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleAction(agent.agent_id, "restart")}
                            disabled={isLoading}
                            className="
                              inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600
                              rounded-md text-sm font-medium text-gray-700 dark:text-gray-300
                              bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700
                              focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
                              disabled:opacity-50 disabled:cursor-not-allowed
                              transition-colors
                            "
                          >
                            {isLoading ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                                {t('list.restarting')}
                              </>
                            ) : (
                              <>
                                <RefreshCw className="w-4 h-4 mr-1.5" />
                                {t('list.restart')}
                              </>
                            )}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ServiceAgentList;

