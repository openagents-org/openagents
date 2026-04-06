import React from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription } from "@/components/layout/ui/card";
import { ExternalLink, Server, FileDown, Lock } from "lucide-react";

const QuickActionsGrid: React.FC = () => {
  const { t } = useTranslation("admin");
  const navigate = useNavigate();

  const quickActions = [
    {
      icon: ExternalLink,
      title: t("dashboard.quickActions.publishNetwork"),
      description: t("dashboard.quickActions.publishNetworkDesc"),
      route: "/admin/publish",
      color: "bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400",
      tourId: "publish-network",
    },
    {
      icon: Server,
      title: t("sidebar.items.serviceAgents"),
      description: t("dashboard.menuGroups.serviceAgentsDesc"),
      route: "/admin/service-agents",
      color: "bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400",
    },
    {
      icon: FileDown,
      title: t("dashboard.quickActions.importExport"),
      description: t("dashboard.quickActions.importExportDesc"),
      route: "/admin/import-export",
      color: "bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-400",
    },
    {
      icon: Lock,
      title: t("dashboard.quickActions.updateAdminPassword"),
      description: t("dashboard.quickActions.updateAdminPasswordDesc"),
      route: "/admin/groups?changePassword=admin",
      color: "bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-400",
    },
  ];

  return (
    <div className="mb-4" data-tour="quick-actions">
      <h2 className="text-lg font-semibold text-foreground mb-3">
        {t("dashboard.quickActions.title")}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {quickActions.map((action, index) => (
          <Card
            key={index}
            className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
            onClick={() => navigate(action.route)}
            data-tour={action.tourId}
          >
            <CardContent className="flex items-center space-x-3 p-4">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${action.color}`}
              >
                <action.icon className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{action.title}</div>
                <CardDescription className="text-xs mt-0.5">
                  {action.description}
                </CardDescription>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default QuickActionsGrid;
