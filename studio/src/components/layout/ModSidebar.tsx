import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  NavigationIcons,
  getNavigationRoutesByGroup,
} from "@/config/routeConfig";
import { useAuthStore } from "@/stores/authStore";
import { PLUGIN_NAME_ENUM } from "@/types/plugins";
import ModIcon from "./ModIcon";
import logo from "@/assets/images/open-agents-logo.png";

const ModSidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // 获取模块状态，让组件响应模块变化
  // 当 enabledModules 变化时，组件会重新渲染，从而重新计算路由配置
  // 这个订阅确保在模块状态更新时，侧边栏会显示最新的路由
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const enabledModules = useAuthStore((state) => state.moduleState.enabledModules);

  // Generate icon groups using dynamic configuration
  // 直接计算，不使用 useMemo，确保每次渲染都获取最新的路由配置
  // 因为 dynamicRouteConfig 的 visible 属性可能被外部函数动态修改
  const primaryRoutes = getNavigationRoutesByGroup("primary");
  const secondaryRoutes = getNavigationRoutesByGroup("secondary");
  
  // Debug: Log routes to console
  if (process.env.NODE_ENV === 'development') {
    console.log("🔍 ModSidebar - Secondary routes:", secondaryRoutes.map(r => ({
      key: r.navigationConfig?.key,
      label: r.navigationConfig?.label,
      visible: r.navigationConfig?.visible,
      icon: r.navigationConfig?.icon,
      path: r.path
    })));
  }

  // Extract README route to pin it at the top
  const readmeRoute = primaryRoutes.find(
    (route) => route.navigationConfig?.key === PLUGIN_NAME_ENUM.README
  );
  const otherPrimaryRoutes = primaryRoutes.filter(
    (route) => route.navigationConfig?.key !== PLUGIN_NAME_ENUM.README
  );

  // Create pinned README icon config
  const pinnedReadmeIcon = readmeRoute
    ? {
        key: readmeRoute.navigationConfig!.key,
        label: readmeRoute.navigationConfig!.label,
        icon: React.createElement(
          NavigationIcons[readmeRoute.navigationConfig!.icon]
        ),
        route: readmeRoute.path.replace("/*", ""),
      }
    : null;

  const iconGroups = [
    // Primary group (main features) - excluding README which is pinned
    otherPrimaryRoutes.map((route) => ({
      key: route.navigationConfig!.key,
      label: route.navigationConfig!.label,
      icon: React.createElement(
        NavigationIcons[route.navigationConfig!.icon]
      ),
      route: route.path.replace("/*", ""), // Remove wildcard
    })),
    // Secondary group (settings-related)
    secondaryRoutes.map((route) => ({
      key: route.navigationConfig!.key,
      label: route.navigationConfig!.label,
      icon: React.createElement(
        NavigationIcons[route.navigationConfig!.icon]
      ),
      route: route.path.replace("/*", ""), // Remove wildcard
    })),
  ];

  // Check if current route is active
  const isRouteActive = (route: string) => {
    if (route === "/messaging") {
      return location.pathname === "/messaging" || location.pathname === "/messaging/";
    }
    return location.pathname.startsWith(route);
  };

  // Handle navigation click
  const handleNavigation = (route: string) => {
    navigate(route);
  };
  return (
    <div
      className="
      w-16 h-full flex flex-col items-center py-4 border-r transition-colors duration-200
      bg-gray-100 border-gray-200 dark:bg-gray-900 dark:border-gray-700
    "
    >
      {/* Logo/Brand Icon */}
      <div className="mb-4">
        {/* <div
          className="
          w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg
          bg-gradient-to-br from-blue-600 to-purple-600 text-white
          shadow-lg
        "
        >
          OA
        </div> */}
        <div
          className="
          w-10 h-10 rounded-xl flex items-center justify-center shadow-lg
        "
        >
          <img src={logo} alt="OA" className="w-10 h-10" />
        </div>
      </div>

      {/* Pinned README Icon - always at the top */}
      {pinnedReadmeIcon && (
        <div className="mb-4">
          <ModIcon
            key={pinnedReadmeIcon.key}
            isActive={isRouteActive(pinnedReadmeIcon.route)}
            onClick={() => handleNavigation(pinnedReadmeIcon.route)}
            label={pinnedReadmeIcon.label}
            icon={pinnedReadmeIcon.icon}
          />
        </div>
      )}

      {/* Top Icons - main features */}
      <div className="flex flex-col space-y-3 flex-1">
        {(() => {
          return iconGroups[0].map((iconConfig) => (
            <ModIcon
              key={iconConfig.key}
              isActive={isRouteActive(iconConfig.route)}
              onClick={() => handleNavigation(iconConfig.route)}
              label={iconConfig.label}
              icon={iconConfig.icon}
            />
          ));
        })()}
      </div>

      {/* Bottom Icons - settings-related */}
      <div className="flex flex-col space-y-3 mt-auto">
        {iconGroups[1].map((iconConfig) => (
          <ModIcon
            key={iconConfig.key}
            isActive={isRouteActive(iconConfig.route)}
            onClick={() => handleNavigation(iconConfig.route)}
            label={iconConfig.label}
            icon={iconConfig.icon}
          />
        ))}
      </div>

    </div>
  );
};

export default ModSidebar;
