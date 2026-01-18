import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { dynamicRouteConfig, NavigationIcons } from "@/config/routeConfig";
import { PLUGIN_NAME_ENUM } from "@/types/plugins";

// Module name to plugin enum mapping (same as in moduleUtils)
const MODULE_PLUGIN_MAP: Record<string, PLUGIN_NAME_ENUM> = {
  messaging: PLUGIN_NAME_ENUM.MESSAGING,
  feed: PLUGIN_NAME_ENUM.FEED,
  project: PLUGIN_NAME_ENUM.PROJECT,
  "openagents.mods.workspace.project": PLUGIN_NAME_ENUM.PROJECT,
  documents: PLUGIN_NAME_ENUM.DOCUMENTS,
  forum: PLUGIN_NAME_ENUM.FORUM,
  wiki: PLUGIN_NAME_ENUM.WIKI,
  agentworld: PLUGIN_NAME_ENUM.AGENTWORLD,
  "openagents.mods.games.agentworld": PLUGIN_NAME_ENUM.AGENTWORLD,
  artifact: PLUGIN_NAME_ENUM.ARTIFACT,
};

const UserDashboardSidebar: React.FC = () => {
  const { t } = useTranslation("profile");
  const { t: tLayout } = useTranslation("layout");
  const navigate = useNavigate();
  const location = useLocation();
  const enabledModules = useAuthStore((state) => state.moduleState.enabledModules);

  // Get enabled plugin keys from enabled modules
  const enabledPluginKeys = useMemo(() => {
    const keys = new Set<PLUGIN_NAME_ENUM>();
    enabledModules.forEach((moduleName) => {
      const pluginKey = MODULE_PLUGIN_MAP[moduleName];
      if (pluginKey) {
        keys.add(pluginKey);
      }
    });
    // Always include PROFILE, README, and USER_DASHBOARD
    keys.add(PLUGIN_NAME_ENUM.PROFILE);
    keys.add(PLUGIN_NAME_ENUM.README);
    keys.add(PLUGIN_NAME_ENUM.USER_DASHBOARD);
    return keys;
  }, [enabledModules]);

  // Get primary and secondary routes based on enabled modules
  const primaryRoutes = useMemo(() => {
    const routes = dynamicRouteConfig
      .filter((route) => {
        const navConfig = route.navigationConfig;
        if (!navConfig || navConfig.group !== "primary") return false;
        // Show if plugin is enabled
        return enabledPluginKeys.has(navConfig.key);
      })
      .sort((a, b) => (a.navigationConfig?.order || 0) - (b.navigationConfig?.order || 0));
    return routes;
  }, [enabledPluginKeys]);

  const secondaryRoutes = useMemo(() => {
    const routes = dynamicRouteConfig
      .filter((route) => {
        const navConfig = route.navigationConfig;
        if (!navConfig || navConfig.group !== "secondary") return false;
        // Exclude admin route
        if (navConfig.key === PLUGIN_NAME_ENUM.ADMIN) return false;
        // Show if plugin is enabled
        return enabledPluginKeys.has(navConfig.key);
      })
      .sort((a, b) => (a.navigationConfig?.order || 0) - (b.navigationConfig?.order || 0));
    return routes;
  }, [enabledPluginKeys]);

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
      [PLUGIN_NAME_ENUM.USER_DASHBOARD]: tLayout("navigation.userDashboard"),
      [PLUGIN_NAME_ENUM.MOD_MANAGEMENT]: tLayout("navigation.modManagement"),
    };
    return labelMap[key] || key;
  };

  // Get icon component
  const getIconComponent = (iconName: string) => {
    const IconComponent = NavigationIcons[iconName as keyof typeof NavigationIcons];
    if (!IconComponent) return null;
    return React.createElement(IconComponent);
  };

  // Check if route is active
  const isRouteActive = (route: string) => {
    if (route === "/messaging") {
      return location.pathname === "/messaging" || location.pathname === "/messaging/";
    }
    return location.pathname.startsWith(route);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-4 py-3">
        {/* Section Header - Primary Modules */}
        {primaryRoutes.length > 0 && (
          <>
            <div className="flex items-center px-2 mb-2 mt-2">
              <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
              <span className="px-3 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                {t("dashboard.modules.primaryModules", { defaultValue: "主要功能" })}
              </span>
              <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
            </div>

            {/* Primary Routes */}
            {primaryRoutes.map((route) => {
              const navConfig = route.navigationConfig;
              if (!navConfig) return null;

              const IconComponent = getIconComponent(navConfig.icon);
              const routePath = route.path.replace("/*", "");
              const isActive = isRouteActive(routePath);

              return (
                <button
                  key={navConfig.key}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigate(routePath);
                  }}
                  className={`w-full flex items-center px-4 py-3 rounded-lg text-sm font-medium transition-all mb-1 ${
                    isActive
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                    {IconComponent}
                  </div>
                  <span className="ml-3">{getTranslatedLabel(navConfig.key)}</span>
                </button>
              );
            })}
          </>
        )}

        {/* Section Header - Secondary Modules */}
        {secondaryRoutes.length > 0 && (
          <>
            <div className="flex items-center px-2 mb-2 mt-4">
              <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
              <span className="px-3 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                {t("dashboard.modules.secondaryModules", { defaultValue: "设置与工具" })}
              </span>
              <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
            </div>

            {/* Secondary Routes */}
            {secondaryRoutes.map((route) => {
              const navConfig = route.navigationConfig;
              if (!navConfig) return null;

              const IconComponent = getIconComponent(navConfig.icon);
              const routePath = route.path.replace("/*", "");
              const isActive = isRouteActive(routePath);

              return (
                <button
                  key={navConfig.key}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigate(routePath);
                  }}
                  className={`w-full flex items-center px-4 py-3 rounded-lg text-sm font-medium transition-all mb-1 ${
                    isActive
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                    {IconComponent}
                  </div>
                  <span className="ml-3">{getTranslatedLabel(navConfig.key)}</span>
                </button>
              );
            })}
          </>
        )}

        {/* Empty State */}
        {primaryRoutes.length === 0 && secondaryRoutes.length === 0 && (
          <div className="text-center py-8 px-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("dashboard.modules.noModulesAvailable", { defaultValue: "暂无可用模块" })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserDashboardSidebar;

