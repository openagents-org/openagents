import React, { useEffect, useState, useCallback } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { useAuthStore } from "@/stores/authStore"
import { useChatStore } from "@/stores/chatStore"
import { routes } from "./routeConfig"
import { useDynamicRoutes } from "@/hooks/useDynamicRoutes"
import { isRouteAvailable } from "@/utils/moduleUtils"
import { fetchNetworkById } from "@/services/networkService"
import { clearAllOpenAgentsDataForLogout } from "@/utils/cookies"

interface RouteGuardProps {
  children: React.ReactNode
}

/**
 * Global route guard - centralized handling of all page flow routing logic
 * Determines which page the user should be on based on current state
 */
const RouteGuard: React.FC<RouteGuardProps> = ({ children }) => {
  const location = useLocation()
  const { selectedNetwork, agentName, clearNetwork, clearAgentName } =
    useAuthStore()
  const { clearAllChatData } = useChatStore()
  const { isModulesLoaded, defaultRoute, enabledModules } = useDynamicRoutes()
  const currentPath = location.pathname

  const [networkIdChecking, setNetworkIdChecking] = useState(false)
  const [networkIdChecked, setNetworkIdChecked] = useState(false)
  const [moduleLoadTimeout, setModuleLoadTimeout] = useState(false)

  // Check for network-id URL parameter
  const urlParams = new URLSearchParams(location.search)
  const networkIdParam = urlParams.get("network-id")

  // Set timeout for module loading (15 seconds)
  useEffect(() => {
    if (selectedNetwork && agentName && !isModulesLoaded && !moduleLoadTimeout) {
      const timeoutId = setTimeout(() => {
        console.warn('⚠️ Module loading timeout after 15 seconds, allowing navigation to continue')
        setModuleLoadTimeout(true)
      }, 15000) // 15 second timeout

      return () => clearTimeout(timeoutId)
    } else {
      setModuleLoadTimeout(false)
    }
  }, [selectedNetwork, agentName, isModulesLoaded, moduleLoadTimeout])

  console.log(
    `🛡️ RouteGuard: path=${currentPath}, network=${!!selectedNetwork}, agent=${!!agentName}, modulesLoaded=${isModulesLoaded}, networkIdParam=${networkIdParam}`
  )

  // Helper function to check if current network matches the requested network ID
  const checkNetworkIdMatch = useCallback(
    async (networkId: string): Promise<boolean> => {
      if (!selectedNetwork) return false

      try {
        const networkResult = await fetchNetworkById(networkId)
        if (!networkResult.success) return false

        const network = networkResult.network
        let targetHost = network.profile?.host
        let targetPort = network.profile?.port

        console.log(networkResult, "------")

        // Extract host/port from connection endpoint if not directly available
        if (!targetHost || !targetPort) {
          if (network.profile?.connection?.endpoint) {
            const endpoint = network.profile.connection.endpoint

            if (endpoint.startsWith("modbus://")) {
              const url = new URL(endpoint)
              targetHost = url.hostname
              targetPort = parseInt(url.port)
            } else if (
              endpoint.startsWith("http://") ||
              endpoint.startsWith("https://")
            ) {
              const url = new URL(endpoint)
              targetHost = url.hostname
              targetPort =
                parseInt(url.port) ||
                (endpoint.startsWith("https://") ? 443 : 80)
            } else {
              const parts = endpoint.split(":")
              if (parts.length >= 2) {
                targetHost = parts[0]
                targetPort = parseInt(parts[1])
              }
            }
          }
        }

        if (!targetPort) targetPort = 8700

        console.log(selectedNetwork, targetHost, targetPort, "+++")

        // Compare with current network
        return (
          selectedNetwork.host === targetHost &&
          selectedNetwork.port === targetPort
        )
      } catch (error) {
        console.error("Error checking network ID match:", error)
        return false
      }
    },
    [selectedNetwork]
  )

  // Effect to handle network-id checking for logged-in users
  useEffect(() => {
    if (networkIdParam && selectedNetwork && agentName && currentPath === "/") {
      setNetworkIdChecking(true)
      setNetworkIdChecked(false)
      checkNetworkIdMatch(networkIdParam).then((matches) => {
        if (!matches) {
          console.log(
            `🚪 Network ID ${networkIdParam} doesn't match current network, triggering logout directly`
          )

          // Execute logout logic directly in useEffect
          clearNetwork()
          clearAgentName()
          console.log("🧹 Network and agent state cleared")

          clearAllChatData()
          console.log("🧹 Chat store data cleared")

          clearAllOpenAgentsDataForLogout()
          console.log("🧹 OpenAgents data cleared for logout")
        } else {
          console.log(
            `✅ Network ID ${networkIdParam} matches current network, no logout needed`
          )
        }
        setNetworkIdChecking(false)
        setNetworkIdChecked(true)
      })
    } else {
      // No network-id parameter or not on root path, mark as checked
      setNetworkIdChecked(true)
    }
  }, [
    networkIdParam,
    selectedNetwork,
    agentName,
    currentPath,
    checkNetworkIdMatch,
    clearNetwork,
    clearAgentName,
    clearAllChatData,
  ])

  // Show loading while checking network ID match
  if (networkIdChecking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">
            Checking network connection...
          </p>
        </div>
      </div>
    )
  }

  // Handle root path "/" - NetworkSelectionPage is now served directly under /
  if (currentPath === "/") {
    // If user is fully setup (has network and agent), redirect to default route or show network selection
    if (selectedNetwork && agentName) {
      // Wait for modules to load before redirecting - this ensures we get the correct defaultRoute
      // (e.g., /readme if README content is available)
      if (!isModulesLoaded && !moduleLoadTimeout) {
        console.log(
          `🔄 Root path: Waiting for modules to load before redirecting...`
        )
        return (
          <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400">
                Loading...
              </p>
            </div>
          </div>
        )
      }

      // If module loading timed out, redirect to default route anyway
      if (!isModulesLoaded && moduleLoadTimeout) {
        console.warn('⚠️ Module loading timed out, redirecting to default route')
        return <Navigate to={defaultRoute} replace />
      }

      // Check if there's a network-id parameter
      if (networkIdParam) {
        // network-id checking is handled by useEffect above
        // Wait for checking to complete before redirecting
        if (!networkIdChecked) {
          console.log(
            `🔄 Root path with network-id: Waiting for network check to complete...`
          )
          // Don't redirect yet, wait for check to complete (loading screen is shown above)
          return null
        }

        // Check completed and networks match (otherwise state would be cleared)
        console.log(
          `🔄 Root path with network-id: Network check passed, redirecting to ${defaultRoute}`
        )
        return <Navigate to={defaultRoute} replace />
      } else {
        // No network-id parameter, normal redirect to default route
        console.log(
          `🔄 Root path: User setup complete, redirecting to ${defaultRoute}`
        )
        return <Navigate to={defaultRoute} replace />
      }
    }
    // If user is not fully setup, show NetworkSelectionPage (which is served under /)
    // Return children to render the NetworkSelectionPage
    console.log("🔄 Root path: Showing network selection page")
    return <>{children}</>
  }

  // Handle /onboarding path access control
  if (currentPath === "/onboarding") {
    if (!selectedNetwork) {
      console.log("🔄 Onboarding accessed without network, redirecting to /")
      return <Navigate to="/" replace />
    }
    // Has network selection, allow access to onboarding
    return <>{children}</>
  }

  // Handle /agent-setup path access control
  if (currentPath === "/agent-setup") {
    if (!selectedNetwork) {
      console.log("🔄 Agent setup accessed without network, redirecting to /")
      return <Navigate to="/" replace />
    }
    // Has network selection, allow access to agent-setup
    return <>{children}</>
  }

  // Handle /admin-login path access control
  if (currentPath === "/admin-login") {
    // Check for pending connection in location state (passed from ManualNetwork)
    const locationState = location.state as { pendingConnection?: unknown } | null
    const hasPendingConnection = !!locationState?.pendingConnection

    if (!selectedNetwork && !hasPendingConnection) {
      console.log("🔄 Admin login accessed without network, redirecting to /")
      return <Navigate to="/" replace />
    }
    // Has network selection or pending connection, allow access to admin-login
    return <>{children}</>
  }

  // NetworkSelectionPage is now served under /, so no special handling needed here

  // Handle authenticated routes (ModSidebar related routes)
  const isAuthenticatedRoute = routes.some((route) => {
    if (!route.requiresAuth) return false

    const routePath = route.path

    // Handle wildcard paths (e.g. "/forum/*")
    if (routePath.endsWith("/*")) {
      const basePath = routePath.slice(0, -2) // Remove "/*"
      return currentPath === basePath || currentPath.startsWith(basePath + "/")
    }

    // Handle parameterized paths (e.g. "/project/:projectId")
    if (routePath.includes(":")) {
      const basePath = routePath.split("/:")[0]
      return currentPath === basePath || currentPath.startsWith(basePath + "/")
    }

    // Exact match
    return currentPath === routePath
  })

  if (isAuthenticatedRoute) {
    // Accessing authenticated route, check if setup is complete
    if (!selectedNetwork) {
      console.log(
        `🔄 Authenticated route ${currentPath} accessed without network, redirecting to /`
      )
      // Preserve network-id parameter if it exists
      const redirectUrl = networkIdParam
        ? `/?network-id=${encodeURIComponent(networkIdParam)}`
        : "/"
      return <Navigate to={redirectUrl} replace />
    }

    if (!agentName) {
      console.log(
        `🔄 Authenticated route ${currentPath} accessed without agent, redirecting to /agent-setup`
      )
      return <Navigate to="/agent-setup" replace />
    }

    // Check if route is available in enabled modules
    // Special case: project routes (/project and /project/:projectId) are always available
    // as they provide project management and private chat room functionality
    const isProjectRoute = currentPath.startsWith("/project")
    // Special case: admin routes (/admin/*) are always available for admin users
    // AdminRouteGuard will handle permission checking
    const isAdminRoute = currentPath.startsWith("/admin")
    // Special case: user-dashboard route is always available for non-admin users
    const isUserDashboardRoute = currentPath.startsWith("/user-dashboard")

    if (
      isModulesLoaded &&
      !isProjectRoute &&
      !isAdminRoute &&
      !isUserDashboardRoute &&
      !isRouteAvailable(currentPath, enabledModules)
    ) {
      console.log(
        `🔄 Route ${currentPath} not available in enabled modules, redirecting to ${defaultRoute}`
      )
      return <Navigate to={defaultRoute} replace />
    }

    // Setup complete, allow access to authenticated route
    return <>{children}</>
  }

  // Handle invalid paths - redirect to appropriate page
  // Don't redirect if we're on an admin route - let AdminRouteGuard handle it
  const isAdminRoute = currentPath.startsWith("/admin")
  
  if (selectedNetwork && agentName) {
    // If on admin route, let it pass through to AdminRouteGuard
    if (isAdminRoute) {
      return <>{children}</>
    }
    console.log(
      `🔄 Invalid route ${currentPath} with complete setup, redirecting to ${defaultRoute}`
    )
    return <Navigate to={defaultRoute} replace />
  } else {
    console.log(
      `🔄 Invalid route ${currentPath} without setup, redirecting to /`
    )
    // Preserve network-id parameter if it exists
    const redirectUrl = networkIdParam
      ? `/?network-id=${encodeURIComponent(networkIdParam)}`
      : "/"
    return <Navigate to={redirectUrl} replace />
  }
}

export default RouteGuard
