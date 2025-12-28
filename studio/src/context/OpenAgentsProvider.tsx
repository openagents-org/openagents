/**
 * Simplified OpenAgents Provider - focused on connection state management
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
import { HttpEventConnector } from "@/services/eventConnector";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { useDocumentStore } from "@/stores/documentStore";
import { eventRouter } from "@/services/eventRouter";
import { notificationService } from "@/services/notificationService";
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
  const { agentName, selectedNetwork, getPasswordHash, agentGroup, setAgentGroup, passwordHashEncrypted } = useAuthStore();
  const { selectChannel, selectDirectMessage } = useChatStore();
  const { setConnection, setupEventListeners, cleanupEventListeners } =
    useDocumentStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [connector, setConnector] = useState<HttpEventConnector | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    state: ConnectionState.DISCONNECTED,
  });

  const connectorRef = useRef<HttpEventConnector | null>(null);
  const globalNotificationHandlerRef = useRef<((event: any) => void) | null>(
    null
  );

  // Track the credentials used for the current connector to prevent unnecessary re-initialization
  const currentCredentialsRef = useRef<string | null>(null);

  // Clean up connector (optionally preserves credentials ref for re-initialization comparison)
  const cleanUpConnector = useCallback((preserveCredentials: boolean = false) => {
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

      // Cleanup global notification handler
      if (globalNotificationHandlerRef.current) {
        eventRouter.offChatEvent(globalNotificationHandlerRef.current);
        globalNotificationHandlerRef.current = null;
      }

      // Cleanup document event listeners
      cleanupEventListeners();

      // Only clear credentials if not preserving (e.g., during unmount)
      if (!preserveCredentials) {
        currentCredentialsRef.current = null;
      }

      connectorTemp.disconnect().catch((error) => {
        console.warn("Error during connector cleanup:", error);
      });
    }
  }, [cleanupEventListeners]);

  // Set up connection event listeners
  const setupConnectionListeners = useCallback(
    (connector: HttpEventConnector) => {
      // Connection successful
      connector.on("connected", async (data: any) => {
        console.log("✅ Connected to OpenAgents network:", data);
        setConnectionStatus({
          state: ConnectionState.CONNECTED,
          agentId: connector.getAgentId(),
          originalAgentId: connector.getOriginalAgentId(),
          isUsingModifiedId: connector.isUsingModifiedId(),
        });

        // Fetch agent group from health data (only update if different to avoid re-initialization loop)
        try {
          const healthData = await connector.getNetworkHealth();
          const currentAgentId = connector.getAgentId();
          if (healthData && healthData.agents && healthData.agents[currentAgentId]) {
            const detectedGroup = healthData.agents[currentAgentId].group;
            const currentGroup = useAuthStore.getState().agentGroup;
            if (detectedGroup && detectedGroup !== currentGroup) {
              console.log(`👥 Agent group detected: ${detectedGroup} (was: ${currentGroup})`);
              setAgentGroup(detectedGroup);
            }
          }
        } catch (error) {
          console.error("Failed to fetch agent group:", error);
        }

        // Set up global document event listeners
        console.log("🔧 Setting up global document event listeners");
        setConnection(connector);
        setupEventListeners();
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
      connector.on("reconnected", async (data: any) => {
        console.log("🔄 ✅ Reconnected successfully:", data);
        setConnectionStatus({
          state: ConnectionState.CONNECTED,
          agentId: connector.getAgentId(),
          originalAgentId: connector.getOriginalAgentId(),
          isUsingModifiedId: connector.isUsingModifiedId(),
          reconnectAttempt: undefined,
          maxReconnectAttempts: undefined,
        });

        // Re-fetch agent group after reconnection (only update if different to avoid re-initialization loop)
        try {
          const healthData = await connector.getNetworkHealth();
          const currentAgentId = connector.getAgentId();
          if (healthData && healthData.agents && healthData.agents[currentAgentId]) {
            const detectedGroup = healthData.agents[currentAgentId].group;
            const currentGroup = useAuthStore.getState().agentGroup;
            if (detectedGroup && detectedGroup !== currentGroup) {
              console.log(`👥 Agent group re-detected after reconnection: ${detectedGroup} (was: ${currentGroup})`);
              setAgentGroup(detectedGroup);
            }
          }
        } catch (error) {
          console.error("Failed to re-fetch agent group:", error);
        }
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
          useAuthStore.getState().clearAgentGroup();
          useAuthStore.getState().clearPasswordHash();
          useChatStore.getState().clearAllChatData();

          // Navigate to network selection
          navigate("/network-selection", { replace: true });
        }, 2000); // 2 second delay to show notification
      });

      // Initialize event router with this connector
      eventRouter.initialize(connector);
    },
    [setConnection, setupEventListeners, navigate, setAgentGroup]
  );

  // Set up global notification listener (only active on non-messaging pages)
  const setupGlobalNotificationListener = useCallback(() => {
    const isMessagingPage =
      location.pathname === "/messaging" ||
      location.pathname.startsWith("/messaging/");

    // Clean up existing global listener
    if (globalNotificationHandlerRef.current) {
      eventRouter.offChatEvent(globalNotificationHandlerRef.current);
      globalNotificationHandlerRef.current = null;
    }

    // Only set up global notification listener on non-messaging pages when connected
    if (
      !isMessagingPage &&
      connectionStatus.state === ConnectionState.CONNECTED
    ) {
      console.log(
        "🔔 Setting up global notification listener (not on messaging page)"
      );

      const globalNotificationHandler = (event: any) => {
        console.log(
          "🔔 Global notification handler received event:",
          event.event_name,
          event
        );

        // Handle channel message notifications
        if (
          event.event_name === "thread.channel_message.notification" &&
          event.payload
        ) {
          const messageData = event.payload;
          if (messageData.channel && messageData.content) {
            const senderName =
              event.sender_id || event.source_id || "Unknown user";
            const content =
              typeof messageData.content === "string"
                ? messageData.content
                : messageData.content.text || "";

            notificationService.showChatNotification(
              senderName,
              messageData.channel,
              content,
              messageData.message_type
            );
          }
        }

        // Handle reply message notifications
        else if (
          event.event_name === "thread.reply.notification" &&
          event.payload
        ) {
          const messageData = event.payload;
          if (messageData.channel && messageData.content) {
            const senderName =
              messageData.original_sender || event.source_id || "Unknown user";
            const content =
              typeof messageData.content === "string"
                ? messageData.content
                : messageData.content.text || "";

            // Check if this is a reply to the current user's message
            const currentUserId = connectionStatus.agentId || agentName;
            if (
              messageData.reply_to_id &&
              currentUserId &&
              messageData.original_sender !== currentUserId
            ) {
              notificationService.showReplyNotification(
                senderName,
                messageData.channel,
                content
              );
            } else {
              // Regular reply message notification
              notificationService.showChatNotification(
                senderName,
                messageData.channel,
                content,
                messageData.message_type
              );
            }
          }
        }

        // Handle direct message notifications
        else if (
          event.event_name === "thread.direct_message.notification" &&
          event.payload
        ) {
          const messageData = event.payload;
          if (messageData.content) {
            const senderName =
              event.source_id || messageData.sender_id || "Unknown user";
            const content =
              typeof messageData.content === "string"
                ? messageData.content
                : messageData.content.text || "";

            notificationService.showDirectMessageNotification(
              senderName,
              content
            );
          }
        }
      };

      globalNotificationHandlerRef.current = globalNotificationHandler;
      eventRouter.onChatEvent(globalNotificationHandler);
    } else if (isMessagingPage) {
      console.log(
        "🔔 On messaging page, global notification listener disabled (chatStore handles notifications)"
      );
    }
  }, [
    location.pathname,
    connectionStatus.state,
    connectionStatus.agentId,
    agentName,
  ]);

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

    // HTTPS 功能：从 selectedNetwork 中获取 useHttps 参数
    const useHttps = selectedNetwork.useHttps || false;

    // Create a fingerprint of the current credentials to detect actual changes
    // This prevents re-initialization when React re-creates callback functions without actual data changes
    const credentialsFingerprint = JSON.stringify({
      agentName,
      host: selectedNetwork.host,
      port: selectedNetwork.port,
      useHttps,
      passwordHashEncrypted, // Use the encrypted hash as a proxy for the actual password
      agentGroup,
      networkId: selectedNetwork.networkId,
    });

    // Skip initialization if credentials haven't changed AND we have an existing connector
    if (connectorRef.current && currentCredentialsRef.current === credentialsFingerprint) {
      console.log("🔧 Skipping connector initialization - credentials unchanged");
      return;
    }

    // Clean up existing connector before creating a new one (preserving credentials for comparison)
    if (connectorRef.current) {
      console.log("🔧 Credentials changed, cleaning up old connector before re-initialization");
      cleanUpConnector(true); // preserve credentials ref temporarily
    }

    console.log("🔧 Initializing OpenAgents connector...", {
      agentId: agentName,
      host: selectedNetwork.host,
      port: selectedNetwork.port,
      useHttps: useHttps, // HTTPS 功能：显示连接协议
      hasPasswordHash: !!passwordHash,
      agentGroup: agentGroup,
      credentialsChanged: currentCredentialsRef.current !== credentialsFingerprint,
    });

    // Store the new credentials fingerprint
    currentCredentialsRef.current = credentialsFingerprint;

    // HTTPS 功能：创建连接器时传递 useHttps 参数
    // Network ID: Pass networkId for routing through network.openagents.org
    // Use getInstance() to ensure singleton behavior - prevents multiple connectors
    // from fighting over the same agent_id's secret during React remounts
    const newConnector = HttpEventConnector.getInstance({
      agentId: agentName,
      host: selectedNetwork.host,
      port: selectedNetwork.port,
      useHttps: useHttps, // HTTPS 功能：传递 useHttps 参数
      passwordHash: passwordHash,
      agentGroup: agentGroup,
      networkId: selectedNetwork.networkId, // Network ID for routing
    });

    // Set up connection status listeners
    setupConnectionListeners(newConnector);

    connectorRef.current = newConnector;
    setConnector(newConnector);

    // Auto-connect (getInstance may return an already-connected instance)
    if (!newConnector.isConnected()) {
      newConnector.connect().catch((error) => {
        console.error("Auto-connect failed:", error);
        setConnectionStatus((prev) => ({
          ...prev,
          state: ConnectionState.ERROR,
          error: `Auto-connect failed: ${error.message}`,
        }));
      });
    } else {
      // Already connected, just emit the connected event for this component
      console.log("♻️ Connector already connected, updating state");
      setConnectionStatus({
        state: ConnectionState.CONNECTED,
        agentId: newConnector.getAgentId(),
        originalAgentId: newConnector.getOriginalAgentId(),
        isUsingModifiedId: newConnector.isUsingModifiedId(),
      });
    }
  }, [
    agentName,
    selectedNetwork?.host,
    selectedNetwork?.port,
    selectedNetwork?.useHttps, // HTTPS 功能：添加 useHttps 依赖
    selectedNetwork?.networkId,
    getPasswordHash,
    passwordHashEncrypted, // Track actual password hash value to trigger re-initialization
    agentGroup,
    setupConnectionListeners,
    cleanUpConnector,
  ]);

  // Initialize connector - the initializeConnector function handles its own
  // cleanup and deduplication via credentials fingerprinting
  useEffect(() => {
    initializeConnector();
  }, [initializeConnector]);

  useEffect(() => {
    return () => {
      cleanUpConnector();
    };
  }, [cleanUpConnector]);

  // Listen to route changes and connection status, auto setup/cleanup global notification listener
  useEffect(() => {
    setupGlobalNotificationListener();
  }, [setupGlobalNotificationListener]);

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

  // Global notification click handling
  const handleNotificationClick = useCallback(
    (event: CustomEvent) => {
      const { channel, sender } = event.detail;

      console.log("🔔 Global notification clicked:", {
        channel,
        sender,
        currentPath: location.pathname,
      });

      // Ensure on messaging page
      if (
        location.pathname !== "/messaging" &&
        !location.pathname.startsWith("/messaging/")
      ) {
        console.log("🔄 Navigating to messaging page from global handler...");
        navigate("/messaging");

        // Wait for page to load before selecting
        setTimeout(() => {
          if (channel) {
            console.log(`🔄 Selecting channel from global handler: ${channel}`);
            selectChannel(channel);
          } else if (sender) {
            console.log(
              `🔄 Selecting direct message from global handler: ${sender}`
            );
            selectDirectMessage(sender);
          }
        }, 100);
      } else {
        // Already on messaging page, select directly
        if (channel) {
          console.log(`🔄 Selecting channel: ${channel}`);
          selectChannel(channel);
        } else if (sender) {
          console.log(`🔄 Selecting direct message: ${sender}`);
          selectDirectMessage(sender);
        }
      }
    },
    [location.pathname, navigate, selectChannel, selectDirectMessage]
  );

  // Global notification click event listener
  useEffect(() => {
    const handleNotificationClickEvent = (event: Event) => {
      console.log("🔔 Notification clicked event:", event);
      handleNotificationClick(event as CustomEvent);
    };

    console.log("🔔 Setting up global notification-click listener");
    window.addEventListener("notification-click", handleNotificationClickEvent);

    return () => {
      console.log("🔔 Cleaning up global notification-click listener");
      window.removeEventListener(
        "notification-click",
        handleNotificationClickEvent
      );
    };
  }, [handleNotificationClick]);

  const isConnected = connectionStatus.state === ConnectionState.CONNECTED;

  const value: OpenAgentsContextType = {
    connector,
    connectionStatus,
    isConnected,
    connect,
    disconnect,
    clearError,
  };

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
