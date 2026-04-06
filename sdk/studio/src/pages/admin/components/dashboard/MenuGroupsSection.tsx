import React from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription } from "@/components/layout/ui/card";
import {
  Users,
  Globe,
  ArrowLeftRight,
  FileDown,
  UserCog,
  Link2,
  Settings,
  FileText,
  Search,
  Monitor,
  Bug,
  Server,
  ExternalLink,
} from "lucide-react";

interface MenuGroupProps {
  title: string;
  items: Array<{
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    description: string;
    route: string;
    color: string;
    tourId?: string;
  }>;
}

const MenuGroup: React.FC<MenuGroupProps> = ({ title, items }) => {
  const navigate = useNavigate();

  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        {title}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {items.map((item, index) => (
          <Card
            key={index}
            className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
            onClick={() => navigate(item.route)}
            data-tour={item.tourId}
          >
            <CardContent className="flex items-center space-x-3 p-4">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${item.color}`}
              >
                <item.icon className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{item.title}</div>
                <CardDescription className="text-xs mt-0.5">
                  {item.description}
                </CardDescription>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

const MenuGroupsSection: React.FC = () => {
  const { t } = useTranslation("admin");

  const networkItems = [
    {
      icon: Globe,
      title: t("dashboard.quickActions.networkProfile"),
      description: t("dashboard.quickActions.networkProfileDesc"),
      route: "/admin/network",
      color: "bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400",
    },
    {
      icon: ArrowLeftRight,
      title: t("dashboard.quickActions.transports"),
      description: t("dashboard.quickActions.transportsDesc"),
      route: "/admin/transports",
      color: "bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400",
    },
    {
      icon: ExternalLink,
      title: t("dashboard.quickActions.publishNetwork"),
      description: t("dashboard.quickActions.publishNetworkDesc"),
      route: "/admin/publish",
      color: "bg-cyan-100 dark:bg-cyan-900 text-cyan-600 dark:text-cyan-400",
    },
    {
      icon: FileDown,
      title: t("dashboard.quickActions.importExport"),
      description: t("dashboard.quickActions.importExportDesc"),
      route: "/admin/import-export",
      color: "bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-400",
    },
  ];

  const agentsItems = [
    {
      icon: Users,
      title: t("dashboard.quickActions.connectedAgents"),
      description: t("dashboard.quickActions.connectedAgentsDesc"),
      route: "/admin/agents",
      color: "bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400",
    },
    {
      icon: UserCog,
      title: t("dashboard.quickActions.agentGroups"),
      description: t("dashboard.quickActions.agentGroupsDesc"),
      route: "/admin/groups",
      color: "bg-amber-100 dark:bg-amber-900 text-amber-600 dark:text-amber-400",
      tourId: "agent-groups",
    },
    {
      icon: Server,
      title: t("sidebar.items.serviceAgents"),
      description: t("dashboard.menuGroups.serviceAgentsDesc"),
      route: "/admin/service-agents",
      color: "bg-teal-100 dark:bg-teal-900 text-teal-600 dark:text-teal-400",
    },
    {
      icon: Link2,
      title: t("dashboard.quickActions.connectionGuide"),
      description: t("dashboard.quickActions.connectionGuideDesc"),
      route: "/admin/connect",
      color: "bg-cyan-100 dark:bg-cyan-900 text-cyan-600 dark:text-cyan-400",
    },
  ];

  const modulesItems = [
    {
      icon: Settings,
      title: t("dashboard.quickActions.modManagement"),
      description: t("dashboard.quickActions.modManagementDesc"),
      route: "/admin/mods",
      color: "bg-pink-100 dark:bg-pink-900 text-pink-600 dark:text-pink-400",
    },
  ];

  const monitoringItems = [
    {
      icon: FileText,
      title: t("dashboard.quickActions.eventLogs"),
      description: t("dashboard.quickActions.eventLogsDesc"),
      route: "/admin/events",
      color: "bg-cyan-100 dark:bg-cyan-900 text-cyan-600 dark:text-cyan-400",
    },
    {
      icon: Search,
      title: t("sidebar.items.eventExplorer"),
      description: t("dashboard.menuGroups.eventExplorerDesc"),
      route: "/admin/event-explorer",
      color: "bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400",
    },
    {
      icon: Monitor,
      title: t("sidebar.items.llmLogs"),
      description: t("dashboard.menuGroups.llmLogsDesc"),
      route: "/admin/llm-logs",
      color: "bg-violet-100 dark:bg-violet-900 text-violet-600 dark:text-violet-400",
    },
    {
      icon: Bug,
      title: t("dashboard.quickActions.eventDebugger"),
      description: t("dashboard.quickActions.eventDebuggerDesc"),
      route: "/admin/debugger",
      color: "bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-400",
    },
  ];

  return (
    <div className="space-y-4">
      <MenuGroup title={t("sidebar.sections.network")} items={networkItems} />
      <MenuGroup title={t("sidebar.sections.agents")} items={agentsItems} />
      <MenuGroup title={t("sidebar.sections.modules")} items={modulesItems} />
      <MenuGroup title={t("sidebar.sections.monitoring")} items={monitoringItems} />
    </div>
  );
};

export default MenuGroupsSection;
