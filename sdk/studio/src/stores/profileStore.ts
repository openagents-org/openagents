import { create } from "zustand";
import { getCurrentNetworkHealth } from "@/services/networkService";
import { useAuthStore } from "@/stores/authStore";
import { HealthResponse } from "@/utils/moduleUtils";
import { useMemo } from "react";

interface ProfileState {
  // Health data state
  healthData: HealthResponse | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;

  // Additional state information
  connectionLatency: number | null;
  isOnline: boolean;

  // Actions
  fetchProfileData: () => Promise<void>;
  clearProfileData: () => void;
  refreshData: () => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  // Initial state
  healthData: null,
  loading: false,
  error: null,
  lastUpdated: null,
  connectionLatency: null,
  isOnline: false,

  // Fetch Profile data
  fetchProfileData: async () => {
    const { selectedNetwork } = useAuthStore.getState();

    if (!selectedNetwork) {
      set({
        error: "No network selected",
        loading: false,
        isOnline: false,
      });
      return;
    }

    set({ loading: true, error: null });

    try {
      console.log("ProfileStore: Fetching health data for profile...");
      const startTime = Date.now();

      const healthResult = await getCurrentNetworkHealth(selectedNetwork);

      const latency = Date.now() - startTime;

      if (healthResult.success && healthResult.data) {
        console.log("ProfileStore: Health data fetched successfully");
        set({
          healthData: healthResult.data,
          loading: false,
          error: null,
          lastUpdated: new Date(),
          connectionLatency: latency,
          isOnline: healthResult.data.data?.is_running || false,
        });
      } else {
        console.error("ProfileStore: Failed to fetch health data:", healthResult.error);
        set({
          loading: false,
          error: healthResult.error || "Failed to fetch health data",
          isOnline: false,
        });
      }
    } catch (error) {
      console.error("ProfileStore: Error fetching health data:", error);
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        isOnline: false,
      });
    }
  },

  // Clear Profile data
  clearProfileData: () => {
    console.log("ProfileStore: Clearing profile data");
    set({
      healthData: null,
      loading: false,
      error: null,
      lastUpdated: null,
      connectionLatency: null,
      isOnline: false,
    });
  },

  // Refresh data
  refreshData: async () => {
    console.log("ProfileStore: Refreshing profile data");
    await get().fetchProfileData();
  },

  // Set loading state
  setLoading: (loading: boolean) => {
    set({ loading });
  },

  // Set error state
  setError: (error: string | null) => {
    set({ error });
  },
}));

// Export state selectors for convenient component usage
export const profileSelectors = {
  // Basic state
  useHealthData: () => useProfileStore((state) => state.healthData),
  useLoading: () => useProfileStore((state) => state.loading),
  useError: () => useProfileStore((state) => state.error),
  useLastUpdated: () => useProfileStore((state) => state.lastUpdated),
  useConnectionLatency: () => useProfileStore((state) => state.connectionLatency),
  useIsOnline: () => useProfileStore((state) => state.isOnline),

  // Computed state - use useMemo to cache calculation results
  useNetworkInfo: () => {
    const healthData = useProfileStore((state) => state.healthData);
    return useMemo(() => {
      if (!healthData) return null;
      return {
        networkId: healthData.data.network_id,
        networkName: healthData.data.network_name,
        isRunning: healthData.data.is_running,
        status: healthData.status,
      };
    }, [healthData]);
  },

  useModulesInfo: () => {
    const healthData = useProfileStore((state) => state.healthData);
    return useMemo(() => {
      if (!healthData) return [];
      return healthData.data.mods || [];
    }, [healthData]);
  },

  useEnabledModulesCount: () => {
    const healthData = useProfileStore((state) => state.healthData);
    return useMemo(() => {
      if (!healthData) return 0;
      return healthData.data.mods?.filter(mod => mod.enabled).length || 0;
    }, [healthData]);
  },

  // Actions
  useFetchProfileData: () => useProfileStore((state) => state.fetchProfileData),
  useClearProfileData: () => useProfileStore((state) => state.clearProfileData),
  useRefreshData: () => useProfileStore((state) => state.refreshData),
};