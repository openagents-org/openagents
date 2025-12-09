import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getServiceAgents, type ServiceAgent } from "@/services/serviceAgentsApi";
import { useIsAdmin } from "@/hooks/useIsAdmin";

/**
 * Service Agents Sidebar Component
 * Displays a list of service agents with their status in the sidebar (admin only)
 */
const ServiceAgentsSidebar: React.FC = () => {
  const [agents, setAgents] = useState<ServiceAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, isLoading: isAdminLoading } = useIsAdmin();

  // Fetch agents
  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getServiceAgents();
      setAgents(data);
    } catch (err) {
      console.error("Failed to fetch service agents:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load and auto-refresh
  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 5000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  // Get status indicator color
  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return "bg-green-500";
      case "stopped":
        return "bg-gray-400";
      case "error":
        return "bg-red-500";
      case "starting":
      case "stopping":
        return "bg-yellow-500 animate-pulse";
      default:
        return "bg-gray-400";
    }
  };

  // Check if agent is selected
  const isSelected = (agentId: string) => {
    return location.pathname.includes(`/studio/agents/service/${agentId}`);
  };

  // Count agents by status
  const runningCount = agents.filter((a) => a.status === "running").length;
  const stoppedCount = agents.filter((a) => a.status === "stopped").length;
  const errorCount = agents.filter((a) => a.status === "error").length;

  // Show loading state while checking admin status
  if (isAdminLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Loading...
          </p>
        </div>
      </div>
    );
  }

  // Show access denied for non-admin users
  if (!isAdmin) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center">
          <svg
            className="w-8 h-8 mx-auto text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Admin access required
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Service Agents
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Manage workspace agents
        </p>

        {/* Status summary */}
        <div className="flex items-center gap-3 mt-3 text-xs">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            <span className="text-gray-600 dark:text-gray-400">
              {runningCount} running
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-gray-400"></span>
            <span className="text-gray-600 dark:text-gray-400">
              {stoppedCount} stopped
            </span>
          </div>
          {errorCount > 0 && (
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              <span className="text-red-600 dark:text-red-400">
                {errorCount} error
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto">
        {loading && agents.length === 0 ? (
          <div className="p-4 text-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Loading agents...
            </p>
          </div>
        ) : agents.length === 0 ? (
          <div className="p-4 text-center">
            <svg
              className="w-8 h-8 mx-auto text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"
              />
            </svg>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              No agents found
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Add .yaml or .py files to workspace/agents/
            </p>
          </div>
        ) : (
          <div className="py-2">
            {agents.map((agent) => (
              <button
                key={agent.agent_id}
                onClick={() =>
                  navigate(`/studio/agents/service/${agent.agent_id}`)
                }
                className={`
                  w-full px-4 py-3 text-left transition-colors
                  hover:bg-gray-100 dark:hover:bg-gray-800
                  ${
                    isSelected(agent.agent_id)
                      ? "bg-blue-50 dark:bg-blue-900/20 border-r-2 border-blue-600"
                      : ""
                  }
                `}
              >
                <div className="flex items-center gap-3">
                  {/* Status indicator */}
                  <span
                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${getStatusColor(
                      agent.status
                    )}`}
                  />

                  {/* Agent info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                        {agent.agent_id}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-medium
                        ${
                          agent.file_type === "yaml"
                            ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                            : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                        }
                      `}
                      >
                        {agent.file_type}
                      </span>
                    </div>
                    {agent.error_message && (
                      <p className="text-xs text-red-500 dark:text-red-400 truncate mt-0.5">
                        {agent.error_message}
                      </p>
                    )}
                    {agent.pid && agent.status === "running" && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        PID: {agent.pid}
                      </p>
                    )}
                  </div>

                  {/* Arrow */}
                  <svg
                    className="w-4 h-4 text-gray-400 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* View all button */}
      <div className="p-3 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={() => navigate("/studio/agents/service")}
          className="w-full px-3 py-2 text-sm font-medium text-blue-600 dark:text-blue-400
                     bg-blue-50 dark:bg-blue-900/20 rounded-lg
                     hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
        >
          View All Agents
        </button>
      </div>
    </div>
  );
};

export default ServiceAgentsSidebar;
