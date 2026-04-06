import { PLUGIN_NAME_ENUM } from "@/types/plugins"
import { updateRouteVisibility } from "@/config/routeConfig"

// Module name to plugin enum mapping
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
    initialized?: boolean
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
  // First hide all main routes (only keep Profile and README always visible)
  // Settings should also be controlled by network if it exists as a mod
  // LLM_LOGS and SERVICE_AGENTS are admin-only, controlled separately
  // AGENTWORLD is only visible if the agentworld mod is enabled
  Object.values(PLUGIN_NAME_ENUM).forEach((plugin) => {
    if (
      plugin !== PLUGIN_NAME_ENUM.PROFILE &&
      plugin !== PLUGIN_NAME_ENUM.README
    ) {
      updateRouteVisibility(plugin, false)
    }
  })

  // Ensure PROFILE and README are always visible
  // LLM_LOGS and SERVICE_AGENTS are admin-only (shown in admin dashboard)
  // AGENTWORLD visibility is controlled by whether the mod is enabled
  updateRouteVisibility(PLUGIN_NAME_ENUM.PROFILE, true)
  updateRouteVisibility(PLUGIN_NAME_ENUM.README, true)

  // Then enable routes based on mods returned from network
  enabledModules.forEach((moduleName) => {
    const plugin = MODULE_PLUGIN_MAP[moduleName]
    if (plugin) {
      console.log(`✅ updateRouteVisibility: ${moduleName} -> ${plugin}`)
      updateRouteVisibility(plugin, true)
    }
  })

  console.log(
    `📊 updateRouteVisibilityFromModules: ${enabledModules.join(", ")}`
  )
}

/**
 * Get default route - always returns user dashboard as the landing page
 */
export const getDefaultRoute = (
  enabledModules: string[],
  hasReadme: boolean = false
): string => {
  // Always redirect to user dashboard as the default landing page
  return "/user-dashboard"
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
  // Note: llm-logs and studio (service agents) are admin-only, accessed through admin dashboard
  // Note: agentworld visibility is controlled by whether the mod is enabled
  const alwaysAvailableRoutes = [
    "profile",
    "settings",
    "mod-management",
    "network-selection",
    "agent-setup",
    "artifact",
    "readme",
    "events",
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
  const readmeContent =
    healthResponse.data?.network_profile?.readme ||
    healthResponse.data?.readme ||
    ""
  const hasReadme = readmeContent.trim().length > 0

  const defaultRoute = getDefaultRoute(enabledModules, hasReadme)

  return {
    enabledModules,
    defaultRoute,
    networkId: healthResponse.data.network_id,
    networkName: healthResponse.data.network_name,
  }
}
