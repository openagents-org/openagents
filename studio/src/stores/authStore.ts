import { create } from "zustand";
import { persist } from "zustand/middleware";
import { NetworkConnection } from "@/types/connection";
import { encryptForStorage, decryptFromStorage } from "@/utils/storageEncryption";

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
  agentGroup: string | null;
  setAgentGroup: (group: string | null) => void;
  clearAgentGroup: () => void;
  passwordHashEncrypted: string | null; // Store encrypted version
  setPasswordHash: (hash: string | null) => void; // Encrypts before storing
  getPasswordHash: () => string | null; // Decrypts when retrieving
  clearPasswordHash: () => void;

  // Module management
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
      agentGroup: null,
      passwordHashEncrypted: null,

      // Initialize module state
      moduleState: {
        enabledModules: [],
        defaultRoute: null,
        modulesLoaded: false,
        networkId: null,
        networkName: null,
      },

      handleNetworkSelected: (network: NetworkConnection | null) => {
        set({ selectedNetwork: network });
        // Clear modules when network changes
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

      setAgentGroup: (group: string | null) => {
        set({ agentGroup: group });
      },

      clearAgentGroup: () => {
        set({ agentGroup: null });
      },

      setPasswordHash: (hash: string | null) => {
        if (!hash) {
          set({ passwordHashEncrypted: null });
          console.log('🔑 Password hash cleared');
          return;
        }

        try {
          const encrypted = encryptForStorage(hash);
          set({ passwordHashEncrypted: encrypted });
          console.log('🔑 Password hash encrypted and stored');
        } catch (error) {
          console.error('❌ Failed to encrypt password hash:', error);
          // Fallback: don't store if encryption fails
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
          console.error('❌ Failed to decrypt password hash:', error);
          // Clear corrupted data
          get().clearPasswordHash();
          return null;
        }
      },

      clearPasswordHash: () => {
        set({ passwordHashEncrypted: null });
        console.log('🔑 Password hash cleared from storage');
      },

      clearNetwork: () => {
        set({ selectedNetwork: null });
        get().clearModules();
        get().clearPasswordHash();
        get().clearAgentGroup();
      },

      // Module management actions
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
        return state.defaultRoute || '/profile';
      },

      isModuleEnabled: (moduleName: string) => {
        return get().moduleState.enabledModules.includes(moduleName);
      },
    }),
    {
      name: "auth-storage", // key for persistent storage
      partialize: (state) => ({
        selectedNetwork: state.selectedNetwork,
        agentName: state.agentName,
        agentGroup: state.agentGroup,
        passwordHashEncrypted: state.passwordHashEncrypted, // Persist encrypted password hash
        moduleState: state.moduleState,
      }), // persist network, agent, agent group, encrypted password hash, and module state
    }
  )
);
