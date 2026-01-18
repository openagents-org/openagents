import React, { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useOpenAgents } from "@/context/OpenAgentsProvider"
import { useAuthStore } from "@/stores/authStore"
import { useConfirm } from "@/context/ConfirmContext"
import { toast } from "sonner"
import DashboardTour from "@/components/admin/DashboardTour"
import { Button } from "@/components/layout/ui/button"
import { ScrollArea } from "@/components/layout/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/layout/ui/dialog"
import { SkeletonLoader } from "@/components/layout/ui/skeleton-loader"
import { lookupNetworkPublication } from "@/services/networkService"
import {
  getServiceAgents,
  startServiceAgent,
  stopServiceAgent,
  type ServiceAgent,
} from "@/services/serviceAgentsApi"
import { networkFetch } from "@/utils/httpClient"

// Import dashboard components
import {
  DashboardToolbar,
  NetworkStatusPanel,
  DefaultLLMPanel,
  ServiceAgentsPanel,
  QuickActionsGrid,
  MenuGroupsSection,
} from "./components/dashboard"

interface DefaultModelConfig {
  provider: string
  model_name: string
  api_key?: string
  base_url?: string
}

interface DashboardStats {
  totalAgents: number
  onlineAgents: number
  activeChannels: number
  totalChannels: number
  uptime: string
  eventsPerMinute: number
  totalGroups: number
}

interface TransportInfo {
  type: string
  port: number
  enabled: boolean
  host?: string
  mcp_enabled?: boolean
  studio_enabled?: boolean
  [key: string]: any
}

const AdminDashboard: React.FC = () => {
  const { t } = useTranslation("admin")
  const { connector } = useOpenAgents()
  const { selectedNetwork, agentName } = useAuthStore()
  const { confirm } = useConfirm()

  const [stats, setStats] = useState<DashboardStats>({
    totalAgents: 0,
    onlineAgents: 0,
    activeChannels: 0,
    totalChannels: 0,
    uptime: "0h 0m",
    eventsPerMinute: 0,
    totalGroups: 0,
  })

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showBroadcastModal, setShowBroadcastModal] = useState(false)
  const [broadcastMessage, setBroadcastMessage] = useState("")
  const [sendingBroadcast, setSendingBroadcast] = useState(false)
  const [showTour, setShowTour] = useState(false)
  const [transports, setTransports] = useState<TransportInfo[]>([])
  const [networkPublication, setNetworkPublication] = useState<{
    published: boolean
    networkId?: string
    networkName?: string
    loading: boolean
  }>({ published: false, loading: true })
  const [networkUuid, setNetworkUuid] = useState<string | null>(null)
  const [serviceAgents, setServiceAgents] = useState<ServiceAgent[]>([])
  const [bulkActionLoading, setBulkActionLoading] = useState<
    "startAll" | "stopAll" | null
  >(null)
  const [defaultModelConfig, setDefaultModelConfig] =
    useState<DefaultModelConfig | null>(null)

  // Check if user has seen the tour
  useEffect(() => {
    const hasSeenTour = localStorage.getItem("admin-dashboard-tour-seen")
    if (!hasSeenTour) {
      setTimeout(() => {
        setShowTour(true)
      }, 1000)
    }
  }, [])

  const tourSteps = [
    {
      target: '[data-tour="stats"]',
      title: t("tour.step1.title"),
      content: t("tour.step1.content"),
      position: "bottom" as const,
    },
    {
      target: '[data-tour="quick-actions"]',
      title: t("tour.step2.title"),
      content: t("tour.step2.content"),
      position: "bottom" as const,
    },
    {
      target: '[data-tour="agent-groups"]',
      title: t("tour.step3.title"),
      content: t("tour.step3.content"),
      position: "bottom" as const,
    },
    {
      target: '[data-tour="publish-network"]',
      title: t("tour.step4.title"),
      content: t("tour.step4.content"),
      position: "bottom" as const,
    },
  ]

  const handleTourComplete = () => {
    setShowTour(false)
    localStorage.setItem("admin-dashboard-tour-seen", "true")
  }

  const handleTourClose = () => {
    setShowTour(false)
    localStorage.setItem("admin-dashboard-tour-seen", "true")
  }

  const startTour = () => {
    setShowTour(true)
  }

  const fetchDashboardData = useCallback(async () => {
    if (!connector) {
      setLoading(false)
      return
    }

    try {
      setRefreshing(true)
      const healthData = await connector.getNetworkHealth()

      const agents = healthData?.agents || {}
      const agentsList = Object.values(agents)
      const totalAgents = agentsList.length
      const onlineAgents = agentsList.filter(
        (agent: any) =>
          agent.status === "online" || agent.status === "connected"
      ).length

      const channels = healthData?.channels || {}
      const totalChannels = Object.keys(channels).length
      const activeChannels = Object.values(channels).filter(
        (channel: any) => channel.active !== false
      ).length

      const groups = healthData?.groups || {}
      const totalGroups = Object.keys(groups).length

      const uptimeSeconds = healthData?.uptime_seconds
      const uptime =
        uptimeSeconds !== undefined && uptimeSeconds !== null
          ? `${Number(uptimeSeconds).toFixed(3)}s`
          : "N/A"

      if (healthData?.network_uuid) {
        setNetworkUuid(healthData.network_uuid)
      }

      const eventsPerMinute = 0

      setStats({
        totalAgents,
        onlineAgents,
        activeChannels,
        totalChannels,
        uptime,
        eventsPerMinute,
        totalGroups,
      })

      const transportData = healthData?.transports || []
      const transportList: TransportInfo[] = transportData.map((t: any) => ({
        type: t.type || "unknown",
        port: t.config?.port || t.port || 0,
        enabled: t.enabled !== false,
        host: t.config?.host || t.host || "0.0.0.0",
        mcp_enabled:
          t.config?.serve_mcp ||
          t.config?.mcp_enabled ||
          t.serve_mcp ||
          t.mcp_enabled,
        studio_enabled:
          t.config?.serve_studio ||
          t.config?.studio_enabled ||
          t.serve_studio ||
          t.studio_enabled,
        ...t.config,
      }))
      setTransports(transportList)

      try {
        const agents = await getServiceAgents()
        setServiceAgents(agents)
      } catch (serviceAgentsError) {
        console.error("Failed to fetch service agents:", serviceAgentsError)
        setServiceAgents([])
      }

      if (selectedNetwork) {
        try {
          const response = await networkFetch(
            selectedNetwork.host,
            selectedNetwork.port,
            "/api/admin/default-model",
            {
              method: "GET",
              headers: { "Content-Type": "application/json" },
              useHttps: selectedNetwork.useHttps,
            }
          )
          if (response.ok) {
            const data = await response.json()
            if (data.success && data.config) {
              setDefaultModelConfig(data.config)
            } else {
              setDefaultModelConfig(null)
            }
          }
        } catch (modelConfigError) {
          console.error(
            "Failed to fetch default model config:",
            modelConfigError
          )
          setDefaultModelConfig(null)
        }
      }
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error)
      toast.error("Failed to load dashboard data")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [connector, selectedNetwork])

  useEffect(() => {
    fetchDashboardData()
    const interval = setInterval(fetchDashboardData, 30000)
    return () => clearInterval(interval)
  }, [fetchDashboardData])

  useEffect(() => {
    const checkPublication = async () => {
      if (!networkUuid) {
        setNetworkPublication({ published: false, loading: false })
        return
      }

      setNetworkPublication((prev) => ({ ...prev, loading: true }))
      const result = await lookupNetworkPublication({ networkUuid })
      setNetworkPublication({
        published: result.published,
        networkId: result.networkId,
        networkName: result.networkName,
        loading: false,
      })
    }

    checkPublication()
  }, [networkUuid])

  const handleStartAllAgents = async () => {
    const stoppedAgents = serviceAgents.filter(
      (a) => a.status === "stopped" || a.status === "error"
    )
    if (stoppedAgents.length === 0) {
      toast.info(t("dashboard.serviceAgents.allRunning"))
      return
    }

    setBulkActionLoading("startAll")
    let successCount = 0
    let failCount = 0
    let modelConfigError = false

    for (const agent of stoppedAgents) {
      try {
        await startServiceAgent(agent.agent_id)
        successCount++
      } catch (err: any) {
        console.error(`Failed to start agent ${agent.agent_id}:`, err)
        failCount++
        const errorMessage = err?.message || ""
        if (
          errorMessage.includes("auto") &&
          (errorMessage.includes("default LLM provider") ||
            errorMessage.includes("default model") ||
            errorMessage.includes("API key") ||
            errorMessage.includes("Default Model Configuration"))
        ) {
          modelConfigError = true
        }
      }
    }

    setBulkActionLoading(null)
    await fetchDashboardData()

    if (failCount === 0) {
      toast.success(
        t("dashboard.serviceAgents.startAllSuccess", { count: successCount })
      )
    } else if (modelConfigError) {
      toast.error(
        t("dashboard.serviceAgents.startAllModelConfigError", {
          success: successCount,
          failed: failCount,
        }),
        { duration: 6000 }
      )
    } else {
      toast.warning(
        t("dashboard.serviceAgents.startAllPartial", {
          success: successCount,
          failed: failCount,
        })
      )
    }
  }

  const handleStopAllAgents = async () => {
    const runningAgents = serviceAgents.filter((a) => a.status === "running")
    if (runningAgents.length === 0) {
      toast.info(t("dashboard.serviceAgents.allStopped"))
      return
    }

    setBulkActionLoading("stopAll")
    let successCount = 0
    let failCount = 0

    for (const agent of runningAgents) {
      try {
        await stopServiceAgent(agent.agent_id)
        successCount++
      } catch (err) {
        console.error(`Failed to stop agent ${agent.agent_id}:`, err)
        failCount++
      }
    }

    setBulkActionLoading(null)
    await fetchDashboardData()

    if (failCount === 0) {
      toast.success(
        t("dashboard.serviceAgents.stopAllSuccess", { count: successCount })
      )
    } else {
      toast.warning(
        t("dashboard.serviceAgents.stopAllPartial", {
          success: successCount,
          failed: failCount,
        })
      )
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleRestartNetwork = async () => {
    const confirmed = await confirm(
      t("dashboard.restart.title"),
      t("dashboard.restart.confirm"),
      {
        type: "danger",
        confirmText: t("dashboard.restart.restart"),
        cancelText: t("dashboard.restart.cancel"),
      }
    )
    if (!confirmed || !connector) {
      return
    }

    try {
      toast.info(t("dashboard.restart.requested"))
      setTimeout(() => {
        fetchDashboardData()
      }, 2000)
    } catch (error) {
      console.error("Failed to restart network:", error)
      toast.error(t("dashboard.restart.failed"))
    }
  }

  const handleSendBroadcast = async () => {
    if (!broadcastMessage.trim() || !connector) {
      toast.error(t("dashboard.broadcast.enterMessage"))
      return
    }

    try {
      setSendingBroadcast(true)

      const response = await connector.sendEvent({
        event_name: "mod:openagents.mods.communication.simple_messaging",
        source_id: agentName || "admin",
        destination_id: "agent:broadcast",
        payload: {
          text: broadcastMessage.trim(),
          type: "broadcast",
        },
      })

      if (response.success) {
        toast.success(t("dashboard.broadcast.success"))
        setBroadcastMessage("")
        setShowBroadcastModal(false)
        fetchDashboardData()
      } else {
        toast.error(response.message || t("dashboard.broadcast.failed"))
      }
    } catch (error) {
      console.error("Failed to send broadcast:", error)
      toast.error(t("dashboard.broadcast.failed"))
    } finally {
      setSendingBroadcast(false)
    }
  }

  if (loading) {
    return (
      <ScrollArea className="h-full">
        <div className="p-4 space-y-4">
          {/* Dashboard Toolbar Skeleton */}
          <SkeletonLoader variant="card" rows={2} showHeader={false} />

          {/* Network Status Panel Skeleton */}
          <SkeletonLoader variant="card" rows={3} showHeader={true} />

          {/* Default LLM and Service Agents Panels Skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SkeletonLoader variant="card" rows={3} />
            <SkeletonLoader variant="card" rows={3} />
          </div>

          {/* Quick Actions Skeleton */}
          <SkeletonLoader variant="card" rows={2} />
        </div>
      </ScrollArea>
    )
  }

  return (
    <>
      <ScrollArea className="h-full dark:bg-zinc-950">
        <div className="p-4">
          {/* Dashboard Toolbar with Stats */}
          <DashboardToolbar
            stats={stats}
            refreshing={refreshing}
            onRefresh={fetchDashboardData}
            onStartTour={startTour}
          />

          {/* Network Status Panel */}
          <NetworkStatusPanel
            selectedNetwork={selectedNetwork}
            transports={transports}
            networkPublication={networkPublication}
            refreshing={refreshing}
            onRefresh={fetchDashboardData}
          />

          {/* Default LLM and Service Agents Panels - Side by Side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <DefaultLLMPanel defaultModelConfig={defaultModelConfig} />
            <ServiceAgentsPanel
              serviceAgents={serviceAgents}
              bulkActionLoading={bulkActionLoading}
              onStartAll={handleStartAllAgents}
              onStopAll={handleStopAllAgents}
            />
          </div>

          {/* Quick Actions */}
          <QuickActionsGrid />

          {/* Menu Groups */}
          <MenuGroupsSection />
        </div>
      </ScrollArea>

      {/* Broadcast Message Modal */}
      <Dialog
        open={showBroadcastModal}
        onOpenChange={(open) => {
          if (!open) {
            setShowBroadcastModal(false)
            setBroadcastMessage("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dashboard.broadcast.title")}</DialogTitle>
            <DialogDescription>
              {t("dashboard.broadcast.subtitle")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <textarea
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              placeholder={t("dashboard.broadcast.placeholder")}
              rows={6}
              className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              disabled={sendingBroadcast}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowBroadcastModal(false)
                setBroadcastMessage("")
              }}
              disabled={sendingBroadcast}
            >
              {t("dashboard.broadcast.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleSendBroadcast}
              disabled={sendingBroadcast || !broadcastMessage.trim()}
            >
              {sendingBroadcast
                ? t("dashboard.broadcast.sending")
                : t("dashboard.broadcast.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dashboard Tour */}
      <DashboardTour
        steps={tourSteps}
        isActive={showTour}
        onClose={handleTourClose}
        onComplete={handleTourComplete}
      />
    </>
  )
}

export default AdminDashboard
