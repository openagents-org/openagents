import React from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuthStore } from "@/stores/authStore"
import { dynamicRouteConfig, NavigationIcons } from "@/config/routeConfig"
import { PLUGIN_NAME_ENUM } from "@/types/plugins"
import { useDynamicRoutes } from "@/hooks/useDynamicRoutes"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardHeading,
  CardToolbar,
  CardTitle,
} from "@/components/layout/ui/card"
import { ScrollArea } from "@/components/layout/ui/scroll-area"
import { Button } from "@/components/layout/ui/button"
import { Badge } from "@/components/layout/ui/badge"
import { EmptyState } from "@/components/layout/ui/empty-state"
import { RefreshCw, Users, Package } from "lucide-react"
import { useProfileData } from "./hooks/useProfileData"

// Module name to plugin enum mapping (same as in moduleUtils)
// Supports both short names and full qualified names from dynamic mods
const MODULE_PLUGIN_MAP: Record<string, PLUGIN_NAME_ENUM> = {
  // Short names
  messaging: PLUGIN_NAME_ENUM.MESSAGING,
  feed: PLUGIN_NAME_ENUM.FEED,
  project: PLUGIN_NAME_ENUM.PROJECT,
  documents: PLUGIN_NAME_ENUM.DOCUMENTS,
  forum: PLUGIN_NAME_ENUM.FORUM,
  wiki: PLUGIN_NAME_ENUM.WIKI,
  agentworld: PLUGIN_NAME_ENUM.AGENTWORLD,
  artifact: PLUGIN_NAME_ENUM.ARTIFACT,
  shared_artifact: PLUGIN_NAME_ENUM.ARTIFACT,
  // Full qualified names (dynamic mods)
  "openagents.mods.workspace.messaging": PLUGIN_NAME_ENUM.MESSAGING,
  "openagents.mods.workspace.feed": PLUGIN_NAME_ENUM.FEED,
  "openagents.mods.workspace.project": PLUGIN_NAME_ENUM.PROJECT,
  "openagents.mods.workspace.documents": PLUGIN_NAME_ENUM.DOCUMENTS,
  "openagents.mods.workspace.forum": PLUGIN_NAME_ENUM.FORUM,
  "openagents.mods.workspace.wiki": PLUGIN_NAME_ENUM.WIKI,
  "openagents.mods.workspace.shared_artifact": PLUGIN_NAME_ENUM.ARTIFACT,
  "openagents.mods.games.agentworld": PLUGIN_NAME_ENUM.AGENTWORLD,
}

const UserDashboard: React.FC = () => {
  const { t } = useTranslation("profile")
  const { t: tLayout } = useTranslation("layout")
  const navigate = useNavigate()
  const enabledModules = useAuthStore(
    (state) => state.moduleState.enabledModules
  )
  const { selectedNetwork } = useAuthStore()

  // Get module reload function from useDynamicRoutes
  const { reloadModules } = useDynamicRoutes()

  const {
    loading,
    isConnected,
    formattedLastUpdated,
    formattedLatency,
    enabledModulesCount,
    refresh: refreshProfile,
  } = useProfileData()

  // Combined refresh function that reloads both modules and profile data
  const refresh = React.useCallback(async () => {
    await reloadModules()
    await refreshProfile()
  }, [reloadModules, refreshProfile])

  // Debug logging
  React.useEffect(() => {
    console.log("🔍 UserDashboard mounted:", {
      enabledModules,
      enabledModulesCount,
      loading,
      isConnected,
    })
  }, [enabledModules, enabledModulesCount, loading, isConnected])

  // Get enabled plugin keys from enabled modules
  const enabledPluginKeys = React.useMemo(() => {
    const keys = new Set<PLUGIN_NAME_ENUM>()
    enabledModules.forEach((moduleName) => {
      const pluginKey = MODULE_PLUGIN_MAP[moduleName]
      if (pluginKey) {
        keys.add(pluginKey)
      } else {
        console.log(
          `⚠️ UserDashboard: Module "${moduleName}" not found in MODULE_PLUGIN_MAP`
        )
      }
    })
    // Always include PROFILE and README
    keys.add(PLUGIN_NAME_ENUM.PROFILE)
    keys.add(PLUGIN_NAME_ENUM.README)
    console.log("📊 UserDashboard enabled modules:", enabledModules)
    console.log("📊 UserDashboard enabled plugin keys:", Array.from(keys))
    return keys
  }, [enabledModules])

  // Get primary and secondary routes based on enabled modules
  const primaryRoutes = React.useMemo(() => {
    const routes = dynamicRouteConfig
      .filter((route) => {
        const navConfig = route.navigationConfig
        if (!navConfig || navConfig.group !== "primary") return false
        // Exclude USER_DASHBOARD and README from primary routes display
        if (
          navConfig.key === PLUGIN_NAME_ENUM.USER_DASHBOARD ||
          navConfig.key === PLUGIN_NAME_ENUM.README
        )
          return false
        // Show if plugin is enabled
        return enabledPluginKeys.has(navConfig.key)
      })
      .sort(
        (a, b) =>
          (a.navigationConfig?.order || 0) - (b.navigationConfig?.order || 0)
      )
    console.log(
      "📊 UserDashboard primary routes:",
      routes.map((r) => r.navigationConfig?.key)
    )
    return routes
  }, [enabledPluginKeys])

  const secondaryRoutes = React.useMemo(() => {
    const routes = dynamicRouteConfig
      .filter((route) => {
        const navConfig = route.navigationConfig
        if (!navConfig || navConfig.group !== "secondary") return false
        // Exclude admin route
        if (navConfig.key === PLUGIN_NAME_ENUM.ADMIN) return false
        // Show if plugin is enabled
        return enabledPluginKeys.has(navConfig.key)
      })
      .sort(
        (a, b) =>
          (a.navigationConfig?.order || 0) - (b.navigationConfig?.order || 0)
      )
    console.log(
      "📊 UserDashboard secondary routes:",
      routes.map((r) => r.navigationConfig?.key)
    )
    return routes
  }, [enabledPluginKeys])

  // Translation mapping for navigation labels
  const getTranslatedLabel = (key: PLUGIN_NAME_ENUM): string => {
    const labelMap: Partial<Record<PLUGIN_NAME_ENUM, string>> = {
      [PLUGIN_NAME_ENUM.MESSAGING]: tLayout("navigation.messages"),
      [PLUGIN_NAME_ENUM.FEED]: tLayout("navigation.infoFeed"),
      [PLUGIN_NAME_ENUM.PROJECT]: tLayout("navigation.projects"),
      [PLUGIN_NAME_ENUM.FORUM]: tLayout("navigation.forum"),
      [PLUGIN_NAME_ENUM.ARTIFACT]: tLayout("navigation.artifact"),
      [PLUGIN_NAME_ENUM.WIKI]: tLayout("navigation.wiki"),
      [PLUGIN_NAME_ENUM.DOCUMENTS]: tLayout("navigation.documents"),
      [PLUGIN_NAME_ENUM.AGENTWORLD]: tLayout("navigation.agentWorld"),
      [PLUGIN_NAME_ENUM.PROFILE]: tLayout("navigation.profile"),
      [PLUGIN_NAME_ENUM.README]: tLayout("navigation.readme"),
      [PLUGIN_NAME_ENUM.MOD_MANAGEMENT]: tLayout("navigation.modManagement"),
    }
    return labelMap[key] || key
  }

  // Get icon component
  const getIconComponent = (iconName: string) => {
    const IconComponent =
      NavigationIcons[iconName as keyof typeof NavigationIcons]
    if (!IconComponent) return null
    return React.createElement(IconComponent)
  }

  // Color schemes for different modules - matching AdminDashboard style
  const getModuleColorScheme = (index: number) => {
    const colors = [
      {
        bg: "bg-blue-100 dark:bg-blue-900",
        icon: "text-blue-600 dark:text-blue-400",
      },
      {
        bg: "bg-indigo-100 dark:bg-indigo-900",
        icon: "text-indigo-600 dark:text-indigo-400",
      },
      {
        bg: "bg-purple-100 dark:bg-purple-900",
        icon: "text-purple-600 dark:text-purple-400",
      },
      {
        bg: "bg-pink-100 dark:bg-pink-900",
        icon: "text-pink-600 dark:text-pink-400",
      },
      {
        bg: "bg-red-100 dark:bg-red-900",
        icon: "text-red-600 dark:text-red-400",
      },
      {
        bg: "bg-orange-100 dark:bg-orange-900",
        icon: "text-orange-600 dark:text-orange-400",
      },
      {
        bg: "bg-amber-100 dark:bg-amber-900",
        icon: "text-amber-600 dark:text-amber-400",
      },
      {
        bg: "bg-yellow-100 dark:bg-yellow-900",
        icon: "text-yellow-600 dark:text-yellow-400",
      },
      {
        bg: "bg-lime-100 dark:bg-lime-900",
        icon: "text-lime-600 dark:text-lime-400",
      },
      {
        bg: "bg-green-100 dark:bg-green-900",
        icon: "text-green-600 dark:text-green-400",
      },
      {
        bg: "bg-emerald-100 dark:bg-emerald-900",
        icon: "text-emerald-600 dark:text-emerald-400",
      },
      {
        bg: "bg-teal-100 dark:bg-teal-900",
        icon: "text-teal-600 dark:text-teal-400",
      },
      {
        bg: "bg-cyan-100 dark:bg-cyan-900",
        icon: "text-cyan-600 dark:text-cyan-400",
      },
      {
        bg: "bg-sky-100 dark:bg-sky-900",
        icon: "text-sky-600 dark:text-sky-400",
      },
      {
        bg: "bg-violet-100 dark:bg-violet-900",
        icon: "text-violet-600 dark:text-violet-400",
      },
    ]
    return colors[index % colors.length]
  }

  if (loading && !formattedLastUpdated) {
    return (
      <div className="p-6 h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">
            {t("comingSoon.loadingProfileData")}
          </p>
        </div>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full dark:bg-zinc-950">
      <div className="p-4">
        {/* Header with Stats Tags - using standardized CardHeader/CardToolbar */}
        <Card className="mb-4">
          <CardHeader>
            <CardHeading>
              <CardTitle className="flex items-center gap-2">
                {t("dashboard.title", { defaultValue: "User Panel" })}
                <Badge variant="info" appearance="light" size="sm">
                  <Users className="w-3 h-3 mr-1" />
                  {enabledModulesCount}{" "}
                  {t("dashboard.modules.enabled", { defaultValue: "Enabled" })}
                </Badge>
                <Badge
                  variant={isConnected ? "success" : "destructive"}
                  appearance="light"
                  size="sm"
                >
                  <div
                    className={`w-2 h-2 rounded-full ${
                      isConnected ? "bg-green-500" : "bg-red-500"
                    } mr-1`}
                  />
                  {isConnected
                    ? t("profile.status.connected")
                    : t("profile.status.disconnected")}
                </Badge>
              </CardTitle>
              {formattedLastUpdated && (
                <CardDescription>
                  {t("profile.lastUpdated")}: {formattedLastUpdated}
                </CardDescription>
              )}
            </CardHeading>
            <CardToolbar>
              <Button
                onClick={refresh}
                disabled={loading}
                variant="outline"
                size="sm"
              >
                <RefreshCw
                  className={`w-3 h-3 mr-1.5 ${loading ? "animate-spin" : ""}`}
                />
                {loading ? t("profile.refreshing") : t("profile.refresh")}
              </Button>
            </CardToolbar>
          </CardHeader>
        </Card>

        {/* Network Status Panel - matching AdminDashboard style */}
        {selectedNetwork && (
          <Card variant="default" className="mb-4">
            <CardHeader>
              <CardHeading>
                <CardTitle>
                  {t("dashboard.networkStatus.title", {
                    defaultValue: "Network Status",
                  })}
                </CardTitle>
              </CardHeading>
              <CardToolbar>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={refresh}
                  disabled={loading}
                >
                  <RefreshCw
                    className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
                  />
                </Button>
              </CardToolbar>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                {/* Connection Status */}
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"
                    }`}
                  />
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {selectedNetwork.host}:{selectedNetwork.port}
                  </span>
                </div>

                <div className="h-4 w-px bg-gray-300 dark:bg-gray-600" />

                {/* Status Info */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {enabledModulesCount > 0 &&
                      `${t("profile.modulesEnabled", {
                        count: enabledModulesCount,
                      })}`}
                    {formattedLatency &&
                      ` • ${t("profile.latency")}: ${formattedLatency}`}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Apps Section - README + Primary Modules */}
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            {t("dashboard.modules.apps", {
              defaultValue: "APPS",
            })}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* README Card - Always show */}
            <Card
              className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
              onClick={() => navigate("/readme")}
            >
              <CardContent className="flex items-center space-x-3 p-4">
                <div
                  className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0"
                >
                  <div className="text-blue-600 dark:text-blue-400">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {tLayout("navigation.readme", { defaultValue: "README" })}
                  </div>
                  <CardDescription className="text-xs mt-0.5">
                    {t("dashboard.modules.readme.desc", {
                      defaultValue: "View README documentation",
                    })}
                  </CardDescription>
                </div>
              </CardContent>
            </Card>

            {/* Primary Routes */}
            {primaryRoutes.map((route, index) => {
              const navConfig = route.navigationConfig
              if (!navConfig) return null

              const IconComponent = getIconComponent(navConfig.icon)
              const colorScheme = getModuleColorScheme(index + 1)
              const routePath = route.path.replace("/*", "")

              return (
                <Card
                  key={navConfig.key}
                  className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
                  onClick={() => navigate(routePath)}
                >
                  <CardContent className="flex items-center space-x-3 p-4">
                    <div
                      className={`w-10 h-10 rounded-full ${colorScheme.bg} flex items-center justify-center flex-shrink-0`}
                    >
                      {IconComponent && (
                        <div className={colorScheme.icon}>
                          {IconComponent}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">
                        {getTranslatedLabel(navConfig.key)}
                      </div>
                      <CardDescription className="text-xs mt-0.5">
                        {t(`dashboard.modules.${navConfig.key}.desc`, {
                          defaultValue: "",
                        })}
                      </CardDescription>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>

        {/* Enabled Modules - Secondary Group - matching AdminDashboard card style */}
        {secondaryRoutes.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              {t("dashboard.modules.secondaryModules", {
                defaultValue: "SETTINGS & TOOLS",
              })}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {secondaryRoutes.map((route, index) => {
                const navConfig = route.navigationConfig
                if (!navConfig) return null

                const IconComponent = getIconComponent(navConfig.icon)
                const colorScheme = getModuleColorScheme(
                  primaryRoutes.length + index
                )
                const routePath = route.path.replace("/*", "")

                return (
                  <Card
                    key={navConfig.key}
                    className="cursor-pointer hover:bg-accent transition-colors border-gray-200 dark:border-gray-700"
                    onClick={() => navigate(routePath)}
                  >
                    <CardContent className="flex items-center space-x-3 p-4">
                      <div
                        className={`w-10 h-10 rounded-full ${colorScheme.bg} flex items-center justify-center flex-shrink-0`}
                      >
                        {IconComponent && (
                          <div className={colorScheme.icon}>
                            {IconComponent}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">
                          {getTranslatedLabel(navConfig.key)}
                        </div>
                        <CardDescription className="text-xs mt-0.5">
                          {t(`dashboard.modules.${navConfig.key}.desc`, {
                            defaultValue: "",
                          })}
                        </CardDescription>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        )}

        {/* Empty State - using standardized EmptyState component */}
        {primaryRoutes.length === 0 && secondaryRoutes.length === 0 && (
          <EmptyState
            icon={<Package className="w-12 h-12" />}
            title={t("dashboard.modules.noModulesAvailable", {
              defaultValue: "No modules available",
            })}
            description={`Enabled modules: ${
              enabledModules.length > 0 ? enabledModules.join(", ") : "None"
            }`}
          />
        )}
      </div>
    </ScrollArea>
  )
}

export default UserDashboard
