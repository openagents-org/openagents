import { create } from "zustand";
import { getCurrentNetworkHealth } from "../services/networkService";
import { useAuthStore } from "./authStore";
import { HealthResponse } from "../utils/moduleUtils";
import { useMemo } from "react";

interface ProfileState {
  healthData: HealthResponse | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  connectionLatency: number | null;
  isOnline: boolean;
  fetchProfileData: () => Promise<void>;
  clearProfileData: () => void;
  refreshData: () => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  healthData: null,
  loading: false,
  error: null,
  lastUpdated: null,
  connectionLatency: null,
  isOnline: false,

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
      const startTime = Date.now();
      const healthResult = await getCurrentNetworkHealth(selectedNetwork);
      const latency = Date.now() - startTime;

      if (healthResult.success && healthResult.data) {
        set({
          healthData: healthResult.data,
          loading: false,
          error: null,
          lastUpdated: new Date(),
          connectionLatency: latency,
          isOnline: healthResult.data.data?.is_running || false,
        });
      } else {
        set({
          loading: false,
          error: healthResult.error || "Failed to fetch health data",
          isOnline: false,
        });
      }
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
        isOnline: false,
      });
    }
  },

  clearProfileData: () => {
    set({
      healthData: null,
      loading: false,
      error: null,
      lastUpdated: null,
      connectionLatency: null,
      isOnline: false,
    });
  },

  refreshData: async () => {
    await get().fetchProfileData();
  },

  setLoading: (loading: boolean) => {
    set({ loading });
  },

  setError: (error: string | null) => {
    set({ error });
  },
}));

export const profileSelectors = {
  useHealthData: () => useProfileStore((state) => state.healthData),
  useLoading: () => useProfileStore((state) => state.loading),
  useError: () => useProfileStore((state) => state.error),
  useLastUpdated: () => useProfileStore((state) => state.lastUpdated),
  useConnectionLatency: () =>
    useProfileStore((state) => state.connectionLatency),
  useIsOnline: () => useProfileStore((state) => state.isOnline),
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
      return healthData.data.mods?.filter((mod) => mod.enabled).length || 0;
    }, [healthData]);
  },
  useFetchProfileData: () =>
    useProfileStore((state) => state.fetchProfileData),
  useClearProfileData: () =>
    useProfileStore((state) => state.clearProfileData),
  useRefreshData: () => useProfileStore((state) => state.refreshData),
};

