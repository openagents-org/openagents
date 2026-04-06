import { useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { getCurrentNetworkHealth } from '@/services/networkService';
import {
  generateRouteConfigFromHealth,
  updateRouteVisibilityFromModules,
} from '@/utils/moduleUtils';

/**
 * Hook to manage dynamic route configuration based on network health
 *
 * This hook:
 * 1. Detects when network + agent are first selected or changed
 * 2. Fetches /api/health to get available modules
 * 3. Updates route visibility based on enabled modules
 * 4. Sets the default route for navigation
 *
 * It only triggers on initial connection or when user logs out and reconnects.
 */
export const useDynamicRoutes = () => {
  const {
    selectedNetwork,
    agentName,
    moduleState,
    setModules,
    clearModules,
    isModuleLoaded,
    getDefaultRoute,
  } = useAuthStore();

  // Track previous values to detect changes
  const prevNetworkRef = useRef<string | null>(null);
  const prevAgentRef = useRef<string | null>(null);
  const isLoadingRef = useRef(false);

  /**
   * Load modules from network health endpoint
   */
  const loadModules = useCallback(async () => {
    if (!selectedNetwork || !agentName || isLoadingRef.current) {
      return;
    }

    isLoadingRef.current = true;

    try {
      console.log('🔄 Loading modules from network health...');

      const healthResult = await getCurrentNetworkHealth(selectedNetwork);

      if (!healthResult.success || !healthResult.data) {
        console.error('❌ Failed to load network health:', healthResult.error);
        return;
      }

      const routeConfig = generateRouteConfigFromHealth(healthResult.data);

      console.log('✅ Modules loaded successfully:', {
        enabledModules: routeConfig.enabledModules,
        defaultRoute: routeConfig.defaultRoute,
        networkId: routeConfig.networkId,
      });

      // Update route visibility
      updateRouteVisibilityFromModules(routeConfig.enabledModules);

      // Save to store
      setModules({
        enabledModules: routeConfig.enabledModules,
        defaultRoute: routeConfig.defaultRoute,
        networkId: routeConfig.networkId,
        networkName: routeConfig.networkName,
      });

    } catch (error) {
      console.error('❌ Error loading modules:', error);
    } finally {
      isLoadingRef.current = false;
    }
  }, [selectedNetwork, agentName, setModules]);

  /**
   * Check if we need to load or reload modules
   */
  const shouldLoadModules = useCallback(() => {
    if (!selectedNetwork || !agentName) {
      return false;
    }

    const currentNetworkKey = `${selectedNetwork.host}:${selectedNetwork.port}`;
    const prevNetworkKey = prevNetworkRef.current;
    const prevAgent = prevAgentRef.current;

    // Load modules if:
    // 1. First time setup (no previous network/agent)
    // 2. Network changed
    // 3. Agent changed
    // 4. Modules not loaded for current network
    const networkChanged = currentNetworkKey !== prevNetworkKey;
    const agentChanged = agentName !== prevAgent;
    const modulesNotLoaded = !isModuleLoaded() || moduleState.networkId !== currentNetworkKey;

    return networkChanged || agentChanged || modulesNotLoaded;
  }, [selectedNetwork, agentName, isModuleLoaded, moduleState.networkId]);

  /**
   * Handle module loading logic
   */
  useEffect(() => {
    const currentNetworkKey = selectedNetwork ? `${selectedNetwork.host}:${selectedNetwork.port}` : null;

    // Update refs
    prevNetworkRef.current = currentNetworkKey;
    prevAgentRef.current = agentName;

    // Clear modules if no network/agent
    if (!selectedNetwork || !agentName) {
      if (isModuleLoaded()) {
        console.log('🧹 Clearing modules - no network/agent selected');
        clearModules();
      }
      return;
    }

    // Load modules if needed
    if (shouldLoadModules()) {
      console.log('🚀 Loading modules for network:', currentNetworkKey);
      loadModules();
    }
  }, [selectedNetwork, agentName, shouldLoadModules, loadModules, clearModules, isModuleLoaded]);

  /**
   * Handle logout - clear modules when user logs out
   */
  const handleLogout = useCallback(() => {
    console.log('👋 User logged out - clearing modules');
    clearModules();
    prevNetworkRef.current = null;
    prevAgentRef.current = null;
  }, [clearModules]);

  return {
    // State
    isModulesLoaded: isModuleLoaded(),
    enabledModules: moduleState.enabledModules,
    defaultRoute: getDefaultRoute(),
    networkId: moduleState.networkId,
    networkName: moduleState.networkName,

    // Actions
    reloadModules: loadModules,
    handleLogout,

    // Utilities
    isModuleEnabled: (moduleName: string) => moduleState.enabledModules.includes(moduleName),
  };
};