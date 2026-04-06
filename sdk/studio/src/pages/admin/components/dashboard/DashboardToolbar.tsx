import React from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/layout/ui/button"
import { Badge } from "@/components/layout/ui/badge"
import {
  Users,
  MessageCircle,
  Clock,
  HelpCircle,
  RefreshCw,
} from "lucide-react"

interface DashboardStats {
  totalAgents: number
  onlineAgents: number
  activeChannels: number
  totalChannels: number
  uptime: string
  eventsPerMinute: number
  totalGroups: number
}

interface DashboardToolbarProps {
  stats: DashboardStats
  refreshing: boolean
  onRefresh: () => void
  onStartTour: () => void
}

const DashboardToolbar: React.FC<DashboardToolbarProps> = ({
  stats,
  refreshing,
  onRefresh,
  onStartTour,
}) => {
  const { t } = useTranslation("admin")
  const navigate = useNavigate()

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* Stats Tags */}
        <div className="flex flex-wrap items-center gap-2" data-tour="stats">
          <Badge
            variant="info"
            appearance="light"
            shape="default"
            className="cursor-pointer"
            onClick={() => navigate("/admin/agents")}
          >
            <Users className="w-3 h-3 mr-1" />
            {stats.onlineAgents}/{stats.totalAgents}{" "}
            {t("dashboard.stats.agents")}
          </Badge>
          <Badge
            variant="success"
            appearance="light"
            shape="default"
            className="cursor-pointer"
            onClick={() => navigate("/admin/events")}
          >
            <MessageCircle className="w-3 h-3 mr-1" />
            {stats.activeChannels}/{stats.totalChannels}{" "}
            {t("dashboard.stats.channels")}
          </Badge>
          <Badge variant="info" appearance="light" shape="default">
            <Clock className="w-3 h-3 mr-1" />
            {stats.uptime}
          </Badge>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Button
          onClick={onStartTour}
          variant="outline"
          title={t("dashboard.quickActions.startTour")}
        >
          <HelpCircle className="w-3 h-3 mr-1.5" />
          {t("dashboard.quickActions.startTour")}
        </Button>
        <Button onClick={onRefresh} disabled={refreshing} variant="outline">
          <RefreshCw
            className={`w-3 h-3 mr-1.5 ${refreshing ? "animate-spin" : ""}`}
          />
          {refreshing ? t("dashboard.refreshing") : t("dashboard.refresh")}
        </Button>
      </div>
    </div>
  )
}

export default DashboardToolbar
