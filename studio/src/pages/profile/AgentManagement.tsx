import React, { useState, useEffect, useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { ColumnDef } from "@tanstack/react-table"
import { useOpenAgents } from "@/context/OpenAgentsProvider"
import { useConfirm } from "@/context/ConfirmContext"
import { useAuthStore } from "@/stores/authStore"
import { toast } from "sonner"
import { Button } from "@/components/layout/ui/button"
import { Badge } from "@/components/layout/ui/badge"
import { DataTable } from "@/components/layout/ui/data-table"
import { RefreshCw, X, Users, Loader2, AlertCircle } from "lucide-react"

interface AgentInfo {
  agent_id: string
  status?: string
  isKicked?: boolean
  groups?: string[]
}

const AgentManagement: React.FC = () => {
  const { t } = useTranslation("network")
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [groups, setGroups] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [kickingAgentId, setKickingAgentId] = useState<string | null>(null)

  const { connector } = useOpenAgents()
  const { confirm } = useConfirm()
  const { agentName: currentAgentName } = useAuthStore()

  // Fetch agents from /api/health
  const fetchAgents = useCallback(async () => {
    if (!connector) {
      setError(t("agents.messages.fetchError"))
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)

      const healthData = await connector.getNetworkHealth()

      if (healthData && healthData.agents) {
        const agentsList: AgentInfo[] = Object.entries(healthData.agents).map(
          ([agentId, agentData]: [string, any]) => ({
            agent_id: agentId,
            status: agentData.status || "online",
          })
        )

        setAgents(agentsList)

        if (healthData.groups) {
          setGroups(healthData.groups)
        }
      } else {
        setAgents([])
      }
    } catch (err) {
      console.error("Failed to fetch agents:", err)
      setError(
        err instanceof Error ? err.message : t("agents.messages.fetchError")
      )
      setAgents([])
    } finally {
      setLoading(false)
    }
  }, [connector, t])

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  // Get group names for an agent
  const getAgentGroups = useCallback(
    (agentId: string): string[] => {
      const agentGroups: string[] = []
      for (const [groupName, members] of Object.entries(groups)) {
        if (Array.isArray(members) && members.includes(agentId)) {
          agentGroups.push(groupName)
        }
      }
      return agentGroups
    },
    [groups]
  )

  // Enrich agents with groups data
  const enrichedAgents = useMemo(() => {
    return agents.map((agent) => ({
      ...agent,
      groups: getAgentGroups(agent.agent_id),
    }))
  }, [agents, getAgentGroups])

  // Handle kick agent
  const handleKickAgent = async (targetAgentId: string) => {
    if (!connector) return

    if (targetAgentId === currentAgentName) {
      alert(t("agents.messages.kickSelf"))
      return
    }

    try {
      const confirmed = await confirm(
        t("agents.kickConfirm.title"),
        t("agents.kickConfirm.message", { name: targetAgentId }),
        {
          confirmText: t("agents.kickConfirm.confirm"),
          cancelText: t("agents.kickConfirm.cancel"),
          type: "warning",
        }
      )

      if (!confirmed) {
        return
      }

      setKickingAgentId(targetAgentId)

      const response = await connector.sendEvent({
        event_name: "system.kick_agent",
        source_id: currentAgentName || "system",
        payload: {
          target_agent_id: targetAgentId,
        },
      })

      if (response.success) {
        console.log(`✅ Successfully kicked agent: ${targetAgentId}`)

        setAgents((prevAgents) =>
          prevAgents.map((agent) =>
            agent.agent_id === targetAgentId
              ? { ...agent, status: "offline", isKicked: true }
              : agent
          )
        )

        toast.success(
          t("agents.messages.kickSuccess", { name: targetAgentId }),
          {
            description: t("agents.messages.kickSuccessDesc"),
          }
        )
      } else {
        console.error(`❌ Failed to kick agent: ${response.message}`)
        setError(response.message || t("agents.messages.kickError"))
      }
    } catch (err) {
      console.error("Error kicking agent:", err)
      setError(
        err instanceof Error ? err.message : t("agents.messages.kickError")
      )
    } finally {
      setKickingAgentId(null)
    }
  }

  // Define columns for DataTable
  const columns: ColumnDef<AgentInfo>[] = useMemo(
    () => [
      {
        accessorKey: "agent_id",
        header: t("agents.table.id"),
        cell: ({ row }) => {
          const agent = row.original
          return (
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
                    {t("agents.you")}
                  </div>
                )}
              </div>
            </div>
          )
        },
      },
      {
        accessorKey: "groups",
        header: t("agents.table.group"),
        cell: ({ row }) => {
          const agentGroups = getAgentGroups(row.original.agent_id)
          return (
            <div className="flex flex-wrap gap-1">
              {agentGroups.length > 0 ? (
                agentGroups.map((group) => (
                  <Badge
                    key={group}
                    variant={group === "admin" ? "info" : "secondary"}
                    appearance="light"
                    size="sm"
                  >
                    {group}
                  </Badge>
                ))
              ) : (
                <span className="text-gray-400 dark:text-gray-500 text-xs">
                  -
                </span>
              )}
            </div>
          )
        },
      },
      {
        accessorKey: "status",
        header: t("agents.table.status"),
        cell: ({ row }) => {
          const agent = row.original
          const isOffline = agent.status === "offline" || agent.isKicked
          return (
            <span
              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                isOffline
                  ? "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                  : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                  isOffline ? "bg-gray-400" : "bg-green-500"
                }`}
              />
              {isOffline ? t("agents.statusOffline") : t("agents.statusOnline")}
            </span>
          )
        },
      },
      {
        id: "actions",
        header: () => (
          <div className="text-center">{t("agents.table.actions")}</div>
        ),
        cell: ({ row }) => {
          const agent = row.original
          const isKicking = kickingAgentId === agent.agent_id
          const canKick =
            agent.agent_id !== currentAgentName &&
            agent.status !== "offline" &&
            !agent.isKicked

          return (
            <div className="text-center">
              <Button
                onClick={(e) => {
                  e.stopPropagation()
                  handleKickAgent(agent.agent_id)
                }}
                disabled={isKicking || !canKick}
                variant="destructive"
                size="sm"
              >
                {isKicking ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                    {t("agents.kicking")}
                  </>
                ) : (
                  <>
                    <X className="w-3 h-3 mr-1.5" />
                    {t("agents.kick")}
                  </>
                )}
              </Button>
            </div>
          )
        },
      },
    ],
    [t, currentAgentName, kickingAgentId, getAgentGroups]
  )

  // Stats data
  const totalAgents = agents.length
  const onlineAgents = agents.filter((a) => a.status === "online").length

  return (
    <div className="p-6 dark:bg-zinc-950 h-full min-h-screen overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("agents.title")}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {t("agents.subtitle")}
          </p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <p className="ml-3 text-sm text-red-800 dark:text-red-200">
              {error}
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="bg-white dark:bg-zinc-900 overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
              {t("agents.total")}
            </dt>
            <dd className="mt-1 text-3xl font-semibold text-gray-900 dark:text-gray-100">
              {totalAgents}
            </dd>
          </div>
        </div>
        <div className="bg-white dark:bg-zinc-900 overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
              {t("agents.online")}
            </dt>
            <dd className="mt-1 text-3xl font-semibold text-green-600 dark:text-green-400">
              {onlineAgents}
            </dd>
          </div>
        </div>
      </div>

      {/* Agents Table */}
      <DataTable
        columns={columns}
        data={enrichedAgents}
        loading={loading}
        searchable={true}
        searchPlaceholder={t("agents.searchPlaceholder", "搜索智能体...")}
        searchColumn="agent_id"
        pagination={true}
        pageSize={10}
        emptyMessage={t("agents.empty")}
        emptyIcon={<Users className="w-12 h-12 text-gray-400" />}
        toolbar={
          <Button
            onClick={fetchAgents}
            disabled={loading}
            variant="outline"
            size="sm"
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            {t("agents.refresh")}
          </Button>
        }
      />
    </div>
  )
}

export default AgentManagement
