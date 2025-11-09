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

  // Generate icon groups using dynamic configuration
  const iconGroups = useMemo(() => {
    const primaryRoutes = getNavigationRoutesByGroup("primary");
    const secondaryRoutes = getNavigationRoutesByGroup("secondary");
    console.log("primaryRoutes", primaryRoutes);
    return [
      // Primary group (main features)
      primaryRoutes.map((route) => ({
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
  }, []);

  // Check if current route is active
  const isRouteActive = (route: string) => {
    if (route === "/messaging") {
      return (
        location.pathname === "/messaging" ||
        location.pathname === "/messaging/"
      );
    }
    return location.pathname.startsWith(route);
  };

  // Handle navigation click
  const handleNavigation = (route: string) => {
    navigate(route);
  };
  console.log("iconGroups", iconGroups);
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

      {/* Top Icons - main features */}
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

// Cache entire ModSidebar component
export default React.memo(ModSidebar);
