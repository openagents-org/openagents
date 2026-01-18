/* eslint-disable react/jsx-no-undef */
import { useMemo, Fragment, type MouseEvent } from "react"
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbSeparator,
  BreadcrumbLink,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { useLayout } from "./context"
import { Button } from "@/components/ui/button"
import { PanelLeft, LayoutDashboard, User } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { getNavigationRoutesByGroup } from "@/config/routeConfig"
import { PLUGIN_NAME_ENUM } from "@/types/plugins"
import { useIsAdmin } from "@/hooks/useIsAdmin"

export function HeaderBreadcrumbs() {
  const { isMobile, sidebarToggle, isSidebarOpen } = useLayout()
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation("layout")
  const { t: tAdmin } = useTranslation("admin")
  const { t: tProfile } = useTranslation("profile")
  const { isAdmin } = useIsAdmin()

  // Generate breadcrumb items based on current route
  const breadcrumbItems = useMemo(() => {
    const pathname = location.pathname
    const items: Array<{ label: string; href: string; isActive: boolean }> = []

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
          }
          return labelMap[key] || key
        }

    // Get all routes
    const primaryRoutes = getNavigationRoutesByGroup("primary")
    let secondaryRoutes = getNavigationRoutesByGroup("secondary")

    // Add admin route if user is admin
    if (isAdmin) {
      const adminRoute = secondaryRoutes.find(
        (route) => route.navigationConfig?.key === PLUGIN_NAME_ENUM.ADMIN
      )
      if (adminRoute && !adminRoute.navigationConfig?.visible) {
        secondaryRoutes = [...secondaryRoutes]
        const adminIndex = secondaryRoutes.findIndex(
          (route) => route.navigationConfig?.key === PLUGIN_NAME_ENUM.ADMIN
        )
        if (adminIndex >= 0) {
          secondaryRoutes[adminIndex] = {
            ...secondaryRoutes[adminIndex],
            navigationConfig: {
              ...secondaryRoutes[adminIndex].navigationConfig!,
              visible: true,
            },
          }
        }
      }
    } else {
      secondaryRoutes = secondaryRoutes.filter(
        (route) => route.navigationConfig?.key !== PLUGIN_NAME_ENUM.ADMIN
      )
    }

    const allRoutes = [...primaryRoutes, ...secondaryRoutes]

    // Find matching route
    const findRoute = (path: string) => {
      return allRoutes.find((route) => {
        const routePath = route.path.replace("/*", "")
        if (routePath === "/messaging") {
          return path === "/messaging" || path === "/messaging/"
        }
        return path.startsWith(routePath)
      })
    }

    // Check if route matches
    const isRouteActive = (route: string) => {
      if (route === "/messaging") {
        return pathname === "/messaging" || pathname === "/messaging/"
      }
      return pathname.startsWith(route)
    }

    // Check if this is an admin route
    const isAdminRoute = pathname.startsWith("/admin")

    // Add home/dashboard as first item (only if not on root path and not admin route)
    if (pathname !== "/" && !isAdminRoute) {
      items.push({
        label: t("breadcrumb.home"),
        href: "/",
        isActive: false,
      })
    }

    // Find current route
    const currentRoute = findRoute(pathname)

    if (currentRoute && currentRoute.navigationConfig) {
      const routePath = currentRoute.path.replace("/*", "")
      const label = getTranslatedLabel(currentRoute.navigationConfig.key)

      // If it's the root route, don't add duplicate
      if (routePath !== "/") {
        items.push({
          label,
          href: routePath,
          isActive: isRouteActive(routePath),
        })
      }

      // Handle sub-routes (e.g., /wiki/detail/xxx, /profile/event-debugger)
      if (pathname !== routePath && pathname.startsWith(routePath)) {
        const subPath = pathname.replace(routePath, "")
        const segments = subPath.split("/").filter(Boolean)

        if (segments.length > 0) {
          // Add sub-route segments
          segments.forEach((segment, index) => {
            const segmentPath = `${routePath}/${segments
              .slice(0, index + 1)
              .join("/")}`
            const decodedSegment = decodeURIComponent(segment)
            
            // Translate sub-route segments based on parent route
            let label = decodedSegment
            
            // Handle profile route sub-routes
            if (routePath === "/profile") {
              // Map profile sub-routes to translation keys
              const profileRouteMap: Record<string, string> = {
                "event-debugger": "profile.sidebar.eventDebugger",
                "event-logs": "profile.sidebar.eventLogs",
                "event-explorer": "profile.sidebar.eventExplorer",
                "agent-management": "profile.sidebar.agentManagement",
                "network-profile": "profile.sidebar.networkProfile",
                "agent-groups": "profile.sidebar.agentGroups",
              }
              
              const translationKey = profileRouteMap[decodedSegment]
              if (translationKey) {
                const profileTranslated = tProfile(translationKey, { defaultValue: null })
                if (profileTranslated && profileTranslated !== translationKey) {
                  label = profileTranslated
                }
              }
              
              // If not found in map, try direct lookup with sidebar prefix
              if (label === decodedSegment) {
                const profileSidebarKey = `profile.sidebar.${decodedSegment}`
                const profileTranslated = tProfile(profileSidebarKey, { defaultValue: null })
                if (profileTranslated && profileTranslated !== profileSidebarKey) {
                  label = profileTranslated
                }
              }
            }
            
            items.push({
              label,
              href: segmentPath,
              isActive: index === segments.length - 1,
            })
          })
        }
      }
    } else {
      // If no route found, use pathname segments
      const segments = pathname.split("/").filter(Boolean)
      segments.forEach((segment, index) => {
        const segmentPath = "/" + segments.slice(0, index + 1).join("/")
        const decodedSegment = decodeURIComponent(segment)
        
        // Translate common route segments
        let label = decodedSegment
        
        // Handle user-dashboard route
        if (decodedSegment === "user-dashboard") {
          label = t("navigation.userDashboard", { defaultValue: "User Dashboard" })
        } else if (isAdminRoute) {
          // Map admin route paths to translation keys
          const adminRouteMap: Record<string, string> = {
            "dashboard": "sidebar.items.dashboard",
            "transports": "sidebar.items.transports",
            "network": "sidebar.items.networkProfile",
            "publish": "sidebar.items.publishNetwork",
            "import-export": "sidebar.items.importExport",
            "agents": "sidebar.items.connectedAgents",
            "groups": "sidebar.items.agentGroups",
            "service-agents": "sidebar.items.serviceAgents",
            "connect": "sidebar.items.connectionGuide",
            "mods": "sidebar.items.modManagement",
            "events": "sidebar.items.eventLogs",
            "event-explorer": "sidebar.items.eventExplorer",
            "llm-logs": "sidebar.items.llmLogs",
            "debugger": "sidebar.items.eventDebugger",
          }
          
          // First try to get translation from admin.sidebar.items using the map
          const translationKey = adminRouteMap[decodedSegment]
          if (translationKey) {
            const adminTranslated = tAdmin(translationKey, { defaultValue: null })
            if (adminTranslated && adminTranslated !== translationKey) {
              label = adminTranslated
            }
          }
          
          // If not found in map, try direct lookup
          if (label === decodedSegment) {
            const adminSidebarKey = `sidebar.items.${decodedSegment}`
            const adminTranslated = tAdmin(adminSidebarKey, { defaultValue: null })
            if (adminTranslated && adminTranslated !== adminSidebarKey) {
              label = adminTranslated
            }
          }
          
          // Fallback to breadcrumb translations
          if (label === decodedSegment) {
            const breadcrumbKey = `breadcrumb.${decodedSegment.toLowerCase()}`
            const breadcrumbTranslated = t(breadcrumbKey, { defaultValue: null })
            if (breadcrumbTranslated && breadcrumbTranslated !== breadcrumbKey) {
              label = breadcrumbTranslated
            }
          }
          
          // Final fallback: capitalize first letter
          if (label === decodedSegment) {
            label = decodedSegment.charAt(0).toUpperCase() + decodedSegment.slice(1)
          }
        }
        
        items.push({
          label,
          href: segmentPath,
          isActive: index === segments.length - 1,
        })
      })
    }

    return items
  }, [location.pathname, t, tAdmin, tProfile, isAdmin])

  const handleBreadcrumbClick = (
    href: string,
    e: MouseEvent<HTMLAnchorElement>
  ) => {
    e.preventDefault()
    navigate(href)
  }

  // Check if this is an admin route
  const isAdminRoute = location.pathname.startsWith("/admin")

  const handleSwitchToAdmin = () => {
    navigate("/admin/dashboard")
  }

  const handleSwitchToUser = () => {
    navigate("/")
  }

  return (
    <div className="flex flex-row items-center gap-2 h-[var(--header-height)] px-4 lg:px-6 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-zinc-950">
      {!isMobile && !isSidebarOpen && (
        <Button
          mode="icon"
          variant="ghost"
          onClick={sidebarToggle}
          className="hidden lg:inline-flex text-muted-foreground hover:text-foreground"
        >
          <PanelLeft className="opacity-100 size-4" />
        </Button>
      )}
      <Breadcrumb className="flex-1 min-w-0 overflow-hidden">
        <BreadcrumbList className="gap-1.5 items-center flex-nowrap min-w-0">
          {breadcrumbItems.map((item, index) => {
            // Truncate long labels (e.g., UUIDs) for display but show full in tooltip
            const isLongLabel = item.label.length > 20
            const displayLabel = isLongLabel
              ? `${item.label.slice(0, 8)}...${item.label.slice(-4)}`
              : item.label

            return (
              <Fragment key={`${item.href}-${index}`}>
                <BreadcrumbItem className="min-w-0 flex-shrink-0 last:flex-shrink last:min-w-0">
                  {item.isActive ? (
                    <BreadcrumbPage
                      className="text-sm font-normal text-gray-700 dark:text-gray-200 truncate max-w-[200px]"
                      title={isLongLabel ? item.label : undefined}
                    >
                      {displayLabel}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink
                      href={item.href}
                      onClick={(e) => handleBreadcrumbClick(item.href, e)}
                      className="text-sm font-normal text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors duration-200 cursor-pointer truncate max-w-[200px]"
                      title={isLongLabel ? item.label : undefined}
                    >
                      {displayLabel}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {index < breadcrumbItems.length - 1 && (
                  <BreadcrumbSeparator className="text-gray-400 dark:text-gray-500 text-sm flex-shrink-0">
                    /
                  </BreadcrumbSeparator>
                )}
              </Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>

      {/* Switch to Admin button - only show for admin users when not in admin routes */}
      {isAdmin && !isAdminRoute && (
        <Button
          onClick={handleSwitchToAdmin}
          variant="outline"
          size="sm"
          title={t("navigation.switchToAdmin.title", {
            default: "Switch to Admin Dashboard",
          })}
          className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 flex-shrink-0"
        >
          <LayoutDashboard className="w-4 h-4 mr-1.5" />
          <span className="hidden sm:inline">{t("navigation.switchToAdmin.button", { default: "Admin" })}</span>
        </Button>
      )}

      {/* Switch to User button - only show when in admin routes */}
      {isAdminRoute && (
        <Button
          onClick={handleSwitchToUser}
          variant="outline"
          size="sm"
          title={t("navigation.switchToUser.title", {
            default: "Switch to User Console",
          })}
          className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 flex-shrink-0"
        >
          <User className="w-4 h-4 mr-1.5" />
          <span className="hidden sm:inline">{t("navigation.switchToUser.button", { default: "User Console" })}</span>
        </Button>
      )}
    </div>
  )
}
