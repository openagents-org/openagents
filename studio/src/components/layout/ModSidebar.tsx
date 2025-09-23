import React, { useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  NavigationIcons,
  getNavigationRoutesByGroup,
} from "@/config/routeConfig";
import ModIcon from "./ModIcon";
import logo from "@/assets/images/open-agents-logo.png";

const ModSidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // 使用动态配置生成图标组
  const iconGroups = useMemo(() => {
    const primaryRoutes = getNavigationRoutesByGroup("primary");
    const secondaryRoutes = getNavigationRoutesByGroup("secondary");

    return [
      // Primary group (主要功能)
      primaryRoutes.map((route) => ({
        key: route.navigationConfig!.key,
        label: route.navigationConfig!.label,
        icon: React.createElement(
          NavigationIcons[route.navigationConfig!.icon]
        ),
        route: route.path.replace("/*", ""), // 移除通配符
      })),
      // Secondary group (设置相关)
      secondaryRoutes.map((route) => ({
        key: route.navigationConfig!.key,
        label: route.navigationConfig!.label,
        icon: React.createElement(
          NavigationIcons[route.navigationConfig!.icon]
        ),
        route: route.path.replace("/*", ""), // 移除通配符
      })),
    ];
  }, []);

  // 判断当前路由是否激活
  const isRouteActive = (route: string) => {
    if (route === "/chat") {
      return location.pathname === "/chat" || location.pathname === "/chat/";
    }
    return location.pathname.startsWith(route);
  };

  // 处理导航点击
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
      <div className="mb-6">
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

      {/* Top Icons - 主要功能 */}
      <div className="flex flex-col space-y-3 flex-1">
        {iconGroups[0].map((iconConfig) => (
          <ModIcon
            key={iconConfig.key}
            isActive={isRouteActive(iconConfig.route)}
            onClick={() => handleNavigation(iconConfig.route)}
            label={iconConfig.label}
            icon={iconConfig.icon}
          />
        ))}
      </div>

      {/* Bottom Icons - 设置相关 */}
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

// 缓存整个 ModSidebar 组件
export default React.memo(ModSidebar);
