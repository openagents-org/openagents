import React, { useState } from "react"
import { useTranslation } from "react-i18next"
import { Routes, Route, useNavigate, useLocation } from "react-router-dom"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Menu } from "lucide-react"
import { useIsMobile } from "@/hooks/useMediaQuery"
import ProfileSidebar from "./ProfileSidebar"
import { useProfileData } from "./hooks/useProfileData"
import { useIsAdmin } from "@/hooks/useIsAdmin"
import { cn } from "@/lib/utils"

// Components (to be created)
import NetworkInfoCard from "./components/NetworkInfoCard"
import ModulesInfoCard from "./components/ModulesInfoCard"
import AgentInfoCard from "./components/AgentInfoCard"
import SystemInfoCard from "./components/SystemInfoCard"
import AgentManagement from "./AgentManagement"
import NetworkProfile from "./NetworkProfile"
import AgentGroupsManagement from "./AgentGroupsManagement"
import EventLogs from "./EventLogs"
import EventDebugger from "./EventDebugger"
import ModManagementPage from "../mod-management/ModManagementPage"
// NetworkImportExport component available for future use

/**
 * Profile Tab Navigation Component
 */
const ProfileTabNavigation: React.FC = () => {
  const { t } = useTranslation("profile")
  const navigate = useNavigate()
  const location = useLocation()

  const isActive = (path: string) => {
    const currentPath = location.pathname
    if (path === "/profile") {
      return currentPath === path || currentPath === path + "/"
    }
    return currentPath.startsWith(path)
  }

  const navItems = [
    {
      id: "profile",
      label: t("profile.sidebar.networkStatus"),
      path: "/profile",
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
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
      ),
    },
    {
      id: "event_logs",
      label: t("profile.sidebar.eventLogs"),
      path: "/profile/event-logs",
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
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      ),
    },
    {
      id: "event_debugger",
      label: t("profile.sidebar.eventDebugger"),
      path: "/profile/event-debugger",
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
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      ),
    },
  ]

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-950">
      <div className="flex items-center space-x-1 px-4">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => navigate(item.path)}
            className={cn(
              "flex items-center space-x-2 px-4 py-3 text-sm font-medium transition-colors border-b-2",
              isActive(item.path)
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600"
            )}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Profile main page - handles all profile-related features
 * Contains sidebar and main content area
 */
const ProfileMainPage: React.FC = () => {
  const { t } = useTranslation("profile")
  const isMobile = useIsMobile()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const location = useLocation()

  // Close drawer when route changes on mobile
  React.useEffect(() => {
    if (isMobile) {
      setIsDrawerOpen(false)
    }
  }, [location.pathname, isMobile])

  // Sidebar content component
  const SidebarContent = () => (
    <div className="lg:rounded-s-xl bg-white dark:bg-gray-800 overflow-hidden border-r border-gray-200 dark:border-gray-700 flex flex-col w-full h-full">
      <ScrollArea className="shrink-0 flex-1 mt-0 mb-2.5 h-full">
        <div className="h-full">
          <ProfileSidebar />
        </div>
      </ScrollArea>
    </div>
  )

  return (
    <div className="h-full flex overflow-hidden dark:bg-zinc-950 relative">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-zinc-950">
        {/* Tab Navigation */}
        <ProfileTabNavigation />
        <Routes>
          {/* Default profile view */}
          <Route index element={<ProfileDashboard />} />

          {/* Profile edit subpage */}
          <Route
            path="edit"
            element={
              <div className="p-6 dark:bg-zinc-950 h-full">
                <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
                  {t("profile.editProfile")}
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  {t("comingSoon.profileEditingForm")}
                </p>
              </div>
            }
          />

          {/* Security settings subpage */}
          <Route
            path="security"
            element={
              <div className="p-6 dark:bg-zinc-950 h-full">
                <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
                  {t("profile.securitySettings")}
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  {t("comingSoon.securityConfigPanel")}
                </p>
              </div>
            }
          />

          {/* Agent Management subpage - Admin only */}
          <Route path="agent-management" element={<AgentManagement />} />
          <Route path="network-profile" element={<NetworkProfile />} />
          <Route path="agent-groups" element={<AgentGroupsManagement />} />
          <Route path="mod-management" element={<ModManagementPage />} />

          {/* Event Logs subpage */}
          <Route path="event-logs" element={<EventLogs />} />

          {/* Event Debugger subpage */}
          <Route path="event-debugger" element={<EventDebugger />} />
        </Routes>
      </div>
    </div>
  )
}

/**
 * Main Profile Dashboard component
 */
const ProfileDashboard: React.FC = () => {
  const { t } = useTranslation("profile")
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _navigate = useNavigate()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { isAdmin: _isAdmin } = useIsAdmin()
  const {
    loading,
    error,
    hasData,
    isConnected,
    formattedLastUpdated,
    formattedLatency,
    enabledModulesCount,
    refresh,
  } = useProfileData()

  // Loading state
  if (loading && !hasData) {
    return (
      <div className="p-6 dark:bg-zinc-950 h-full">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-400">
            {t("comingSoon.loadingProfileData")}
          </span>
        </div>
      </div>
    )
  }

  // Error state
  if (error && !hasData) {
    return (
      <div className="p-6 dark:bg-zinc-950 h-full">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
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
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
                {t("comingSoon.failedToLoadProfileData")}
              </h3>
              <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                {error}
              </p>
              <Button
                onClick={refresh}
                variant="destructive"
                size="sm"
                className="mt-2"
              >
                {t("comingSoon.tryAgain")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 dark:bg-zinc-950 h-full min-h-screen overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("profile.title")}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {t("profile.subtitle")}
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Connection Status */}
          <div className="flex items-center space-x-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {isConnected
                ? t("profile.status.connected")
                : t("profile.status.disconnected")}
            </span>
          </div>

          {/* Refresh Button */}
          <Button
            onClick={refresh}
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
            {loading ? t("profile.refreshing") : t("profile.refresh")}
          </Button>
        </div>
      </div>

      {/* Status Bar */}
      {formattedLastUpdated && (
        <div className="mb-6 text-sm text-gray-600 dark:text-gray-400">
          {t("profile.lastUpdated")}: {formattedLastUpdated}
          {formattedLatency &&
            ` • ${t("profile.latency")}: ${formattedLatency}`}
          {enabledModulesCount > 0 &&
            ` • ${t("profile.modulesEnabled", { count: enabledModulesCount })}`}
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Network Information */}
        <NetworkInfoCard />

        {/* Agent Information */}
        <AgentInfoCard />

        {/* Modules Information */}
        <ModulesInfoCard />

        {/* System Settings */}
        <SystemInfoCard />
      </div>
    </div>
  )
}

export default ProfileMainPage
