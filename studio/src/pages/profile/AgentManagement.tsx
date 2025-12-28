import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useOpenAgents } from "@/context/OpenAgentsProvider";
import { useConfirm } from "@/context/ConfirmContext";
import { useAuthStore } from "@/stores/authStore";
import { toast } from "sonner";
import { Button } from "@/components/layout/ui/button";

interface AgentInfo {
  agent_id: string;
  status?: string;
  isKicked?: boolean; // Track if agent was just kicked
}

const AgentManagement: React.FC = () => {
  const { t } = useTranslation('network');
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [groups, setGroups] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [kickingAgentId, setKickingAgentId] = useState<string | null>(null);

  const { connector } = useOpenAgents();
  const { confirm } = useConfirm();
  const { agentName: currentAgentName } = useAuthStore();

  // Fetch agents from /api/health
  const fetchAgents = useCallback(async () => {
    if (!connector) {
      setError(t('agents.messages.fetchError'));
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const healthData = await connector.getNetworkHealth();

      if (healthData && healthData.agents) {
        // Convert agents object to array
        const agentsList: AgentInfo[] = Object.entries(healthData.agents).map(
          ([agentId, agentData]: [string, any]) => ({
            agent_id: agentId,
            status: agentData.status || "online",
          })
        );

        setAgents(agentsList);

        // Store groups data
        if (healthData.groups) {
          setGroups(healthData.groups);
        }
      } else {
        setAgents([]);
      }
    } catch (err) {
      console.error("Failed to fetch agents:", err);
      setError(err instanceof Error ? err.message : t('agents.messages.fetchError'));
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, [connector, t]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Get group names for an agent
  const getAgentGroups = useCallback((agentId: string): string[] => {
    const agentGroups: string[] = [];
    for (const [groupName, members] of Object.entries(groups)) {
      if (Array.isArray(members) && members.includes(agentId)) {
        agentGroups.push(groupName);
      }
    }
    return agentGroups;
  }, [groups]);

  // Handle kick agent
  const handleKickAgent = async (targetAgentId: string) => {
    if (!connector) return;

    // Prevent kicking yourself
    if (targetAgentId === currentAgentName) {
      alert(t('agents.messages.kickSelf'));
      return;
    }

    try {
      // Show confirmation dialog
      const confirmed = await confirm(
        t('agents.kickConfirm.title'),
        t('agents.kickConfirm.message', { name: targetAgentId }),
        {
          confirmText: t('agents.kickConfirm.confirm'),
          cancelText: t('agents.kickConfirm.cancel'),
          type: "warning",
        }
      );

      if (!confirmed) {
        return;
      }

      setKickingAgentId(targetAgentId);

      // Send system.kick_agent event
      const response = await connector.sendEvent({
        event_name: "system.kick_agent",
        source_id: currentAgentName || "system",
        payload: {
          target_agent_id: targetAgentId,
        },
      });

      if (response.success) {
        console.log(`✅ Successfully kicked agent: ${targetAgentId}`);

        // Immediately update the UI to show offline status
        setAgents((prevAgents) =>
          prevAgents.map((agent) =>
            agent.agent_id === targetAgentId
              ? { ...agent, status: "offline", isKicked: true }
              : agent
          )
        );

        toast.success(t('agents.messages.kickSuccess', { name: targetAgentId }), {
          description: t('agents.messages.kickSuccessDesc'),
        });

        // Refresh agents list after a short delay to get updated data
        // setTimeout(() => {
        //   fetchAgents();
        // }, 2000);
      } else {
        console.error(`❌ Failed to kick agent: ${response.message}`);
        setError(response.message || t('agents.messages.kickError'));
      }
    } catch (err) {
      console.error("Error kicking agent:", err);
      setError(err instanceof Error ? err.message : t('agents.messages.kickError'));
    } finally {
      setKickingAgentId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 dark:bg-gray-900 h-full">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-400">
            {t('agents.loading')}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 dark:bg-gray-900 h-full min-h-screen overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('agents.title')}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {t('agents.subtitle')}
          </p>
        </div>

        <Button
          onClick={fetchAgents}
          disabled={loading}
          variant="outline"
          size="sm"
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
          {t('agents.refresh')}
        </Button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center">
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
            <p className="ml-3 text-sm text-red-800 dark:text-red-200">
              {error}
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="mb-3 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="bg-white dark:bg-gray-800 overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
              {t('agents.total')}
            </dt>
            <dd className="mt-1 text-3xl font-semibold text-gray-900 dark:text-gray-100">
              {agents.length}
            </dd>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
              {t('agents.online')}
            </dt>
            <dd className="mt-1 text-3xl font-semibold text-green-600 dark:text-green-400">
              {agents.filter((a) => a.status === "online").length}
            </dd>
          </div>
        </div>
      </div>

      {/* Agents Table */}
      <div className="bg-white dark:bg-gray-800 shadow-md rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                {t('agents.table.id')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                Group
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                {t('agents.table.status')}
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                {t('agents.table.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {agents.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-6 py-12 text-center text-gray-500 dark:text-gray-400"
                >
                  <svg
                    className="mx-auto h-12 w-12 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                  <p className="mt-2">{t('agents.empty')}</p>
                </td>
              </tr>
            ) : (
              agents.map((agent) => (
                <tr
                  key={agent.agent_id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-8 w-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                        {agent.agent_id.charAt(0).toUpperCase()}
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {agent.agent_id}
                        </div>
                        {agent.agent_id === currentAgentName && (
                          <div className="text-xs text-blue-600 dark:text-blue-400">
                            {t('agents.you')}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex flex-wrap gap-1">
                      {getAgentGroups(agent.agent_id).length > 0 ? (
                        getAgentGroups(agent.agent_id).map((group) => (
                          <span
                            key={group}
                            className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                              group === 'admin'
                                ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
                                : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                            }`}
                          >
                            {group}
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500 text-xs">-</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${agent.status === "offline" || agent.isKicked
                        ? "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400"
                        : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                        }`}
                    >
                      {agent.status === "offline" || agent.isKicked
                        ? "offline"
                        : agent.status || "online"}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <Button
                      onClick={() => handleKickAgent(agent.agent_id)}
                      disabled={
                        kickingAgentId === agent.agent_id ||
                        agent.agent_id === currentAgentName ||
                        agent.status === "offline" ||
                        agent.isKicked
                      }
                      variant="destructive"
                      size="sm"
                    >
                      {kickingAgentId === agent.agent_id ? (
                        <>
                          <svg
                            className="animate-spin -ml-1 mr-2 h-3 w-3"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            ></circle>
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            ></path>
                          </svg>
                          {t('agents.kicking')}
                        </>
                      ) : (
                        <>
                          <svg
                            className="-ml-0.5 mr-1.5 h-3 w-3"
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
                          {t('agents.kick')}
                        </>
                      )}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AgentManagement;
