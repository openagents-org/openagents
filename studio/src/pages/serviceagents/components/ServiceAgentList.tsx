import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  getServiceAgents,
  startServiceAgent,
  stopServiceAgent,
  restartServiceAgent,
  type ServiceAgent,
} from "@/services/serviceAgentsApi";

/**
 * Service Agent List Component
 * Displays all service agents with status indicators and control buttons
 */
const ServiceAgentList: React.FC = () => {
  const [agents, setAgents] = useState<ServiceAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();

  // Fetch agents
  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getServiceAgents();
      setAgents(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to fetch service agents list";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchAgents();
    // Auto-refresh every 5 seconds
    const interval = setInterval(fetchAgents, 5000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

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
          toast.success(`Service agent ${agentId} started`);
          break;
        case "stop":
          await stopServiceAgent(agentId);
          toast.success(`Service agent ${agentId} stopped`);
          break;
        case "restart":
          await restartServiceAgent(agentId);
          toast.success(`Service agent ${agentId} restarted`);
          break;
      }

      // Refresh agents list after action
      await fetchAgents();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Operation failed";
      toast.error(errorMessage);
    } finally {
      setActionLoading((prev) => ({ ...prev, [agentId]: false }));
    }
  };

  // Get status badge color
  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
      case "stopped":
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
      case "error":
        return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
      case "starting":
      case "stopping":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
    }
  };

  // Get status text
  const getStatusText = (status: string) => {
    switch (status) {
      case "running":
        return "Running";
      case "stopped":
        return "Stopped";
      case "error":
        return "Error";
      case "starting":
        return "Starting";
      case "stopping":
        return "Stopping";
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
            Loading service agents list...
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
              <svg
                className="h-5 w-5 text-red-400"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
                Load failed
              </h3>
              <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                {error}
              </p>
              <button
                onClick={fetchAgents}
                className="mt-2 text-sm bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200 px-3 py-1 rounded hover:bg-red-200 dark:hover:bg-red-700 transition-colors"
              >
                Retry
              </button>
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
            Service Agents Management
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Manage and monitor all service agents
          </p>
        </div>

        <button
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

      {/* Agents List */}
      {agents.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
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
          <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">
            No service agents
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            No service agents available
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
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(
                            agent.status
                          )}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 mr-1.5 rounded-full ${
                              agent.status === "running"
                                ? "bg-green-500"
                                : agent.status === "error"
                                ? "bg-red-500"
                                : "bg-gray-400"
                            }`}
                          />
                          {getStatusText(agent.status)}
                        </span>
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
                      <button
                        onClick={() => navigate(`/studio/agents/service/${agent.agent_id}`)}
                        className="
                          inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600
                          rounded-md text-sm font-medium text-gray-700 dark:text-gray-300
                          bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700
                          focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
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
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                          />
                        </svg>
                        View Details
                      </button>

                      {!isRunning && (
                        <button
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
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1.5"></div>
                              Starting...
                            </>
                          ) : (
                            <>
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
                                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                                />
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                              </svg>
                              Start
                            </>
                          )}
                        </button>
                      )}

                      {isRunning && (
                        <>
                          <button
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
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1.5"></div>
                                Stopping...
                              </>
                            ) : (
                              <>
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
                                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                  />
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 10h6v4H9v-4z"
                                  />
                                </svg>
                                Stop
                              </>
                            )}
                          </button>
                          <button
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
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600 mr-1.5"></div>
                                Restarting...
                              </>
                            ) : (
                              <>
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
                                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                  />
                                </svg>
                                Restart
                              </>
                            )}
                          </button>
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

