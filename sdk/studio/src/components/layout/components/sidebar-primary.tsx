import React from "react";
import { toAbsoluteUrl } from "@/lib/helpers";
import {
  User,
  LogOut,
  Sun,
  Moon,
  Users,
  LayoutDashboard,
  Globe,
  CloudUpload,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarIndicator,
  AvatarStatus,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useThemeStore } from "@/stores/themeStore";
import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  NavigationIcons,
  getNavigationRoutesByGroup,
} from "@/config/routeConfig";
import { useAuthStore } from "@/stores/authStore";
import { PLUGIN_NAME_ENUM } from "@/types/plugins";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useChatStore } from "@/stores/chatStore";
import { clearAllOpenAgentsDataForLogout } from "@/utils/cookies";
import { useI18n } from "@/hooks/useI18n";
import { SUPPORTED_LANGUAGES, SupportedLanguage } from "@/i18n/config";
import { useConfirm } from "@/context/ConfirmContext";
import logo from "@/assets/images/open-agents-logo.png";

export function SidebarPrimary() {
  const { theme, toggleTheme } = useThemeStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation("layout");
  const { currentLanguage, switchLanguage } = useI18n();
  const { confirm } = useConfirm();

  const isDarkMode = theme === "dark";

  // 获取模块状态，让组件响应模块变化
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const enabledModules = useAuthStore(
    (state) => state.moduleState.enabledModules
  );

  // Check admin status
  const { isAdmin } = useIsAdmin();

  // Get logout functions from stores
  const { clearNetwork, clearAgentName, agentName } = useAuthStore();
  const { clearAllChatData } = useChatStore();

  // Generate icon groups using dynamic configuration
  const primaryRoutes = getNavigationRoutesByGroup("primary");
  let secondaryRoutes = getNavigationRoutesByGroup("secondary");

  // Add admin route if user is admin
  if (isAdmin) {
    const adminRoute = secondaryRoutes.find(
      (route) => route.navigationConfig?.key === PLUGIN_NAME_ENUM.ADMIN
    );
    if (adminRoute && !adminRoute.navigationConfig?.visible) {
      secondaryRoutes = [...secondaryRoutes];
      const adminIndex = secondaryRoutes.findIndex(
        (route) => route.navigationConfig?.key === PLUGIN_NAME_ENUM.ADMIN
      );
      if (adminIndex >= 0) {
        secondaryRoutes[adminIndex] = {
          ...secondaryRoutes[adminIndex],
          navigationConfig: {
            ...secondaryRoutes[adminIndex].navigationConfig!,
            visible: true,
          },
        };
      }
    }
  } else {
    secondaryRoutes = secondaryRoutes.filter(
      (route) => route.navigationConfig?.key !== PLUGIN_NAME_ENUM.ADMIN
    );
  }

  // Extract README route to pin it at the top
  const readmeRoute = primaryRoutes.find(
    (route) => route.navigationConfig?.key === PLUGIN_NAME_ENUM.README
  );
  const otherPrimaryRoutes = primaryRoutes.filter(
    (route) => route.navigationConfig?.key !== PLUGIN_NAME_ENUM.README
  );

  // Check if we're in admin route
  const isAdminRoute = location.pathname.startsWith("/admin");

  // Generate navigation items from routes
  const navItems = useMemo(() => {
    // Translation mapping for navigation labels
    const getTranslatedLabel = (key: PLUGIN_NAME_ENUM): string => {
      const labelMap: Partial<Record<PLUGIN_NAME_ENUM, string>> = {
        [PLUGIN_NAME_ENUM.MESSAGING]: t("navigation.messages"),
        [PLUGIN_NAME_ENUM.FEED]: t("navigation.infoFeed"),
        [PLUGIN_NAME_ENUM.PROJECT]: t("navigation.projects"),
        [PLUGIN_NAME_ENUM.FORUM]: t("navigation.forum"),
        [PLUGIN_NAME_ENUM.ARTIFACT]: t("navigation.artifact"),
        [PLUGIN_NAME_ENUM.WIKI]: t("navigation.wiki"),
        [PLUGIN_NAME_ENUM.DOCUMENTS]: t("navigation.documents"),
        [PLUGIN_NAME_ENUM.AGENTWORLD]: t("navigation.agentWorld"),
        [PLUGIN_NAME_ENUM.PROFILE]: t("navigation.profile"),
        [PLUGIN_NAME_ENUM.README]: t("navigation.readme"),
        [PLUGIN_NAME_ENUM.MOD_MANAGEMENT]: t("navigation.modManagement"),
        [PLUGIN_NAME_ENUM.SERVICE_AGENTS]: t("navigation.serviceAgents"),
        [PLUGIN_NAME_ENUM.LLM_LOGS]: t("navigation.llmLogs"),
        [PLUGIN_NAME_ENUM.ADMIN]: t("navigation.admin"),
        [PLUGIN_NAME_ENUM.USER_DASHBOARD]: t("navigation.userDashboard", { defaultValue: "User Dashboard" }),
      };
      return labelMap[key] || key;
    };

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

    const items: Array<{
      icon: React.ComponentType;
      label: string;
      href: string;
      active: boolean;
      className: string;
      index: number;
    }> = [];

    let currentIndex = 0;

    // If in admin route, show dashboard and admin menu items
    if (isAdminRoute) {
      // Add Dashboard menu item
      items.push({
        icon: LayoutDashboard,
        label: t("sidebar.dashboard"),
        href: "/admin/dashboard",
        active:
          isRouteActive("/admin/dashboard") ||
          location.pathname === "/admin" ||
          location.pathname === "/admin/",
        className:
          "border-white bg-blue-500 hover:bg-blue-600 text-white hover:text-white",
        index: currentIndex++,
      });

      // Add Service Agents quick access
      items.push({
        icon: NavigationIcons.ServiceAgents as React.ComponentType,
        label: t("navigation.serviceAgents"),
        href: "/admin/service-agents",
        active: isRouteActive("/admin/service-agents"),
        className:
          "border-white bg-indigo-500 hover:bg-indigo-600 text-white hover:text-white",
        index: currentIndex++,
      });

      // Add Connected Agents quick access
      items.push({
        icon: Users,
        label: t("navigation.connectedAgents") || "Connected Agents",
        href: "/admin/agents",
        active: isRouteActive("/admin/agents"),
        className:
          "border-white bg-teal-500 hover:bg-teal-600 text-white hover:text-white",
        index: currentIndex++,
      });

      // Add Publish Network quick access
      items.push({
        icon: CloudUpload,
        label: t("navigation.publishNetwork") || "Publish Network",
        href: "/admin/publish",
        active: isRouteActive("/admin/publish"),
        className:
          "border-white bg-orange-500 hover:bg-orange-600 text-white hover:text-white",
        index: currentIndex++,
      });

      // Add Admin menu item
      const adminRoute = secondaryRoutes.find(
        (route) => route.navigationConfig?.key === PLUGIN_NAME_ENUM.ADMIN
      );
      if (adminRoute && adminRoute.navigationConfig) {
        const routePath = adminRoute.path.replace("/*", "");
        items.push({
          icon: NavigationIcons[
            adminRoute.navigationConfig.icon
          ] as React.ComponentType,
          label: getTranslatedLabel(adminRoute.navigationConfig.key),
          href: routePath,
          active: isRouteActive(routePath),
          className:
            "border-white bg-gray-500 hover:bg-gray-600 text-white hover:text-white",
          index: currentIndex++,
        });
      }
      return items;
    }

    // Normal mode: Add User Dashboard at the top for all users
    items.push({
      icon: NavigationIcons.Dashboard as React.ComponentType,
      label: getTranslatedLabel(PLUGIN_NAME_ENUM.USER_DASHBOARD),
      href: "/user-dashboard",
      active: isRouteActive("/user-dashboard"),
      className:
        "border-white bg-amber-500 hover:bg-amber-600 text-white hover:text-white",
      index: currentIndex++,
    });

    // Normal mode: Add README icon at the top (always show)
    items.push({
      icon: NavigationIcons.Readme as React.ComponentType,
      label: getTranslatedLabel(PLUGIN_NAME_ENUM.README),
      href: "/readme",
      active: isRouteActive("/readme"),
      className:
        "border-white bg-blue-500 hover:bg-blue-600 text-white hover:text-white",
      index: currentIndex++,
    });

    // Add primary routes (excluding README)
    otherPrimaryRoutes.forEach((route) => {
      const routePath = route.path.replace("/*", "");
      const colors = [
        "border-white bg-violet-500 hover:bg-violet-600 text-white hover:text-white",
        "border-white bg-teal-500 hover:bg-teal-600 text-white hover:text-white",
        "border-white bg-lime-500 hover:bg-lime-600 text-white hover:text-white",
        "border-white bg-blue-500 hover:bg-blue-600 text-white hover:text-white",
        "border-white bg-yellow-500 hover:bg-yellow-600 text-white hover:text-white",
        "border-white bg-pink-500 hover:bg-pink-600 text-white hover:text-white",
        "border-white bg-indigo-500 hover:bg-indigo-600 text-white hover:text-white",
      ];
      items.push({
        icon: NavigationIcons[
          route.navigationConfig!.icon
        ] as React.ComponentType,
        label: getTranslatedLabel(route.navigationConfig!.key),
        href: routePath,
        active: isRouteActive(routePath),
        className: colors[currentIndex % colors.length],
        index: currentIndex++,
      });
    });

    return items;
  }, [
    readmeRoute,
    otherPrimaryRoutes,
    secondaryRoutes,
    location.pathname,
    t,
    isAdminRoute,
    isAdmin,
  ]);

  // Handle navigation click
  const handleNavigation = (href: string) => {
    navigate(href);
  };

  // Logout handler function
  const handleLogout = async () => {
    console.log("🚪 Logout button clicked - showing confirmation dialog");

    // Show confirmation dialog
    const confirmed = await confirm(
      t("sidebar.logout.title"),
      t("sidebar.logout.message"),
      {
        confirmText: t("sidebar.logout.confirm"),
        cancelText: t("sidebar.logout.cancel"),
        type: "warning",
      }
    );

    // Only proceed if user confirmed
    if (!confirmed) {
      console.log("🚪 Logout cancelled by user");
      return;
    }

    try {
      // Clear network state
      clearNetwork();
      clearAgentName();
      console.log("🧹 Network state cleared");

      // Clear chat store data
      clearAllChatData();
      console.log("🧹 Chat store data cleared");

      // Clear all OpenAgents-related data (preserve theme settings)
      clearAllOpenAgentsDataForLogout();

      // Navigate to network selection page
      console.log("🔄 Navigating to network selection");
      navigate("/network-selection", { replace: true });
    } catch (error) {
      console.error("❌ Error during logout:", error);
    }
  };

  return (
    <div className="flex flex-col items-center justify-between shrink-0 py-2.5 gap-5 w-[70px] lg:w-(--sidebar-collapsed-width) bg-white dark:bg-zinc-950">
      {/* Logo/Brand Icon */}
      <div className="mb-2 mt-2">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center">
          <img src={logo} alt="OA" className="w-10 h-10" />
        </div>
      </div>

      {/* Nav */}
      <div className="shrink-0 grow w-full relative">
        <ScrollArea className="shrink-0 h-[calc(100dvh-14rem)]">
          <div className="flex flex-col grow items-center gap-[10px] shrink-0 pt-2">
            {navItems.map((item) => (
              <Button
                key={item.label}
                variant="ghost"
                mode="icon"
                className={cn(
                  "transition-all duration-300 rounded-lg shadow-sm border-2 hover:shadow-[0_4px_12px_0_rgba(37,47,74,0.35)] w-[34px] h-[34px]",
                  item.className,
                  item.active && "ring-2 ring-green-500"
                )}
                onClick={() => handleNavigation(item.href)}
                title={item.label}
              >
                <div className="w-4 h-4">{React.createElement(item.icon)}</div>
              </Button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Footer */}
      <div className="flex flex-col items-center gap-2.5 shrink-0">
        {/* <Button variant="ghost" mode="icon" className="text-muted-foreground hover:text-foreground">
          <Mails className="opacity-100"/>
        </Button>

        <Button variant="ghost" mode="icon" className="text-muted-foreground hover:text-foreground">
          <NotepadText className="opacity-100"/>
        </Button>
        
        <Button variant="ghost" mode="icon" className="text-muted-foreground hover:text-foreground">
          <Settings className="opacity-100"/>
        </Button> */}

        <DropdownMenu>
          <DropdownMenuTrigger className="cursor-pointer mb-2.5 focus:outline-none focus:ring-0 focus:border-0 border-0 rounded-full">
            <Avatar className="size-7">
              <AvatarImage
                src={toAbsoluteUrl("/media/avatars/300-2.png")}
                alt={agentName || "Agent"}
              />
              <AvatarFallback>
                {agentName?.charAt(0).toUpperCase() || "A"}
              </AvatarFallback>
              <AvatarIndicator className="-end-2 -top-2">
                <AvatarStatus variant="online" className="size-2.5" />
              </AvatarIndicator>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-64 mb-4 bg-white dark:bg-zinc-950 border-gray-200 dark:border-gray-700 shadow-lg"
            side="right"
            align="start"
            sideOffset={11}
          >
            {/* User Information Section */}
            <div className="flex items-center gap-3 px-3 py-2">
              <Avatar>
                <AvatarImage
                  src={toAbsoluteUrl("/media/avatars/300-2.png")}
                  alt={agentName || "Agent"}
                />
                <AvatarFallback>
                  {agentName?.charAt(0).toUpperCase() || "A"}
                </AvatarFallback>
                <AvatarIndicator className="-end-1.5 -top-1.5">
                  <AvatarStatus variant="online" className="size-2.5" />
                </AvatarIndicator>
              </Avatar>
              <div className="flex flex-col items-start">
                <span className="text-sm font-semibold text-foreground">
                  {agentName || "Agent"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {isAdmin ? "Administrator" : "Agent"}
                </span>
              </div>
            </div>

            {/* Theme Toggle */}
            <DropdownMenuItem
              onClick={toggleTheme}
              className="cursor-pointer data-[highlighted]:bg-gray-100 dark:data-[highlighted]:bg-zinc-900 transition-colors"
            >
              {isDarkMode ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
              <span>
                {isDarkMode
                  ? t("sidebar.theme.lightMode")
                  : t("sidebar.theme.darkMode")}
              </span>
            </DropdownMenuItem>

            {/* Language Switcher */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="cursor-pointer data-[highlighted]:bg-gray-100 dark:data-[highlighted]:bg-zinc-900 transition-colors focus:outline-none focus:ring-0 focus:border-0 data-[here]:border-0 data-[highlighted]:border-0 hover:border-0 border-0">
                <Globe className="size-4" />
                <span>{t("sidebar.language")}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="bg-white dark:bg-zinc-950 border-gray-200 dark:border-gray-700">
                {Object.entries(SUPPORTED_LANGUAGES).map(([code, lang]) => {
                  const langCode = code as SupportedLanguage;
                  const isActive = langCode === currentLanguage;
                  return (
                    <DropdownMenuItem
                      key={code}
                      onClick={() => switchLanguage(langCode)}
                      className={`cursor-pointer data-[highlighted]:bg-gray-100 dark:data-[highlighted]:bg-zinc-900 transition-colors ${
                        isActive
                          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                          : ""
                      }`}
                    >
                      <span className="mr-2">{lang.flag}</span>
                      <span>{lang.nativeName}</span>
                      {isActive && (
                        <span className="ml-auto">
                          <svg
                            className="w-4 h-4"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </span>
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {/* Profile - Hide in admin mode */}
            {!isAdminRoute && (
              <DropdownMenuItem
                onClick={() => navigate("/profile")}
                className={`cursor-pointer data-[highlighted]:bg-gray-100 dark:data-[highlighted]:bg-zinc-900 transition-colors ${
                  location.pathname.startsWith("/profile")
                    ? "bg-[#F4F4F5] dark:bg-black text-gray-900 dark:text-gray-100"
                    : ""
                }`}
              >
                <User className="size-4" />
                <span>{t("navigation.profile")}</span>
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />

            {/* Action Items */}
            <DropdownMenuItem
              onClick={handleLogout}
              className="cursor-pointer data-[highlighted]:bg-gray-100 dark:data-[highlighted]:bg-zinc-900 transition-colors"
            >
              <LogOut />
              <span>{t("sidebar.signOut")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
