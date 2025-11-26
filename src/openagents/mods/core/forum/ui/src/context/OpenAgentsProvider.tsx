/**
 * Simplified OpenAgents Provider for Forum Mod UI
 *
 * Responsibilities:
 * 1. Maintain a single HttpEventConnector instance
 * 2. Listen and manage connection state changes
 * 3. Provide connection state to components
 * 4. Expose connector instance for direct use by other components
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { HttpEventConnector } from "../services/eventConnector";
import { useAuthStore } from "../stores/authStore";
import { eventRouter } from "../services/eventRouter";
import { toast } from "sonner";

// Simplified connection state enum
export enum ConnectionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  ERROR = "error",
}

// Connection status details
export interface ConnectionStatus {
  state: ConnectionState;
  agentId?: string;
  originalAgentId?: string;
  isUsingModifiedId?: boolean;
  error?: string;
  reconnectAttempt?: number;
  maxReconnectAttempts?: number;
}

// Context interface
interface OpenAgentsContextType {
  // Core connector instance
  connector: HttpEventConnector | null;

  // Connection status
  connectionStatus: ConnectionStatus;
  isConnected: boolean;

  // Connection management
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;

  // Error handling
  clearError: () => void;
}

export const OpenAgentsContext = createContext<
  OpenAgentsContextType | undefined
>(undefined);

interface OpenAgentsProviderProps {
  children: ReactNode;
}

export const OpenAgentsProvider: React.FC<OpenAgentsProviderProps> = ({
  children,
}) => {
  const { agentName, selectedNetwork, getPasswordHash } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [connector, setConnector] = useState<HttpEventConnector | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    state: ConnectionState.DISCONNECTED,
  });

  const connectorRef = useRef<HttpEventConnector | null>(null);

  // Clean up connector
  const cleanUpConnector = useCallback(() => {
    if (connectorRef.current) {
      console.log("🔧 Cleaning up OpenAgents connector");
      const connectorTemp = connectorRef.current;
      connectorRef.current = null;
      setConnector(null);

      // Reset connection status
      setConnectionStatus({
        state: ConnectionState.DISCONNECTED,
      });

      // Cleanup event router
      eventRouter.cleanup();

      connectorTemp.disconnect().catch((error) => {
        console.warn("Error during connector cleanup:", error);
      });
    }
  }, []);

  // Set up connection event listeners
  const setupConnectionListeners = useCallback(
    (connector: HttpEventConnector) => {
      // Connection successful
      connector.on("connected", (data: any) => {
        console.log("✅ Connected to OpenAgents network:", data);
        setConnectionStatus({
          state: ConnectionState.CONNECTED,
          agentId: connector.getAgentId(),
          originalAgentId: connector.getOriginalAgentId(),
          isUsingModifiedId: connector.isUsingModifiedId(),
        });

        // Initialize event router with this connector
        eventRouter.initialize(connector);
      });

      // Connection disconnected
      connector.on("disconnected", (data: any) => {
        console.log("🔌 Disconnected from OpenAgents network:", data);
        setConnectionStatus((prev) => ({
          ...prev,
          state: ConnectionState.DISCONNECTED,
          error: undefined,
        }));
      });

      // Connection error
      connector.on("connectionError", (data: any) => {
        console.error("❌ Connection error:", data);
        setConnectionStatus((prev) => ({
          ...prev,
          state: ConnectionState.ERROR,
          error: data.error || "Connection error",
        }));
      });

      // Reconnecting
      connector.on("reconnecting", (data: any) => {
        console.log("🔄 Reconnecting...", data);
        setConnectionStatus((prev) => ({
          ...prev,
          state: ConnectionState.RECONNECTING,
          reconnectAttempt: data.attempt,
          maxReconnectAttempts: data.maxAttempts,
          error: undefined,
        }));
        if (data.attempt === data.maxAttempts) {
          setConnectionStatus((prev) => ({
            ...prev,
            state: ConnectionState.ERROR,
            error: "Failed to reconnect",
          }));
        }
      });

      // Reconnection successful
      connector.on("reconnected", (data: any) => {
        console.log("🔄 ✅ Reconnected successfully:", data);
        setConnectionStatus({
          state: ConnectionState.CONNECTED,
          agentId: connector.getAgentId(),
          originalAgentId: connector.getOriginalAgentId(),
          isUsingModifiedId: connector.isUsingModifiedId(),
          reconnectAttempt: undefined,
          maxReconnectAttempts: undefined,
        });
      });

      // Connection lost
      connector.on("connectionLost", (data: any) => {
        console.error("💔 Connection lost:", data);
        setConnectionStatus((prev) => ({
          ...prev,
          state: ConnectionState.ERROR,
          error: data.reason || "Connection lost",
        }));
      });

      // Kicked from network
      connector.on("system.kicked", (event: any) => {
        const kickedBy = event.payload?.kicked_by || event.kicked_by || "admin";
        console.error("🚨 Kicked from network:", event);

        // Show toast notification
        toast.error(`You have been kicked by ${kickedBy}`, {
          description: "You will be redirected to network selection",
        });

        // Clean up and logout
        setTimeout(() => {
          // Clear stores
          useAuthStore.getState().clearNetwork();
          useAuthStore.getState().clearAgentName();
          useAuthStore.getState().clearPasswordHash();

          // Navigate to network selection
          navigate("/", { replace: true });
        }, 2000); // 2 second delay to show notification
      });

      // Initialize event router with this connector
      eventRouter.initialize(connector);
    },
    [navigate]
  );

  // Initialize connector
  const initializeConnector = useCallback(() => {
    if (!agentName || !selectedNetwork?.host || !selectedNetwork?.port) {
      console.log("🔧 Missing connection parameters:", {
        agentName,
        host: selectedNetwork?.host,
        port: selectedNetwork?.port,
      });
      return;
    }

    // Decrypt password hash before passing to connector
    const passwordHash = getPasswordHash();

    console.log("🔧 Initializing OpenAgents connector...", {
      agentId: agentName,
      host: selectedNetwork.host,
      port: selectedNetwork.port,
      hasPasswordHash: !!passwordHash,
    });

    const newConnector = new HttpEventConnector({
      agentId: agentName,
      host: selectedNetwork.host,
      port: selectedNetwork.port,
      passwordHash: passwordHash,
    });

    // Set up connection status listeners
    setupConnectionListeners(newConnector);

    connectorRef.current = newConnector;
    setConnector(newConnector);

    // Auto-connect
    newConnector.connect().catch((error) => {
      console.error("Auto-connect failed:", error);
      setConnectionStatus((prev) => ({
        ...prev,
        state: ConnectionState.ERROR,
        error: `Auto-connect failed: ${error.message}`,
      }));
    });
  }, [
    agentName,
    selectedNetwork?.host,
    selectedNetwork?.port,
    getPasswordHash,
    setupConnectionListeners,
  ]);

  // Initialize and cleanup
  useEffect(() => {
    cleanUpConnector();
    initializeConnector();
  }, [cleanUpConnector, initializeConnector]);

  useEffect(() => {
    return () => {
      cleanUpConnector();
    };
  }, [cleanUpConnector]);

  // API methods
  const connect = useCallback(async (): Promise<boolean> => {
    if (!connector) {
      console.warn("No connector available for connection");
      return false;
    }

    setConnectionStatus((prev) => ({
      ...prev,
      state: ConnectionState.CONNECTING,
      error: undefined,
    }));

    try {
      const success = await connector.connect();
      if (!success) {
        setConnectionStatus((prev) => ({
          ...prev,
          state: ConnectionState.ERROR,
          error: "Failed to connect to OpenAgents network",
        }));
      }
      return success;
    } catch (error: any) {
      console.error("Connect error:", error);
      setConnectionStatus((prev) => ({
        ...prev,
        state: ConnectionState.ERROR,
        error: error.message || "Connection error",
      }));
      return false;
    }
  }, [connector]);

  const disconnect = useCallback(async (): Promise<void> => {
    if (!connector) return;

    try {
      await connector.disconnect();
    } catch (error: any) {
      console.error("Disconnect error:", error);
    }
  }, [connector]);

  const clearError = useCallback(() => {
    setConnectionStatus((prev) => ({
      ...prev,
      error: undefined,
    }));
  }, []);

  const isConnected = connectionStatus.state === ConnectionState.CONNECTED;

  const value: OpenAgentsContextType = {
    connector,
    connectionStatus,
    isConnected,
    connect,
    disconnect,
    clearError,
  };

  // Expose context to window for mod UIs to access
  useEffect(() => {
    // @ts-ignore
    window.__OPENAGENTS_CONTEXT__ = value;
    
    return () => {
      // @ts-ignore
      delete window.__OPENAGENTS_CONTEXT__;
    };
  }, [value]);

  return (
    <OpenAgentsContext.Provider value={value}>
      {children}
    </OpenAgentsContext.Provider>
  );
};

export const useOpenAgents = (): OpenAgentsContextType => {
  const context = useContext(OpenAgentsContext);
  if (context === undefined) {
    throw new Error("useOpenAgents must be used within an OpenAgentsProvider");
  }
  return context;
};

