import React from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/layout/ui/button"
import { Badge } from "@/components/layout/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardHeading,
  CardTitle,
  CardToolbar,
} from "@/components/layout/ui/card"
import { Server, Play, Square, Loader2 } from "lucide-react"
import type { ServiceAgent } from "@/services/serviceAgentsApi"

interface ServiceAgentsPanelProps {
  serviceAgents: ServiceAgent[]
  bulkActionLoading: "startAll" | "stopAll" | null
  onStartAll: () => void
  onStopAll: () => void
}

const ServiceAgentsPanel: React.FC<ServiceAgentsPanelProps> = ({
  serviceAgents,
  bulkActionLoading,
  onStartAll,
  onStopAll,
}) => {
  const { t } = useTranslation("admin")
  const navigate = useNavigate()

  const runningCount = serviceAgents.filter(
    (a) => a.status === "running"
  ).length
  const allRunning = serviceAgents.every((a) => a.status === "running")
  const noneRunning = serviceAgents.every((a) => a.status !== "running")

  return (
    <Card variant="default">
      <CardHeader>
        <CardHeading>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            {t("dashboard.serviceAgents.title")}
            {serviceAgents.length > 0 && (
              <Badge variant="secondary" appearance="light" size="sm">
                {runningCount}/{serviceAgents.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeading>
        <CardToolbar>
          {serviceAgents.length > 0 && (
            <>
              {/* Start All Button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={onStartAll}
                disabled={bulkActionLoading !== null || allRunning}
                className="text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/30"
                title={t("dashboard.serviceAgents.startAll")}
              >
                {bulkActionLoading === "startAll" ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <Play className="w-3 h-3 mr-1" />
                )}
                {t("dashboard.serviceAgents.startAll")}
              </Button>
              {/* Stop All Button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={onStopAll}
                disabled={bulkActionLoading !== null || noneRunning}
                className="text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30"
                title={t("dashboard.serviceAgents.stopAll")}
              >
                {bulkActionLoading === "stopAll" ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <Square className="w-3 h-3 mr-1" />
                )}
                {t("dashboard.serviceAgents.stopAll")}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/admin/service-agents")}
          >
            {t("dashboard.serviceAgents.viewAll")}
          </Button>
        </CardToolbar>
      </CardHeader>
      <CardContent>
        {serviceAgents.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {serviceAgents.map((agent) => (
              <Button
                key={agent.agent_id}
                onClick={() =>
                  navigate(`/admin/service-agents/${agent.agent_id}`)
                }
                variant="ghost"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all duration-200 cursor-pointer ${
                  agent.status === "running"
                    ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50 hover:shadow-md hover:-translate-y-0.5"
                    : agent.status === "error"
                    ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 hover:shadow-md hover:-translate-y-0.5"
                    : agent.status === "starting" || agent.status === "stopping"
                    ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-900/50 hover:shadow-md hover:-translate-y-0.5"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:shadow-md hover:-translate-y-0.5"
                }`}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    agent.status === "running"
                      ? "bg-green-500 animate-pulse"
                      : agent.status === "error"
                      ? "bg-red-500"
                      : agent.status === "starting" ||
                        agent.status === "stopping"
                      ? "bg-yellow-500 animate-pulse"
                      : "bg-gray-400"
                  }`}
                />
                {agent.agent_id}
              </Button>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500 dark:text-gray-400 italic">
            {t("dashboard.serviceAgents.noAgents")}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default ServiceAgentsPanel
