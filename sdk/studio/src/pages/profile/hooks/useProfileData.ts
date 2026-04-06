import { useEffect, useCallback, useRef } from 'react';
import { useProfileStore, profileSelectors } from '@/stores/profileStore';
import { useAuthStore } from '@/stores/authStore';

/**
 * Hook to manage profile data fetching and auto-refresh
 *
 * Features:
 * - Automatically fetches data when network/agent changes
 * - Provides manual refresh functionality
 * - Auto-refreshes data every 30 seconds
 * - Cleans up when component unmounts
 */
export const useProfileData = () => {
  const { selectedNetwork, agentName } = useAuthStore();

  // State selectors
  const healthData = profileSelectors.useHealthData();
  const loading = profileSelectors.useLoading();
  const error = profileSelectors.useError();
  const lastUpdated = profileSelectors.useLastUpdated();
  const connectionLatency = profileSelectors.useConnectionLatency();
  const isOnline = profileSelectors.useIsOnline();
  const networkInfo = profileSelectors.useNetworkInfo();
  const modulesInfo = profileSelectors.useModulesInfo();
  const enabledModulesCount = profileSelectors.useEnabledModulesCount();

  // Refs for tracking previous values and intervals
  const prevNetworkRef = useRef<string | null>(null);
  const prevAgentRef = useRef<string | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isFetchingRef = useRef<boolean>(false);

  // Manual refresh function with fetch guard
  const handleRefresh = useCallback(async () => {
    if (!isFetchingRef.current) {
      console.log('Profile: Manual refresh triggered');
      isFetchingRef.current = true;
      try {
        await useProfileStore.getState().refreshData();
      } finally {
        isFetchingRef.current = false;
      }
    }
  }, []);



  // Single effect to handle all data fetching and auto-refresh
  useEffect(() => {
    const currentNetworkKey = selectedNetwork ? `${selectedNetwork.host}:${selectedNetwork.port}` : null;
    const networkChanged = currentNetworkKey !== prevNetworkRef.current;
    const agentChanged = agentName !== prevAgentRef.current;
    const isInitialMount = prevNetworkRef.current === null && prevAgentRef.current === null;

    // Clear existing interval first
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }

    // Update refs first
    prevNetworkRef.current = currentNetworkKey;
    prevAgentRef.current = agentName;

    // Clear data if no network/agent
    if (!selectedNetwork || !agentName) {
      useProfileStore.getState().clearProfileData();
      isFetchingRef.current = false;
      return;
    }

    // Fetch data if needed (initial mount or network/agent changed)
    const shouldFetch = isInitialMount || networkChanged || agentChanged;
    if (shouldFetch && !isFetchingRef.current) {
      console.log('Profile: Fetching data for network:', currentNetworkKey, { isInitialMount, networkChanged, agentChanged });
      isFetchingRef.current = true;

      useProfileStore.getState().fetchProfileData().finally(() => {
        isFetchingRef.current = false;
      });
    }

    // Setup auto-refresh only if we have valid network and agent
    if (selectedNetwork && agentName) {
      console.log('Profile: Setting up auto-refresh (30s interval)');
      refreshIntervalRef.current = setInterval(() => {
        if (!isFetchingRef.current) {
          console.log('Profile: Auto-refresh triggered');
          isFetchingRef.current = true;
          useProfileStore.getState().refreshData().finally(() => {
            isFetchingRef.current = false;
          });
        }
      }, 30000); // 30 seconds
    }

    // Cleanup function
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, [selectedNetwork, agentName]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (refreshIntervalRef.current) {
        console.log('Profile: Cleaning up auto-refresh on unmount');
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, []);

  // Computed values
  const hasData = healthData !== null;
  const isConnected = isOnline && !error;
  const formattedLastUpdated = lastUpdated ? lastUpdated.toLocaleTimeString() : null;
  const formattedLatency = connectionLatency ? `${connectionLatency}ms` : null;

  return {
    // Raw data
    healthData,
    networkInfo,
    modulesInfo,

    // State
    loading,
    error,
    isOnline,
    hasData,
    isConnected,

    // Formatted data
    lastUpdated,
    formattedLastUpdated,
    connectionLatency,
    formattedLatency,
    enabledModulesCount,

    // Actions
    refresh: handleRefresh,
    clear: useProfileStore.getState().clearProfileData,
  };
};