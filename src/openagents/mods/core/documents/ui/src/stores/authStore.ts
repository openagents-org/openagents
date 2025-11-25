import { create } from "zustand";
import { persist } from "zustand/middleware";
import { NetworkConnection } from "../types/connection";
import {
  encryptForStorage,
  decryptFromStorage,
} from "../utils/storageEncryption";

interface ModuleState {
  enabledModules: string[];
  defaultRoute: string | null;
  modulesLoaded: boolean;
  networkId: string | null;
  networkName: string | null;
}

interface NetworkState {
  selectedNetwork: NetworkConnection | null;
  handleNetworkSelected: (network: NetworkConnection | null) => void;
  clearNetwork: () => void;
  agentName: string | null;
  setAgentName: (name: string | null) => void;
  clearAgentName: () => void;
  passwordHashEncrypted: string | null;
  setPasswordHash: (hash: string | null) => void;
  getPasswordHash: () => string | null;
  clearPasswordHash: () => void;
  moduleState: ModuleState;
  setModules: (modules: {
    enabledModules: string[];
    defaultRoute: string;
    networkId: string;
    networkName: string;
  }) => void;
  clearModules: () => void;
  isModuleLoaded: () => boolean;
  getDefaultRoute: () => string;
  isModuleEnabled: (moduleName: string) => boolean;
}

export const useAuthStore = create<NetworkState>()(
  persist(
    (set, get) => ({
      selectedNetwork: null,
      agentName: null,
      passwordHashEncrypted: null,
      moduleState: {
        enabledModules: [],
        defaultRoute: null,
        modulesLoaded: false,
        networkId: null,
        networkName: null,
      },

      handleNetworkSelected: (network: NetworkConnection | null) => {
        set({ selectedNetwork: network });
        if (network) {
          get().clearModules();
        }
      },

      setAgentName: (name: string | null) => {
        set({ agentName: name });
      },

      clearAgentName: () => {
        set({ agentName: null });
      },

      setPasswordHash: (hash: string | null) => {
        if (!hash) {
          set({ passwordHashEncrypted: null });
          console.log("🔑 Password hash cleared");
          return;
        }

        try {
          const encrypted = encryptForStorage(hash);
          set({ passwordHashEncrypted: encrypted });
          console.log("🔑 Password hash encrypted and stored");
        } catch (error) {
          console.error("❌ Failed to encrypt password hash:", error);
          set({ passwordHashEncrypted: null });
        }
      },

      getPasswordHash: () => {
        const encrypted = get().passwordHashEncrypted;
        if (!encrypted) {
          return null;
        }

        try {
          const decrypted = decryptFromStorage(encrypted);
          return decrypted;
        } catch (error) {
          console.error("❌ Failed to decrypt password hash:", error);
          get().clearPasswordHash();
          return null;
        }
      },

      clearPasswordHash: () => {
        set({ passwordHashEncrypted: null });
        console.log("🔑 Password hash cleared from storage");
      },

      clearNetwork: () => {
        set({ selectedNetwork: null });
        get().clearModules();
        get().clearPasswordHash();
      },

      setModules: (modules) => {
        set({
          moduleState: {
            enabledModules: modules.enabledModules,
            defaultRoute: modules.defaultRoute,
            modulesLoaded: true,
            networkId: modules.networkId,
            networkName: modules.networkName,
          },
        });
      },

      clearModules: () => {
        set({
          moduleState: {
            enabledModules: [],
            defaultRoute: null,
            modulesLoaded: false,
            networkId: null,
            networkName: null,
          },
        });
      },

      isModuleLoaded: () => {
        return get().moduleState.modulesLoaded;
      },

      getDefaultRoute: () => {
        const state = get().moduleState;
        return state.defaultRoute || "/documents";
      },

      isModuleEnabled: (moduleName: string) => {
        return get().moduleState.enabledModules.includes(moduleName);
      },
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({
        selectedNetwork: state.selectedNetwork,
        agentName: state.agentName,
        passwordHashEncrypted: state.passwordHashEncrypted,
        moduleState: state.moduleState,
      }),
    }
  )
);

