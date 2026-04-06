import { create } from "zustand";
import { persist } from "zustand/middleware";
import { NetworkConnection } from "@/types/connection";
import { encryptForStorage, decryptFromStorage } from "@/utils/storageEncryption";

// Session timeout in milliseconds (5 minutes)
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

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

  // Session management
  lastActivityTimestamp: number | null;
  updateActivity: () => void;
  isSessionValid: () => boolean;

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

// Helper function to validate NetworkConnection data
const isValidNetworkConnection = (data: any): data is NetworkConnection => {
  if (!data || typeof data !== 'object') return false;
  return (
    typeof data.host === 'string' &&
    data.host.length > 0 &&
    typeof data.port === 'number' &&
    data.port > 0 &&
    data.port <= 65535
  );
};

// Helper function to validate restored state
const validateRestoredState = (state: any): Partial<NetworkState> | null => {
  try {
    const validated: Partial<NetworkState> = {
      selectedNetwork: null,
      agentName: null,
      agentGroup: null,
      passwordHashEncrypted: null,
      lastActivityTimestamp: null,
      moduleState: {
        enabledModules: [],
        defaultRoute: null,
        modulesLoaded: false,
        networkId: null,
        networkName: null,
      },
    };

    // Validate selectedNetwork
    if (state.selectedNetwork) {
      if (isValidNetworkConnection(state.selectedNetwork)) {
        validated.selectedNetwork = state.selectedNetwork;
      } else {
        console.warn('⚠️ Invalid selectedNetwork data in localStorage, clearing it');
      }
    }

    // Validate agentName
    if (state.agentName !== null && state.agentName !== undefined) {
      if (typeof state.agentName === 'string') {
        validated.agentName = state.agentName;
      } else {
        console.warn('⚠️ Invalid agentName data in localStorage, clearing it');
      }
    }

    // Validate agentGroup
    if (state.agentGroup !== null && state.agentGroup !== undefined) {
      if (typeof state.agentGroup === 'string') {
        validated.agentGroup = state.agentGroup;
      } else {
        console.warn('⚠️ Invalid agentGroup data in localStorage, clearing it');
      }
    }

    // Validate passwordHashEncrypted
    if (state.passwordHashEncrypted !== null && state.passwordHashEncrypted !== undefined) {
      if (typeof state.passwordHashEncrypted === 'string') {
        validated.passwordHashEncrypted = state.passwordHashEncrypted;
      } else {
        console.warn('⚠️ Invalid passwordHashEncrypted data in localStorage, clearing it');
      }
    }

    // Validate lastActivityTimestamp
    if (state.lastActivityTimestamp !== null && state.lastActivityTimestamp !== undefined) {
      if (typeof state.lastActivityTimestamp === 'number') {
        validated.lastActivityTimestamp = state.lastActivityTimestamp;
      } else {
        console.warn('⚠️ Invalid lastActivityTimestamp data in localStorage, clearing it');
      }
    }

    // Validate moduleState
    if (state.moduleState && typeof state.moduleState === 'object') {
      const moduleState = state.moduleState;
      validated.moduleState = {
        enabledModules: Array.isArray(moduleState.enabledModules)
          ? moduleState.enabledModules.filter((m: any) => typeof m === 'string')
          : [],
        defaultRoute: null, // Always reset to null on restore
        modulesLoaded: false, // Always reset to false on restore
        networkId:
          typeof moduleState.networkId === 'string' ? moduleState.networkId : null,
        networkName:
          typeof moduleState.networkName === 'string' ? moduleState.networkName : null,
      };
    }

    return validated;
  } catch (error) {
    console.error('❌ Error validating restored state:', error);
    return null;
  }
};

export const useAuthStore = create<NetworkState>()(
  persist(
    (set, get) => ({
      selectedNetwork: null,
      agentName: null,
      agentGroup: null,
      passwordHashEncrypted: null,
      lastActivityTimestamp: null,

      // Initialize module state
      moduleState: {
        enabledModules: [],
        defaultRoute: null,
        modulesLoaded: false,
        networkId: null,
        networkName: null,
      },

      handleNetworkSelected: (network: NetworkConnection | null) => {
        set({ selectedNetwork: network, lastActivityTimestamp: Date.now() });
        // Clear modules when network changes
        if (network) {
          get().clearModules();
        }
      },

      setAgentName: (name: string | null) => {
        set({ agentName: name, lastActivityTimestamp: Date.now() });
      },

      clearAgentName: () => {
        set({ agentName: null });
      },

      setAgentGroup: (group: string | null) => {
        set({ agentGroup: group, lastActivityTimestamp: Date.now() });
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
          set({ passwordHashEncrypted: encrypted, lastActivityTimestamp: Date.now() });
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
        set({ selectedNetwork: null, lastActivityTimestamp: null });
        get().clearModules();
        get().clearPasswordHash();
        get().clearAgentGroup();
      },

      // Session management
      updateActivity: () => {
        set({ lastActivityTimestamp: Date.now() });
      },

      isSessionValid: () => {
        const timestamp = get().lastActivityTimestamp;
        if (!timestamp) return false;
        return Date.now() - timestamp < SESSION_TIMEOUT_MS;
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
      // Persist auth data for session recovery
      partialize: (state) => ({
        selectedNetwork: state.selectedNetwork,
        agentName: state.agentName,
        agentGroup: state.agentGroup,
        passwordHashEncrypted: state.passwordHashEncrypted,
        lastActivityTimestamp: state.lastActivityTimestamp,
        // Persist moduleState but exclude defaultRoute - it should be recalculated on each login
        // to ensure fresh README availability check
        moduleState: {
          ...state.moduleState,
          defaultRoute: null, // Don't persist - will be recalculated from health response
          modulesLoaded: false, // Force reload on next login
        },
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('❌ Error rehydrating auth store from localStorage:', error);
          // Clear corrupted storage
          try {
            localStorage.removeItem('auth-storage');
            console.log('🧹 Cleared corrupted auth-storage from localStorage');
          } catch (clearError) {
            console.error('❌ Failed to clear corrupted storage:', clearError);
          }
          return;
        }

        if (state) {
          // Validate and sanitize restored state
          const validated = validateRestoredState(state);
          if (validated) {
            // Check session timeout
            const timestamp = validated.lastActivityTimestamp;
            if (!timestamp || Date.now() - timestamp >= SESSION_TIMEOUT_MS) {
              console.log('🔒 Session expired, clearing auth data');
              // Clear expired session data
              state.selectedNetwork = null;
              state.agentName = null;
              state.agentGroup = null;
              state.passwordHashEncrypted = null;
              state.lastActivityTimestamp = null;
              state.moduleState = {
                enabledModules: [],
                defaultRoute: null,
                modulesLoaded: false,
                networkId: null,
                networkName: null,
              };
            } else {
              // Session valid - update state with validated data
              console.log('✅ Session valid, restoring auth data');
              if (validated.selectedNetwork !== undefined) {
                state.selectedNetwork = validated.selectedNetwork;
              }
              if (validated.agentName !== undefined) {
                state.agentName = validated.agentName;
              }
              if (validated.agentGroup !== undefined) {
                state.agentGroup = validated.agentGroup;
              }
              if (validated.passwordHashEncrypted !== undefined) {
                state.passwordHashEncrypted = validated.passwordHashEncrypted;
              }
              if (validated.moduleState) {
                state.moduleState = validated.moduleState;
              }
              // Update activity timestamp to extend session
              state.lastActivityTimestamp = Date.now();
            }
          } else {
            // Validation failed, reset to default state
            console.warn('⚠️ Restored state validation failed, resetting to default');
            state.selectedNetwork = null;
            state.agentName = null;
            state.agentGroup = null;
            state.passwordHashEncrypted = null;
            state.lastActivityTimestamp = null;
            state.moduleState = {
              enabledModules: [],
              defaultRoute: null,
              modulesLoaded: false,
              networkId: null,
              networkName: null,
            };
          }
        }
      },
    }
  )
);
