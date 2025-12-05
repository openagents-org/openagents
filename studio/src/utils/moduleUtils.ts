import { PLUGIN_NAME_ENUM } from "@/types/plugins"
import { updateRouteVisibility } from "@/config/routeConfig"

// Module name to plugin enum mapping
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
}

// Extract enabled modules from API health check response
export interface ModuleInfo {
  name: string
  enabled: boolean
  config?: Record<string, any>
}

export interface HealthResponse {
  success: boolean
  status: string
  data: {
    network_id: string
    network_name: string
    is_running: boolean
    mods: ModuleInfo[]
    readme?: string
    network_profile?: {
      readme?: string
      [key: string]: any
    }
    [key: string]: any
  }
}

/**
 * Extract module name from full module name
 * Example: 'openagents.mods.workspace.messaging' -> 'messaging'
 */
export const extractModuleName = (fullModuleName: string): string => {
  return fullModuleName.split(".").pop() || ""
}

/**
 * Get enabled modules list from health check response
 */
export const getEnabledModules = (healthResponse: HealthResponse): string[] => {
  if (!healthResponse.success || !healthResponse.data?.mods) {
    return []
  }

  return healthResponse.data.mods
    .filter((mod) => mod.enabled)
    .map((mod) => extractModuleName(mod.name))
    .filter((moduleName) => moduleName in MODULE_PLUGIN_MAP)
}

/**
 * Update route visibility based on enabled modules
 */
export const updateRouteVisibilityFromModules = (
  enabledModules: string[]
): void => {
  // First hide all main routes (only keep Profile always visible, it's not a mod)
  // Settings should also be controlled by network if it exists as a mod
  Object.values(PLUGIN_NAME_ENUM).forEach((plugin) => {
    if (plugin !== PLUGIN_NAME_ENUM.PROFILE && plugin !== PLUGIN_NAME_ENUM.README && plugin !== PLUGIN_NAME_ENUM.SERVICE_AGENTS) {
      updateRouteVisibility(plugin, false)
    }
  })

  // Ensure README and SERVICE_AGENTS are always visible
  updateRouteVisibility(PLUGIN_NAME_ENUM.README, true)
  updateRouteVisibility(PLUGIN_NAME_ENUM.SERVICE_AGENTS, true)

  // Then enable routes based on mods returned from network
  enabledModules.forEach((moduleName) => {
    const plugin = MODULE_PLUGIN_MAP[moduleName]
    if (plugin) {
      console.log(`✅ updateRouteVisibility: ${moduleName} -> ${plugin}`)
      updateRouteVisibility(plugin, true)
    }
  })
  
  console.log(`📊 updateRouteVisibilityFromModules: ${enabledModules.join(', ')}`)
}

/**
 * Get default route (first enabled module)
 */
export const getDefaultRoute = (enabledModules: string[], hasReadme: boolean = false): string => {
  // If README content is available, prioritize the readme page
  if (hasReadme) {
    return "/readme"
  }

  if (enabledModules.length === 0) {
    // If no modules enabled, fallback to profile
    return "/profile"
  }

  // Sort modules by priority
  const priorityOrder = ["messaging", "documents", "forum", "artifact", "wiki", "feed"]

  for (const priority of priorityOrder) {
    if (enabledModules.includes(priority)) {
      return `/${priority}`
    }
  }

  // If no matching priority module, return first available
  return `/${enabledModules[0]}`
}

/**
 * Check if specific module is enabled
 */
export const isModuleEnabled = (
  moduleName: string,
  enabledModules: string[]
): boolean => {
  return enabledModules.includes(moduleName)
}

/**
 * Validate if route is available in enabled modules
 */
export const isRouteAvailable = (
  route: string,
  enabledModules: string[]
): boolean => {
  // Extract first path segment as module name
  const routeName = route.replace(/^\//, "").split("/")[0]

  // Check special routes (always available)
  const alwaysAvailableRoutes = [
    "profile",
    "settings",
    "network-selection",
    "agent-setup",
    "agentworld",
    "artifact", // Artifact 始终可用，类似 Project
    "readme", // README 始终可用，显示网络文档
    "studio", // Studio 管理路由始终可用（如服务代理管理）
  ]
  if (alwaysAvailableRoutes.includes(routeName)) {
    return true
  }

  return enabledModules.includes(routeName)
}

/**
 * Generate complete route config from health check response
 */
export const generateRouteConfigFromHealth = (
  healthResponse: HealthResponse
) => {
  const enabledModules = getEnabledModules(healthResponse)

  // Check if README content is available
  const readmeContent = healthResponse.data?.network_profile?.readme || healthResponse.data?.readme || ""
  const hasReadme = readmeContent.trim().length > 0

  const defaultRoute = getDefaultRoute(enabledModules, hasReadme)

  return {
    enabledModules,
    defaultRoute,
    networkId: healthResponse.data.network_id,
    networkName: healthResponse.data.network_name,
  }
}
