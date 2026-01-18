import React, { ReactNode, useContext, useState } from "react"
import ConnectionLoadingOverlay from "./ConnectionLoadingOverlay"
import {
  OpenAgentsProvider,
  OpenAgentsContext,
} from "@/context/OpenAgentsProvider"
import { useAuthStore } from "@/stores/authStore"
import { Navigate, useLocation } from "react-router-dom"
import { useIsMobile } from "@/hooks/useMediaQuery"
import { LayoutProvider, useLayout } from "./components/context"
import { HeaderBreadcrumbs } from "./components/header-breadcrumbs"
import { SidebarSecondary } from "./components/sidebar-secondary"
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet"
import { Button } from "./ui/button"
import { Menu } from "lucide-react"

interface RootLayoutProps {
  children: ReactNode
}

// Conditionally rendered OpenAgents Provider wrapper
const ConditionalOpenAgentsProvider: React.FC<{
  children: React.ReactNode
}> = ({ children }) => {
  const { selectedNetwork, agentName } = useAuthStore()

  // Only initialize OpenAgentsProvider after basic setup is complete
  if (selectedNetwork && agentName) {
    console.log("🚀 RootLayout: Initializing OpenAgentsProvider", {
      network:
        selectedNetwork?.networkInfo?.name ||
        `${selectedNetwork?.host}:${selectedNetwork?.port}`,
      agentName,
    })
    return <OpenAgentsProvider>{children}</OpenAgentsProvider>
  }

  return <Navigate to="/network-selection" />
}

/**
 * Root layout component - responsible for overall layout structure
 * Contains: middle content area (secondary sidebar + main content)
 *
 * Now also responsible for conditionally rendering OpenAgentsProvider:
 * - Only initializes OpenAgentsProvider after user completes network selection and agent setup
 * - This ensures all pages using RootLayout can access OpenAgents context
 */
const RootLayout: React.FC<RootLayoutProps> = ({ children }) => {
  return (
    <ConditionalOpenAgentsProvider>
      <RootLayoutContent>{children}</RootLayoutContent>
    </ConditionalOpenAgentsProvider>
  )
}

// Internal component that can access LayoutProvider context
const MainContentArea: React.FC<{
  children: ReactNode
  shouldHideSidebar: boolean
  shouldHideBreadcrumbs: boolean
}> = ({ children, shouldHideSidebar, shouldHideBreadcrumbs }) => {
  const isMobile = useIsMobile()
  const { isSidebarOpen } = useLayout()

  return (
    <main
      className={`
      flex-1 flex flex-col overflow-hidden relative
      ${
        isMobile
          ? "m-0 rounded-none border-0"
          : "m-2 rounded-xl shadow-md border border-gray-200 dark:border-gray-700"
      }
      bg-white
      dark:bg-zinc-900
    `}
    >
      {/* Content area with secondary sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Secondary Sidebar */}
        {!shouldHideSidebar && isSidebarOpen && (
          <div
            className="hidden md:block flex-shrink-0"
            style={{
              width:
                "calc(var(--sidebar-width) - var(--sidebar-collapsed-width))",
            }}
          >
            <SidebarSecondary />
          </div>
        )}

        {/* Page Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-zinc-900">
          {/* Breadcrumb Navigation - fixed at top, doesn't scroll */}
          {!shouldHideBreadcrumbs && (
            <div className="flex-shrink-0">
              <HeaderBreadcrumbs />
            </div>
          )}

          {/* Scrollable Content */}
          <div className="flex-1 overflow-auto bg-white dark:bg-zinc-950">
            {children}
          </div>
        </div>
      </div>
    </main>
  )
}

// Actual layout content component
const RootLayoutContent: React.FC<RootLayoutProps> = ({ children }) => {
  const context = useContext(OpenAgentsContext)
  const isConnected = context?.isConnected || false
  const location = useLocation()
  const isMobile = useIsMobile()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  // Routes that should hide the secondary sidebar (mod pages)
  const HIDE_SECONDARY_SIDEBAR_ROUTES = [
    "/user-dashboard",
    "/readme",
    "/messaging",
    "/feed",
    "/project",
    "/forum",
    "/artifact",
    "/wiki",
    "/documents",
    "/agentworld",
    "/profile",
    "/mod-management",
    "/service-agents",
    "/llm-logs",
    "/admin",
  ]

  // Determine if current route should hide the secondary sidebar (content sidebar)
  const pathname = location.pathname.replace(/\/$/, "") // Remove trailing slash
  const shouldHideSecondarySidebar = HIDE_SECONDARY_SIDEBAR_ROUTES.some(
    route => pathname === route || pathname.startsWith(route + "/")
  )

  // Determine if breadcrumbs should be hidden (only for agentworld)
  const shouldHideBreadcrumbs = location.pathname.startsWith("/agentworld")

  // Note: Admin users can access both admin routes and user routes
  // The only restriction is that non-admin users cannot access /admin/* routes
  // (handled by AdminRouteGuard)

  // Close drawer when route changes on mobile
  React.useEffect(() => {
    if (isMobile) {
      setIsDrawerOpen(false)
    }
  }, [location.pathname, isMobile])

  return (
    <div className="h-screen flex overflow-hidden bg-white dark:bg-zinc-950 text-gray-900 dark:text-gray-100">
      {/* Connection status overlay - only shown when OpenAgentsProvider exists but not connected */}
      {context && !isConnected && <ConnectionLoadingOverlay />}

      {context && isConnected && (
        <LayoutProvider>
          {/* Middle content area: main content */}
          <div className="flex-1 flex overflow-hidden relative">
            {/* Mobile menu button - only shown on mobile */}
            {/* Use Tailwind responsive classes: show by default, hide on md (768px) and up */}
            {!shouldHideSecondarySidebar && (
              <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="
                      fixed top-4 left-4 z-30
                      md:hidden
                    "
                    aria-label="Open menu"
                  >
                    <Menu className="w-6 h-6" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="w-[85%] max-w-[400px] p-0 border-e-0"
                >
                  <LayoutProvider>
                    <div className="flex-1 flex flex-col overflow-hidden">
                      <SidebarSecondary />
                    </div>
                  </LayoutProvider>
                </SheetContent>
              </Sheet>
            )}

            {/* Main content area - uses internal component to access LayoutProvider context */}
            <MainContentArea
              shouldHideSidebar={shouldHideSecondarySidebar}
              shouldHideBreadcrumbs={shouldHideBreadcrumbs}
            >
              {children}
            </MainContentArea>
          </div>
        </LayoutProvider>
      )}
    </div>
  )
}

export default RootLayout
