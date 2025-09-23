/**
 * React Hook for OpenAgents Service
 *
 * This hook provides a clean React interface to the new event-driven OpenAgents service.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  OpenAgentsService,
  MessageSendResult,
  ThreadMessage,
  ThreadChannel,
  AgentInfo,
} from "@/services/openAgentsService";
import { ConnectionStatus, ConnectionStatusEnum } from "@/types/connection";

export interface UseOpenAgentsOptions {
  agentId: string;
  host?: string;
  port?: number;
  autoConnect?: boolean;
}

export interface UseOpenAgentsReturn {
  // Connection
  service: OpenAgentsService | null;
  connectionStatus: ConnectionStatus;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;

  // Messaging with immediate feedback
  sendChannelMessage: (
    channel: string,
    content: string,
    replyToId?: string
  ) => Promise<MessageSendResult>;
  sendDirectMessage: (
    targetAgentId: string,
    content: string
  ) => Promise<MessageSendResult>;
  addReaction: (
    messageId: string,
    reactionType: string,
    channel?: string
  ) => Promise<MessageSendResult>;
  removeReaction: (
    messageId: string,
    reactionType: string,
    channel?: string
  ) => Promise<MessageSendResult>;

  // Data loading with immediate results
  loadChannels: () => Promise<ThreadChannel[]>;
  loadChannelMessages: (
    channel: string,
    limit?: number,
    offset?: number
  ) => Promise<ThreadMessage[]>;
  loadDirectMessages: (
    targetAgentId: string,
    limit?: number,
    offset?: number
  ) => Promise<ThreadMessage[]>;
  loadConnectedAgents: () => Promise<AgentInfo[]>;

  // Real-time data
  channels: ThreadChannel[];
  messages: ThreadMessage[];
  setMessages: (messages: ThreadMessage[]) => void;

  // Loading states
  isLoading: boolean;
  setLoading: (loading: boolean) => void;

  // Error handling
  lastError: string | null;
  clearError: () => void;
}

export const useOpenAgents = (
  options: UseOpenAgentsOptions
): UseOpenAgentsReturn => {
  const [service, setService] = useState<OpenAgentsService | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    status: ConnectionStatusEnum.DISCONNECTED,
  });
  const [channels, setChannels] = useState<ThreadChannel[]>([]);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [isLoading, setLoading] = useState<boolean>(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Use ref to avoid recreating service on every render
  const serviceRef = useRef<OpenAgentsService | null>(null);

  const cleanUpService = useCallback((isUnmount) => {
    if (serviceRef.current) {
      console.log(
        `🔧 Cleaning up existing service for agent ${
          isUnmount ? "mount" : "unmount"
        }`,
        serviceRef.current.getAgentId?.() || "unknown"
      );
      const serviceTemp = serviceRef.current;
      serviceRef.current = null;
      !isUnmount && setService(null);
      serviceTemp.disconnect().catch((error) => {
        console.warn(
          `Error during service cleanup ${isUnmount ? "mount" : "unmount"} :`,
          error
        );
      });
    }
  }, []);

  const initializeService = useCallback(() => {
    if (!options.agentId || !options.host || !options.port) return;
    console.log("🔧 Initializing OpenAgents service...", {
      agentId: options.agentId,
      host: options.host,
      port: options.port,
      autoConnect: options.autoConnect,
    });

    const newService = new OpenAgentsService({
      agentId: options.agentId,
      host: options.host,
      port: options.port,
    });

    const handleNewMessagePush = (
      message: ThreadMessage,
      type: "Channel" | "Direct"
    ) => {
      console.log(
        `📨 New ${type} message received: `,
        `message_id: ${message.message_id}`,
        `channel: `,
        message.channel
      );
      setMessages((prev) => {
        // Check if message already exists (to avoid duplicates)
        const exists = prev.some(
          (existingMsg) => existingMsg.message_id === message.message_id
        );
        if (exists) {
          console.log(
            `📨 Duplicate ${type} message ignored: `,
            message.message_id
          );
          return prev;
        }
        // Only add messages that belong to the currently loaded channel
        // Note: This will be handled by the component's channel filtering logic
        return [...prev, message];
      });
    };

    // Setup event handlers
    newService.on("connectionStatusChanged", (status: ConnectionStatus) => {
      setConnectionStatus(status);
    });

    newService.on("connectionError", (data: any) => {
      setLastError(data.error || "Connection error");
    });

    newService.on("newChannelMessage", (message: ThreadMessage) => {
      handleNewMessagePush(message, "Channel");
    });

    newService.on("newDirectMessage", (message: ThreadMessage) => {
      handleNewMessagePush(message, "Direct");
    });

    newService.on("newReaction", (reaction: any) => {
      // Update reaction count in existing messages
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.message_id === reaction.message_id) {
            const reactions = { ...(msg.reactions || {}) };
            const reactionType = reaction.reaction_type;
            reactions[reactionType] = Math.max(
              (reactions[reactionType] || 0) +
                (reaction.action === "add" ? +1 : -1),
              0
            );
            return { ...msg, reactions };
          }
          return msg;
        })
      );
    });

    serviceRef.current = newService;
    setService(newService);

    // Auto-connect if requested
    if (options.autoConnect) {
      newService.connect().catch((error) => {
        setLastError(`Auto-connect failed: ${error.message}`);
      });
    }
  }, [options.agentId, options.host, options.port, options.autoConnect]);

  // Initialize service
  useEffect(() => {
    // Clean up any existing service first
    cleanUpService(false);
    initializeService();
  }, [cleanUpService, initializeService]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      cleanUpService(true);
    };
  }, [cleanUpService]);

  // Connection methods
  const connect = useCallback(async (): Promise<boolean> => {
    if (!service) return false;

    setLastError(null);
    setLoading(true);

    try {
      const success = await service.connect();
      if (!success) {
        setLastError("Failed to connect to OpenAgents network");
      }
      return success;
    } catch (error: any) {
      setLastError(error.message || "Connection error");
      return false;
    } finally {
      setLoading(false);
    }
  }, [service]);

  const disconnect = useCallback(async (): Promise<void> => {
    if (!service) return;

    try {
      await service.disconnect();
    } catch (error: any) {
      console.error("Disconnect error:", error);
    }
  }, [service]);

  // Messaging methods with immediate feedback
  const sendChannelMessage = useCallback(
    async (
      channel: string,
      content: string,
      replyToId?: string
    ): Promise<MessageSendResult> => {
      if (!service) {
        return { success: false, message: "Not connected to service" };
      }

      setLastError(null);

      try {
        const result = await service.sendChannelMessage(
          channel,
          content,
          replyToId
        );
        if (!result.success && result.message) {
          setLastError(result.message);
        }
        return result;
      } catch (error: any) {
        const errorMsg = error.message || "Failed to send message";
        setLastError(errorMsg);
        return { success: false, message: errorMsg };
      }
    },
    [service]
  );

  const sendDirectMessage = useCallback(
    async (
      targetAgentId: string,
      content: string
    ): Promise<MessageSendResult> => {
      if (!service) {
        return { success: false, message: "Not connected to service" };
      }

      setLastError(null);

      try {
        const result = await service.sendDirectMessage(targetAgentId, content);
        if (!result.success && result.message) {
          setLastError(result.message);
        }
        return result;
      } catch (error: any) {
        const errorMsg = error.message || "Failed to send direct message";
        setLastError(errorMsg);
        return { success: false, message: errorMsg };
      }
    },
    [service]
  );

  const addReaction = useCallback(
    async (
      messageId: string,
      reactionType: string,
      channel?: string
    ): Promise<MessageSendResult> => {
      if (!service) {
        return { success: false, message: "Not connected to service" };
      }

      try {
        const result = await service.addReaction(
          messageId,
          reactionType,
          channel
        );
        if (!result.success && result.message) {
          setLastError(result.message);
        }
        return result;
      } catch (error: any) {
        const errorMsg = error.message || "Failed to add reaction";
        setLastError(errorMsg);
        return { success: false, message: errorMsg };
      }
    },
    [service]
  );

  const removeReaction = useCallback(
    async (
      messageId: string,
      reactionType: string,
      channel?: string
    ): Promise<MessageSendResult> => {
      if (!service) {
        return { success: false, message: "Not connected to service" };
      }

      try {
        const result = await service.removeReaction(
          messageId,
          reactionType,
          channel
        );
        if (!result.success && result.message) {
          setLastError(result.message);
        }
        return result;
      } catch (error: any) {
        const errorMsg = error.message || "Failed to remove reaction";
        setLastError(errorMsg);
        return { success: false, message: errorMsg };
      }
    },
    [service]
  );

  // Data loading methods with immediate results
  const loadChannels = useCallback(async (): Promise<ThreadChannel[]> => {
    if (!service) return [];

    setLastError(null);
    setLoading(true);

    try {
      const channelList = await service.getChannels();
      setChannels(channelList);
      return channelList;
    } catch (error: any) {
      const errorMsg = error.message || "Failed to load channels";
      setLastError(errorMsg);
      return [];
    } finally {
      setLoading(false);
    }
  }, [service]);

  const loadChannelMessages = useCallback(
    async (
      channel: string,
      limit?: number,
      offset?: number
    ): Promise<ThreadMessage[]> => {
      if (!service) return [];

      setLastError(null);
      setLoading(true);

      try {
        const messageList = await service.getChannelMessages(
          channel,
          limit,
          offset
        );

        // Replace messages if offset is 0 (initial load), otherwise append (pagination)
        if (!offset || offset === 0) {
          setMessages(messageList);
        } else {
          // Prepend older messages, avoiding duplicates
          setMessages((prev) => {
            const existingIds = new Set(prev.map((msg) => msg.message_id));
            const newMessages = messageList.filter(
              (msg) => !existingIds.has(msg.message_id)
            );
            return [...newMessages, ...prev];
          });
        }

        return messageList;
      } catch (error: any) {
        const errorMsg = error.message || "Failed to load messages";
        setLastError(errorMsg);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [service]
  );

  const loadDirectMessages = useCallback(
    async (
      targetAgentId: string,
      limit?: number,
      offset?: number
    ): Promise<ThreadMessage[]> => {
      if (!service) return [];

      setLastError(null);
      setLoading(true);

      try {
        const messageList = await service.getDirectMessages(
          targetAgentId,
          limit,
          offset
        );

        // Replace messages if offset is 0 (initial load), otherwise append (pagination)
        if (!offset || offset === 0) {
          setMessages(messageList);
        } else {
          // Prepend older messages, avoiding duplicates
          setMessages((prev) => {
            const existingIds = new Set(prev.map((msg) => msg.message_id));
            const newMessages = messageList.filter(
              (msg) => !existingIds.has(msg.message_id)
            );
            return [...newMessages, ...prev];
          });
        }

        return messageList;
      } catch (error: any) {
        const errorMsg = error.message || "Failed to load direct messages";
        setLastError(errorMsg);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [service]
  );

  const loadConnectedAgents = useCallback(async (): Promise<AgentInfo[]> => {
    if (!service) return [];

    setLastError(null);

    try {
      const agentList = await service.getConnectedAgents();
      return agentList;
    } catch (error: any) {
      const errorMsg = error.message || "Failed to load connected agents";
      setLastError(errorMsg);
      return [];
    }
  }, [service]);

  const clearError = useCallback(() => {
    setLastError(null);
  }, []);

  return {
    // Connection
    service,
    connectionStatus,
    connect,
    disconnect,

    // Messaging
    sendChannelMessage,
    sendDirectMessage,
    addReaction,
    removeReaction,

    // Data loading
    loadChannels,
    loadChannelMessages,
    loadDirectMessages,
    loadConnectedAgents,

    // State
    channels,
    messages,
    setMessages,
    isLoading,
    setLoading,

    // Error handling
    lastError,
    clearError,
  };
};
