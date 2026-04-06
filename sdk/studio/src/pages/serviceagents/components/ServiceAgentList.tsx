import React, { useState, useEffect, useCallback, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import { ColumnDef } from "@tanstack/react-table"
import {
  getServiceAgents,
  startServiceAgent,
  stopServiceAgent,
  restartServiceAgent,
  getGlobalEnvVars,
  saveGlobalEnvVars,
  type ServiceAgent,
  type AgentEnvVars,
} from "@/services/serviceAgentsApi"
import { DataTable } from "@/components/layout/ui/data-table"
import { Button } from "@/components/layout/ui/button"
import { Badge } from "@/components/layout/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardHeading,
  CardTitle,
  CardToolbar,
} from "@/components/layout/ui/card"
import {
  AlertCircle,
  RefreshCw,
  FileText,
  Eye,
  EyeOff,
  Play,
  Square,
  Loader2,
  Settings,
  Plus,
  Trash2,
  Save,
  ChevronDown,
  ChevronUp,
  Cpu,
  ChevronRight,
} from "lucide-react"

// Helper to check if a variable name is sensitive (should be masked)
const isSensitiveVariable = (name: string): boolean => {
  const sensitivePatterns = [
    "KEY",
    "SECRET",
    "TOKEN",
    "PASSWORD",
    "CREDENTIAL",
    "AUTH",
  ]
  const upperName = name.toUpperCase()
  return sensitivePatterns.some((pattern) => upperName.includes(pattern))
}

// Helper to mask a value
const maskValue = (value: string): string => {
  if (!value || value.length <= 8) return "••••••••"
  return value.substring(0, 4) + "••••••••" + value.substring(value.length - 4)
}

/**
 * Service Agent List Component
 * Displays all service agents with status indicators and control buttons
 */
const ServiceAgentList: React.FC = () => {
  const { t } = useTranslation("serviceAgent")
  const [agents, setAgents] = useState<ServiceAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>(
    {}
  )
  const navigate = useNavigate()

  // Global environment variables state
  const [globalEnvExpanded, setGlobalEnvExpanded] = useState(false)
  const [globalEnvVars, setGlobalEnvVars] = useState<AgentEnvVars>({})
  const [originalGlobalEnvVars, setOriginalGlobalEnvVars] =
    useState<AgentEnvVars>({})
  const [loadingGlobalEnv, setLoadingGlobalEnv] = useState(false)
  const [savingGlobalEnv, setSavingGlobalEnv] = useState(false)
  const [globalEnvFetched, setGlobalEnvFetched] = useState(false)
  const [newGlobalEnvName, setNewGlobalEnvName] = useState("")
  const [newGlobalEnvValue, setNewGlobalEnvValue] = useState("")
  const [visibleSensitiveVars, setVisibleSensitiveVars] = useState<Set<string>>(
    new Set()
  )

  // Fetch agents
  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await getServiceAgents()
      setAgents(data)
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : t("list.messages.fetchFailed")
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setLoading(false)
    }
  }, [t])

  // Initial load
  useEffect(() => {
    fetchAgents()
    // Auto-refresh every 5 seconds
    const interval = setInterval(fetchAgents, 5000)
    return () => clearInterval(interval)
  }, [fetchAgents])

  // Fetch global environment variables when expanded
  const fetchGlobalEnvVars = useCallback(async () => {
    try {
      setLoadingGlobalEnv(true)
      const envVars = await getGlobalEnvVars()
      setGlobalEnvVars(envVars)
      setOriginalGlobalEnvVars(envVars)
    } catch (err) {
      console.error("Failed to fetch global env vars:", err)
      toast.error(t("list.globalEnv.fetchFailed"))
    } finally {
      setLoadingGlobalEnv(false)
      setGlobalEnvFetched(true)
    }
  }, [t])

  useEffect(() => {
    if (globalEnvExpanded && !globalEnvFetched && !loadingGlobalEnv) {
      fetchGlobalEnvVars()
    }
  }, [
    globalEnvExpanded,
    globalEnvFetched,
    loadingGlobalEnv,
    fetchGlobalEnvVars,
  ])

  // Handle adding new global env var
  const handleAddGlobalEnvVar = () => {
    const name = newGlobalEnvName.trim()
    if (!name) {
      toast.error(t("list.globalEnv.variableNameRequired"))
      return
    }
    if (globalEnvVars[name] !== undefined) {
      toast.error(t("list.globalEnv.variableExists"))
      return
    }
    setGlobalEnvVars({ ...globalEnvVars, [name]: newGlobalEnvValue })
    setNewGlobalEnvName("")
    setNewGlobalEnvValue("")
  }

  // Handle deleting global env var
  const handleDeleteGlobalEnvVar = (name: string) => {
    const newEnvVars = { ...globalEnvVars }
    delete newEnvVars[name]
    setGlobalEnvVars(newEnvVars)
  }

  // Handle updating global env var value
  const handleUpdateGlobalEnvVar = (name: string, value: string) => {
    setGlobalEnvVars({ ...globalEnvVars, [name]: value })
  }

  // Toggle visibility of sensitive variable
  const toggleSensitiveVarVisibility = (name: string) => {
    setVisibleSensitiveVars((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(name)) {
        newSet.delete(name)
      } else {
        newSet.add(name)
      }
      return newSet
    })
  }

  // Handle saving global env vars
  const handleSaveGlobalEnvVars = async () => {
    try {
      setSavingGlobalEnv(true)
      await saveGlobalEnvVars(globalEnvVars)
      setOriginalGlobalEnvVars(globalEnvVars)
      toast.success(t("list.globalEnv.saveSuccess"))
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : t("list.globalEnv.saveFailed")
      toast.error(errorMessage)
    } finally {
      setSavingGlobalEnv(false)
    }
  }

  // Check if global env vars have changed
  const hasGlobalEnvChanges =
    JSON.stringify(globalEnvVars) !== JSON.stringify(originalGlobalEnvVars)

  // Handle agent action (start/stop/restart)
  const handleAction = async (
    agentId: string,
    action: "start" | "stop" | "restart"
  ) => {
    try {
      setActionLoading((prev) => ({ ...prev, [agentId]: true }))

      switch (action) {
        case "start":
          await startServiceAgent(agentId)
          toast.success(t("list.messages.started", { id: agentId }))
          break
        case "stop":
          await stopServiceAgent(agentId)
          toast.success(t("list.messages.stopped", { id: agentId }))
          break
        case "restart":
          await restartServiceAgent(agentId)
          toast.success(t("list.messages.restarted", { id: agentId }))
          break
      }

      // Refresh agents list after action
      await fetchAgents()
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : t("list.messages.failed")
      toast.error(errorMessage)
    } finally {
      setActionLoading((prev) => ({ ...prev, [agentId]: false }))
    }
  }

  // Get status badge variant
  const getStatusVariant = (
    status: string
  ): "success" | "destructive" | "warning" | "secondary" => {
    switch (status) {
      case "running":
        return "success"
      case "stopped":
        return "secondary"
      case "error":
        return "destructive"
      case "starting":
      case "stopping":
        return "warning"
      default:
        return "secondary"
    }
  }

  // Get status text
  const getStatusText = (status: string) => {
    switch (status) {
      case "running":
        return t("list.status.running")
      case "stopped":
        return t("list.status.stopped")
      case "error":
        return t("list.status.error")
      case "starting":
        return t("list.status.starting")
      case "stopping":
        return t("list.status.stopping")
      default:
        return status
    }
  }

  // Define columns for DataTable
  const columns: ColumnDef<ServiceAgent>[] = useMemo(
    () => [
      {
        accessorKey: "agent_id",
        header: t("list.table.agentId"),
        cell: ({ row }) => (
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {row.original.agent_id}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: t("list.table.status"),
        cell: ({ row }) => {
          const status = row.original.status
          const isRunning = status === "running"
          const isError = status === "error"
          const isStopped = status === "stopped"
          return (
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                isRunning
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : isError
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : isStopped
                  ? "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                  : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                  isRunning
                    ? "bg-green-500"
                    : isError
                    ? "bg-red-500"
                    : isStopped
                    ? "bg-gray-400"
                    : "bg-yellow-500"
                }`}
              />
              {getStatusText(status)}
            </span>
          )
        },
      },
      {
        accessorKey: "file_type",
        header: t("list.table.type"),
        cell: ({ row }) => (
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {row.original.file_type?.toUpperCase() || "-"}
          </span>
        ),
      },
      {
        accessorKey: "pid",
        header: t("list.table.pid"),
        cell: ({ row }) => (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {row.original.pid || "-"}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => (
          <div className="text-center">{t("list.table.actions")}</div>
        ),
        cell: ({ row }) => {
          const agent = row.original
          const isLoading = actionLoading[agent.agent_id] || false
          const isRunning = agent.status === "running"

          return (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  navigate(`/admin/service-agents/${agent.agent_id}`)
                }}
              >
                <Eye className="w-4 h-4 mr-1" />
                {t("list.viewDetails")}
              </Button>

              {!isRunning && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleAction(agent.agent_id, "start")
                  }}
                  disabled={isLoading}
                  className="text-green-600 hover:text-green-700"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      {t("list.starting")}
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-1" />
                      {t("list.start")}
                    </>
                  )}
                </Button>
              )}

              {isRunning && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleAction(agent.agent_id, "stop")
                    }}
                    disabled={isLoading}
                    className="text-red-600 hover:text-red-700"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        {t("list.stopping")}
                      </>
                    ) : (
                      <>
                        <Square className="w-4 h-4 mr-1" />
                        {t("list.stop")}
                      </>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleAction(agent.agent_id, "restart")
                    }}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        {t("list.restarting")}
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 mr-1" />
                        {t("list.restart")}
                      </>
                    )}
                  </Button>
                </>
              )}
            </div>
          )
        },
      },
    ],
    [t, actionLoading, navigate]
  )

  // Error state
  if (error && agents.length === 0) {
    return (
      <div className="p-6 dark:bg-gray-900 h-full">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
                {t("list.loadFailed")}
              </h3>
              <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                {error}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchAgents}
                className="mt-2"
              >
                {t("list.retry")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 bg-white dark:bg-zinc-950 h-full min-h-screen overflow-y-auto">
      <Card variant="default" className="mb-6">
        <CardHeader>
          <CardHeading>
            <CardTitle>{t("list.title")}</CardTitle>
            <CardDescription>{t("list.subtitle")}</CardDescription>
          </CardHeading>
          <CardToolbar>
            <Button
              onClick={fetchAgents}
              disabled={loading}
              variant="outline"
              size="sm"
            >
              <RefreshCw
                className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`}
              />
              {loading ? t("list.refreshing") : t("list.refresh")}
            </Button>
          </CardToolbar>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Model Configuration - Link to Default Models Page */}
          <div className="bg-gray-50 dark:bg-zinc-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={() => navigate("/admin/default-models")}
              className="w-full flex items-center justify-between p-4 text-left dark: hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <div className="flex items-center space-x-3">
                <Cpu className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-gray-100">
                    {t("list.modelConfig.title")}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("list.modelConfig.subtitle")}
                  </p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          {/* Global Environment Variables */}
          <div className="mb-6 bg-white dark:bg-zinc-900 rounded-lg shadow">
            <button
              type="button"
              onClick={() => setGlobalEnvExpanded(!globalEnvExpanded)}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <div className="flex items-center space-x-3">
                <Settings className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-gray-100">
                    {t("list.globalEnv.title")}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("list.globalEnv.subtitle")}
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
                    <span className="ml-2 text-gray-600 dark:text-gray-400">
                      {t("list.globalEnv.loading")}
                    </span>
                  </div>
                ) : (
                  <>
                    {/* Add new variable */}
                    <div className="flex items-center space-x-2 mb-4">
                      <input
                        type="text"
                        placeholder={t("list.globalEnv.variableName")}
                        value={newGlobalEnvName}
                        onChange={(e) => setNewGlobalEnvName(e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="text"
                        placeholder={t("list.globalEnv.value")}
                        value={newGlobalEnvValue}
                        onChange={(e) => setNewGlobalEnvValue(e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                          {t("list.globalEnv.empty")}
                        </p>
                      ) : (
                        Object.entries(globalEnvVars).map(([name, value]) => {
                          const isSensitive = isSensitiveVariable(name)
                          const isVisible = visibleSensitiveVars.has(name)
                          const displayValue =
                            isSensitive && !isVisible ? maskValue(value) : value

                          return (
                            <div
                              key={name}
                              className="flex items-center space-x-2"
                            >
                              <input
                                type="text"
                                value={name}
                                disabled
                                className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-zinc-900 text-gray-700 dark:text-gray-300 text-sm"
                              />
                              <div className="flex-1 relative">
                                <input
                                  type={
                                    isSensitive && !isVisible
                                      ? "password"
                                      : "text"
                                  }
                                  value={
                                    isSensitive && !isVisible ? value : value
                                  }
                                  onChange={(e) =>
                                    handleUpdateGlobalEnvVar(
                                      name,
                                      e.target.value
                                    )
                                  }
                                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                                  placeholder={
                                    isSensitive && !isVisible
                                      ? displayValue
                                      : ""
                                  }
                                />
                                {isSensitive && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      toggleSensitiveVarVisibility(name)
                                    }
                                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                  >
                                    {isVisible ? (
                                      <EyeOff className="w-4 h-4" />
                                    ) : (
                                      <Eye className="w-4 h-4" />
                                    )}
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
                          )
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
                              {t("list.globalEnv.saving")}
                            </>
                          ) : (
                            <>
                              <Save className="w-4 h-4 mr-2" />
                              {t("list.globalEnv.saveChanges")}
                            </>
                          )}
                        </Button>
                      </div>
                    )}

                    {/* Note about restart */}
                    <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                      {t("list.globalEnv.note")}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Agents Table */}
          <DataTable
            columns={columns}
            data={agents}
            loading={loading && agents.length === 0}
            searchable={true}
            searchPlaceholder={t("list.searchPlaceholder")}
            searchColumn="agent_id"
            pagination={true}
            pageSize={10}
            emptyMessage={t("list.noAgents")}
            emptyIcon={<FileText className="w-12 h-12 text-gray-400" />}
            onRowClick={(row) =>
              navigate(`/admin/service-agents/${row.agent_id}`)
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}

export default ServiceAgentList
