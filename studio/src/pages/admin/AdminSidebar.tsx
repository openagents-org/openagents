import React from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/layout/ui/button"
import {
  LayoutDashboard,
  Globe,
  ArrowLeftRight,
  Download,
  Users,
  UserCog,
  Server,
  Link2,
  Settings,
  FileText,
  Search,
  Monitor,
  Bug,
  Cpu,
  Wrench,
} from "lucide-react"

const AdminSidebar: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation("admin")

  // Always show all admin items in admin sidebar
  // Since user has already accessed admin area, they should have admin privileges
  // This prevents menu flickering during loading states

  const isActive = (path: string) => {
    const currentPath = location.pathname
    // Exact match for dashboard
    if (path === "/admin/dashboard") {
      return (
        currentPath === "/admin" ||
        currentPath === "/admin/" ||
        currentPath === "/admin/dashboard"
      )
    }
    // For other paths, check if current path starts with the path
    return currentPath === path || currentPath.startsWith(path + "/")
  }

  const navSections = [
    {
      title: t("sidebar.sections.overview"),
      items: [
        {
          id: "dashboard",
          label: t("sidebar.items.dashboard"),
          path: "/admin/dashboard",
          icon: LayoutDashboard,
        },
      ],
    },
    {
      title: t("sidebar.sections.network"),
      items: [
        {
          id: "network-profile",
          label: t("sidebar.items.networkProfile"),
          path: "/admin/network",
          icon: Globe,
        },
        {
          id: "readme",
          label: t("sidebar.items.readme"),
          path: "/admin/readme",
          icon: FileText,
        },
        {
          id: "transports",
          label: t("sidebar.items.transports"),
          path: "/admin/transports",
          icon: ArrowLeftRight,
        },
        {
          id: "mods",
          label: t("sidebar.items.modManagement"),
          path: "/admin/mods",
          icon: Settings,
        },
        {
          id: "publish",
          label: t("sidebar.items.publishNetwork"),
          path: "/admin/publish",
          icon: (
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          ),
        },
        {
          id: "import-export",
          label: t("sidebar.items.importExport"),
          path: "/admin/import-export",
          icon: Download,
        },
      ],
    },
    {
      title: t("sidebar.sections.agents"),
      items: [
        {
          id: "service-agents",
          label: t("sidebar.items.serviceAgents"),
          path: "/admin/service-agents",
          icon: Server,
        },
        {
          id: "default-models",
          label: t("sidebar.items.defaultModels"),
          path: "/admin/default-models",
          icon: Cpu,
        },
        {
          id: "agents",
          label: t("sidebar.items.connectedAgents"),
          path: "/admin/agents",
          icon: Users,
        },
        {
          id: "groups",
          label: t("sidebar.items.agentGroups"),
          path: "/admin/groups",
          icon: UserCog,
        },
      ],
    },
    {
      title: t("sidebar.sections.networkAsService"),
      items: [
        {
          id: "exported-tools",
          label: t("sidebar.items.exportedTools"),
          path: "/admin/exported-tools",
          icon: Wrench,
        },
        {
          id: "connect",
          label: t("sidebar.items.connectionGuide"),
          path: "/admin/connect",
          icon: Link2,
        },
      ],
    },
    {
      title: t("sidebar.sections.monitoring"),
      items: [
        {
          id: "events",
          label: t("sidebar.items.eventLogs"),
          path: "/admin/events",
          icon: FileText,
        },
        {
          id: "event-explorer",
          label: t("sidebar.items.eventExplorer"),
          path: "/admin/event-explorer",
          icon: Search,
        },
        {
          id: "llm-logs",
          label: t("sidebar.items.llmLogs"),
          path: "/admin/llm-logs",
          icon: Monitor,
        },
        {
          id: "debugger",
          label: t("sidebar.items.eventDebugger"),
          path: "/admin/debugger",
          icon: Bug,
        },
      ],
    },
  ]

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      {/* <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("sidebar.title")}
        </h2>
      </div> */}

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto">
        {navSections.map((section, sectionIndex) => (
          <div
            key={section.title}
            className={
              sectionIndex > 0
                ? "border-t border-gray-200 dark:border-gray-700"
                : ""
            }
          >
            <div className="px-4 py-3">
              {/* Section Title */}
              <div className="px-2 mb-3">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                  {section.title}
                </span>
              </div>

              {/* Section Items */}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(item.path)
                  // Check if icon is a React element (JSX) or a component
                  const isJsxElement = React.isValidElement(item.icon)
                  const IconComponent = item.icon as React.ComponentType<{
                    className?: string
                  }>
                  return (
                    <Button
                      key={item.id}
                      variant={active ? "secondary" : "ghost"}
                      mode="default"
                      style={{ justifyContent: "flex-start" }}
                      className={`
                        w-full h-9 px-4
                        ${
                          active
                            ? "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-300"
                            : "hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                        }
                        transition-colors duration-150
                      `}
                      onClick={() => navigate(item.path)}
                    >
                      {isJsxElement ? (
                        <span className="flex-shrink-0 mr-3">
                          {item.icon as React.ReactNode}
                        </span>
                      ) : (
                        <IconComponent className="w-5 h-5 flex-shrink-0 mr-3" />
                      )}
                      <span className="text-left">{item.label}</span>
                    </Button>
                  )
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default AdminSidebar
