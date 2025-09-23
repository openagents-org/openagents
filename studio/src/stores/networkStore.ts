import { create } from "zustand";
import { persist } from "zustand/middleware";
import { NetworkConnection } from "@/types/connection";

interface NetworkState {
  selectedNetwork: NetworkConnection | null;
  agentName: string | null;
  handleNetworkSelected: (network: NetworkConnection | null) => void;
  setAgentName: (name: string | null) => void;
  clearAgentName: () => void;
  clearNetwork: () => void;
}

export const useNetworkStore = create<NetworkState>()(
  persist(
    (set) => ({
      selectedNetwork: null,
      agentName: null,

      handleNetworkSelected: (network: NetworkConnection | null) => {
        set({ selectedNetwork: network });
      },

      setAgentName: (name: string | null) => {
        set({ agentName: name });
      },

      clearAgentName: () => {
        set({ agentName: null });
      },

      clearNetwork: () => {
        set({ selectedNetwork: null });
      },
    }),
    {
      name: "network-storage", // 持久化存储的 key
      partialize: (state) => ({
        selectedNetwork: state.selectedNetwork,
        agentName: state.agentName,
      }), // 持久化 selectedNetwork 和 agentName
    }
  )
);
