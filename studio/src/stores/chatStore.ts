import { create } from "zustand";
import { ThreadChannel, AgentInfo, EventNames } from "../types/events";
import {
  UnifiedMessage,
  RawThreadMessage,
  MessageAdapter,
} from "../types/message";
import { eventRouter } from "@/services/eventRouter";
import { notificationService } from "@/services/notificationService";

// Message sending status
export type MessageStatus = "sending" | "sent" | "failed";

// Optimistic update message interface
export interface OptimisticMessage extends UnifiedMessage {
  isOptimistic?: boolean;
  status?: MessageStatus;
  tempId?: string;
  originalId?: string;
  tempReactionId?: string; // Temporary reaction ID for identifying and rolling back optimistic reaction updates
  originalReactionCount?: number; // Original reaction count for rollback when removing reactions
}

// Chat Store interface
interface ChatState {
  // Connection - now obtained through context
  // connection: any | null;  // Removed, use context

  currentChannel: string | null;
  currentDirectMessage: string | null;

  // Persisted selection state - for restoring selection after page refresh
  persistedSelectionType: "channel" | "agent" | null;
  persistedSelectionId: string | null;

  // Channels state
  channels: ThreadChannel[];
  channelsLoading: boolean;
  channelsError: string | null;
  channelsLoaded: boolean;

  // Messages state - stored grouped by channel/targetAgentId
  channelMessages: Map<string, OptimisticMessage[]>;
  directMessages: Map<string, OptimisticMessage[]>;
  messagesLoading: boolean;
  messagesError: string | null;

  // Message ID mapping - temporary ID to real ID mapping
  tempIdToRealIdMap: Map<string, string>;

  // Agents state
  agents: AgentInfo[];
  agentsLoading: boolean;
  agentsError: string | null;
  agentsLoaded: boolean;

  // Connection helpers
  getConnection: () => any | null;
  isConnected: () => boolean;

  // Actions - Selection
  selectChannel: (channel: string) => void;
  selectDirectMessage: (targetAgentId: string) => void;
  clearSelection: () => void;
  clearAllChatData: () => void;

  // Persistence actions
  restorePersistedSelection: () => Promise<void>;
  initializeWithDefaultSelection: () => Promise<void>;
  saveSelectionToStorage: (type: "channel" | "agent", id: string) => void;
  clearPersistedSelection: () => void;

  // Actions - Channels
  loadChannels: () => Promise<void>;
  clearChannelsError: () => void;

  // Actions - Messages
  loadChannelMessages: (
    channel: string,
    limit?: number,
    offset?: number
  ) => Promise<void>;
  loadDirectMessages: (
    targetAgentId: string,
    limit?: number,
    offset?: number
  ) => Promise<void>;
  sendChannelMessage: (
    channel: string,
    content: string,
    replyToId?: string
  ) => Promise<boolean>;
  sendDirectMessage: (
    targetAgentId: string,
    content: string
  ) => Promise<boolean>;
  clearMessagesError: () => void;

  // Actions - Agents
  loadAgents: () => Promise<void>;
  clearAgentsError: () => void;

  // Actions - Reactions
  addReaction: (
    messageId: string,
    reactionType: string,
    channel?: string
  ) => Promise<boolean>;
  removeReaction: (
    messageId: string,
    reactionType: string,
    channel?: string
  ) => Promise<boolean>;
  findRealMessageId: (messageId: string) => string;

  // Real-time updates
  addMessageToChannel: (channel: string, message: UnifiedMessage) => void;
  addMessageToDirect: (targetAgentId: string, message: UnifiedMessage) => void;
  updateMessage: (
    messageId: string,
    updates: Partial<OptimisticMessage>
  ) => void;

  // Optimistic update methods
  addOptimisticChannelMessage: (
    channel: string,
    content: string,
    replyToId?: string
  ) => string;
  addOptimisticDirectMessage: (
    targetAgentId: string,
    content: string
  ) => string;
  replaceOptimisticMessage: (
    tempId: string,
    realMessage: UnifiedMessage
  ) => void;
  markMessageAsFailed: (tempId: string) => void;
  retryMessage: (tempId: string) => Promise<boolean>;

  // Event handling
  setupEventListeners: () => void;
  cleanupEventListeners: () => void;

  // Event handler reference for cleanup
  eventHandler?: ((event: any) => void) | null;

  // Helper functions
  getChannelMessages: (channel: string) => OptimisticMessage[];
  getDirectMessagesForAgent: (
    targetAgentId: string,
    currentAgentId: string
  ) => OptimisticMessage[];
  generateTempMessageId: () => string;
}

// Global context reference for accessing in store
let globalOpenAgentsContext: any = null;

// localStorage key name
const CHAT_SELECTION_STORAGE_KEY = "openagents_chat_selection";

// Persisted selection data structure
interface PersistedSelection {
  type: "channel" | "agent";
  id: string;
  timestamp: number;
}

// localStorage utility functions
const ChatSelectionStorage = {
  save: (type: "channel" | "agent", id: string) => {
    try {
      const data: PersistedSelection = {
        type,
        id,
        timestamp: Date.now(),
      };
      localStorage.setItem(CHAT_SELECTION_STORAGE_KEY, JSON.stringify(data));
      console.log(`ChatStore: Saved selection to localStorage: ${type}:${id}`);
    } catch (error) {
      console.warn(
        "ChatStore: Failed to save selection to localStorage:",
        error
      );
    }
  },

  load: (): PersistedSelection | null => {
    try {
      const stored = localStorage.getItem(CHAT_SELECTION_STORAGE_KEY);
      if (stored) {
        const data: PersistedSelection = JSON.parse(stored);
        // Check if data is expired (30 days)
        if (Date.now() - data.timestamp < 30 * 24 * 60 * 60 * 1000) {
          console.log(
            `ChatStore: Loaded selection from localStorage: ${data.type}:${data.id}`
          );
          return data;
        } else {
          console.log("ChatStore: Stored selection is expired, removing...");
          ChatSelectionStorage.clear();
        }
      }
    } catch (error) {
      console.warn(
        "ChatStore: Failed to load selection from localStorage:",
        error
      );
    }
    return null;
  },

  clear: () => {
    try {
      localStorage.removeItem(CHAT_SELECTION_STORAGE_KEY);
      console.log("ChatStore: Cleared selection from localStorage");
    } catch (error) {
      console.warn(
        "ChatStore: Failed to clear selection from localStorage:",
        error
      );
    }
  },
};

export const useChatStore = create<ChatState>((set, get) => ({
  // Selection state
  currentChannel: null,
  currentDirectMessage: null,

  // Persistence state
  persistedSelectionType: null,
  persistedSelectionId: null,

  // Channels state
  channels: [],
  channelsLoading: false,
  channelsError: null,
  channelsLoaded: false,

  // Messages state
  channelMessages: new Map(),
  directMessages: new Map(),
  messagesLoading: false,
  messagesError: null,

  // Message ID mapping
  tempIdToRealIdMap: new Map(),

  // Agents state
  agents: [],
  agentsLoading: false,
  agentsError: null,
  agentsLoaded: false,

  // Event handler reference
  eventHandler: null,

  // Connection helpers
  getConnection: () => {
    return globalOpenAgentsContext?.connector || null;
  },

  isConnected: () => {
    return globalOpenAgentsContext?.isConnected || false;
  },

  // Selection management
  selectChannel: (channel: string) => {
    console.log(`ChatStore: Selecting channel #${channel}`);
    set({
      currentChannel: channel,
      currentDirectMessage: null, // Clear direct message selection when switching to channel
      persistedSelectionType: "channel",
      persistedSelectionId: channel,
    });

    // Save to localStorage
    get().saveSelectionToStorage("channel", channel);
  },

  selectDirectMessage: (targetAgentId: string) => {
    console.log(`ChatStore: Selecting direct message with ${targetAgentId}`);
    set({
      currentDirectMessage: targetAgentId,
      currentChannel: null, // Clear channel selection when switching to direct message
      persistedSelectionType: "agent",
      persistedSelectionId: targetAgentId,
    });

    // Save to localStorage
    get().saveSelectionToStorage("agent", targetAgentId);
  },

  clearSelection: () => {
    console.log("ChatStore: Clearing selection");
    set({
      currentChannel: null,
      currentDirectMessage: null,
      persistedSelectionType: null,
      persistedSelectionId: null,
    });

    // Clear localStorage
    get().clearPersistedSelection();
  },

  clearAllChatData: () => {
    console.log("ChatStore: Clearing all chat data for logout");
    set({
      // Reset selection
      currentChannel: null,
      currentDirectMessage: null,
      persistedSelectionType: null,
      persistedSelectionId: null,

      // Reset channels
      channels: [],
      channelsLoading: false,
      channelsError: null,
      channelsLoaded: false,

      // Reset messages
      channelMessages: new Map(),
      directMessages: new Map(),
      messagesLoading: false,
      messagesError: null,

      // Reset message ID mapping
      tempIdToRealIdMap: new Map(),

      // Reset agents
      agents: [],
      agentsLoading: false,
      agentsError: null,
      agentsLoaded: false,
    });

    // Clear localStorage
    get().clearPersistedSelection();
  },

  // Channels management
  loadChannels: async () => {
    const state = get();
    const connection = state.getConnection();

    // Prevent duplicate calls
    if (state.channelsLoading || state.channelsLoaded) {
      console.log("ChatStore: Channels already loading or loaded, skipping");
      return;
    }

    if (!connection) {
      console.warn("ChatStore: No connection available for loadChannels");
      set({ channelsError: "No connection available" });
      return;
    }

    console.log("ChatStore: Loading channels...");
    set({ channelsLoading: true, channelsError: null });

    try {
      const response = await connection.sendEvent({
        event_name: EventNames.THREAD_CHANNELS_LIST,
        source_id: connection.getAgentId(),
        destination_id: "mod:openagents.mods.workspace.messaging",
        payload: {
          action: "list_channels",
          message_type: "channel_info",
        },
      });

      if (response.success && response.data) {
        console.log(
          "ChatStore: Loaded channels:",
          response.data.channels?.length || 0
        );
        set({
          channels: response.data.channels || [],
          channelsLoading: false,
          channelsLoaded: true,
        });
      } else {
        console.warn("ChatStore: Failed to load channels. Response:", response);
        set({
          channels: [],
          channelsLoading: false,
          channelsLoaded: true, // Mark as loaded even on failure to prevent infinite loops
          channelsError: response.message || "Failed to load channels",
        });
      }
    } catch (error) {
      console.error("ChatStore: Failed to load channels:", error);
      set({
        channelsError: "Failed to load channels",
        channelsLoading: false,
        channelsLoaded: true, // Mark as loaded even on error to prevent infinite loops
      });
    }
  },

  clearChannelsError: () => {
    set({ channelsError: null });
  },

  // Messages management
  loadChannelMessages: async (channel: string, limit = 200, offset = 0) => {
    const connection = get().getConnection();
    if (!connection) {
      console.warn(
        "ChatStore: No connection available for loadChannelMessages"
      );
      set({ messagesError: "No connection available" });
      return;
    }

    console.log(`ChatStore: Loading messages for channel #${channel}...`);
    set({ messagesLoading: true, messagesError: null });

    try {
      const response = await connection.sendEvent({
        event_name: EventNames.THREAD_CHANNEL_MESSAGES_RETRIEVE,
        source_id: connection.getAgentId(),
        destination_id: "mod:openagents.mods.workspace.messaging",
        payload: {
          channel: channel,
          limit: limit,
          offset: offset,
        },
      });

      if (response.success && response.data && response.data.messages) {
        console.log(
          `ChatStore: Loaded ${response.data.messages.length} messages for channel #${channel}`
        );

        // Convert raw messages to unified format
        const rawMessages: RawThreadMessage[] = response.data.messages;
        const unifiedMessages =
          MessageAdapter.fromRawThreadMessages(rawMessages);

        // Filter out messages with empty content (these may be historical data issues)
        const validMessages = unifiedMessages.filter((msg) => {
          if (!msg.content || msg.content.trim() === "") {
            console.warn(
              `ChatStore: Filtering out empty message ${msg.id} from ${msg.senderId}`
            );
            return false;
          }
          return true;
        });

        const optimisticMessages: OptimisticMessage[] = validMessages.map(
          (msg) => ({
            ...msg,
            isOptimistic: false,
            status: "sent" as MessageStatus,
          })
        );

        console.log(
          `ChatStore: Loaded ${validMessages.length} valid messages (filtered ${
            unifiedMessages.length - validMessages.length
          } empty messages)`
        );

        // Store to channelMessages Map
        set((state) => {
          const newChannelMessages = new Map(state.channelMessages);
          newChannelMessages.set(channel, optimisticMessages);
          return {
            channelMessages: newChannelMessages,
            messagesLoading: false,
          };
        });
      } else {
        console.warn(
          `ChatStore: Failed to load messages for channel #${channel}. Response:`,
          response
        );
        set({
          messagesLoading: false,
          messagesError:
            response.message ||
            `Failed to load messages for channel #${channel}`,
        });
      }
    } catch (error) {
      console.error(
        `ChatStore: Failed to load messages for channel #${channel}:`,
        error
      );
      set({
        messagesError: `Failed to load messages for channel #${channel}`,
        messagesLoading: false,
      });
    }
  },

  loadDirectMessages: async (
    targetAgentId: string,
    limit = 200,
    offset = 0
  ) => {
    const connection = get().getConnection();
    if (!connection) {
      console.warn("ChatStore: No connection available for loadDirectMessages");
      set({ messagesError: "No connection available" });
      return;
    }

    console.log(`ChatStore: Loading direct messages with ${targetAgentId}...`);
    set({ messagesLoading: true, messagesError: null });

    try {
      const response = await connection.sendEvent({
        event_name: EventNames.THREAD_DIRECT_MESSAGES_RETRIEVE,
        source_id: connection.getAgentId(),
        destination_id: "mod:openagents.mods.workspace.messaging",
        payload: {
          target_agent_id: targetAgentId,
          limit: limit,
          offset: offset,
        },
      });

      if (response.success && response.data && response.data.messages) {
        console.log(
          `ChatStore: Loaded ${response.data.messages.length} direct messages with ${targetAgentId}`,
          response.data.messages
        );

        // Convert raw messages to unified format
        const rawMessages: RawThreadMessage[] = response.data.messages;
        const unifiedMessages =
          MessageAdapter.fromRawThreadMessages(rawMessages);

        // Filter out messages with empty content (these may be historical data issues)
        const validMessages = unifiedMessages.filter((msg) => {
          console.log(msg);
          if (!msg.content || msg.content.trim() === "") {
            console.warn(
              `ChatStore: Filtering out empty DM ${msg.id} from ${msg.senderId}`
            );
            return false;
          }
          return true;
        });

        const optimisticMessages: OptimisticMessage[] = validMessages.map(
          (msg) => ({
            ...msg,
            isOptimistic: false,
            status: "sent" as MessageStatus,
          })
        );

        console.log(
          `ChatStore: Loaded ${
            validMessages.length
          } valid direct messages (filtered ${
            unifiedMessages.length - validMessages.length
          } empty messages)`
        );

        // Store to directMessages Map
        set((state) => {
          const newDirectMessages = new Map(state.directMessages);
          newDirectMessages.set(targetAgentId, optimisticMessages);
          return {
            directMessages: newDirectMessages,
            messagesLoading: false,
          };
        });
      } else {
        console.warn(
          `ChatStore: Failed to load direct messages with ${targetAgentId}. Response:`,
          response
        );
        set({
          messagesLoading: false,
          messagesError:
            response.message ||
            `Failed to load direct messages with ${targetAgentId}`,
        });
      }
    } catch (error) {
      console.error(
        `ChatStore: Failed to load direct messages with ${targetAgentId}:`,
        error
      );
      set({
        messagesError: `Failed to load direct messages with ${targetAgentId}`,
        messagesLoading: false,
      });
    }
  },

  sendChannelMessage: async (
    channel: string,
    content: string,
    replyToId?: string
  ) => {
    const connection = get().getConnection();
    if (!connection || !content.trim()) return false;

    console.log(`ChatStore: Sending message to #${channel}: "${content}"`);

    // 1. Immediately add optimistic update message
    const tempId = get().addOptimisticChannelMessage(
      channel,
      content.trim(),
      replyToId
    );

    try {
      // Build payload
      const payload: any = {
        channel: channel,
        content: { text: content.trim() },
        message_type: replyToId ? "reply_message" : "channel_message",
      };

      // If it's a reply message, add reply-related fields
      if (replyToId) {
        payload.reply_to_id = replyToId;
        payload.thread_level = 1; // Set thread level

        // Debug: output reply payload being sent
        console.log(`ChatStore: Sending reply payload:`, {
          event_name: EventNames.THREAD_REPLY_SENT,
          destination_id: `channel:${channel}`,
          payload: payload,
        });
      }

      const response = await connection.sendEvent({
        event_name: replyToId
          ? EventNames.THREAD_REPLY_SENT
          : EventNames.THREAD_CHANNEL_MESSAGE_POST,
        source_id: connection.getAgentId(),
        destination_id: `channel:${channel}`,
        payload: payload,
      });

      if (response.success) {
        console.log(`ChatStore: Message sent successfully to #${channel}`);

        // 2. After success, check backend response data structure
        console.log(
          `ChatStore: Backend response for channel message:`,
          response
        );

        // Try to get message_id from different paths
        let realMessageId: string | null = null;
        if (response.data && response.data.message_id) {
          realMessageId = response.data.message_id;
        } else if (response.event_id) {
          // If no message_id, use event_id as real ID
          realMessageId = response.event_id;
        } else if (response.data && response.data.event_id) {
          realMessageId = response.data.event_id;
        }

        if (realMessageId) {
          // Update optimistic message with real ID returned from backend
          console.log(
            `ChatStore: Updating optimistic message ${tempId} with real ID ${realMessageId}`
          );
          get().updateMessage(tempId, {
            id: realMessageId,
            status: "sent" as MessageStatus,
            isOptimistic: false,
          });

          // Record ID mapping
          set((state) => {
            const newTempIdToRealIdMap = new Map(state.tempIdToRealIdMap);
            newTempIdToRealIdMap.set(tempId, realMessageId!);
            return {
              ...state,
              tempIdToRealIdMap: newTempIdToRealIdMap,
            };
          });
        } else {
          // If no real ID returned, only update status
          console.log(
            `ChatStore: No real message ID found in response, keeping temp ID ${tempId}`
          );
          get().updateMessage(tempId, { status: "sent" as MessageStatus });
        }

        return true;
      } else {
        console.error(
          `ChatStore: Failed to send message to #${channel}:`,
          response.message
        );

        // 3. Send failed, mark as failed state
        get().markMessageAsFailed(tempId);
        set({ messagesError: response.message || "Failed to send message" });
        return false;
      }
    } catch (error) {
      console.error(`ChatStore: Failed to send message to #${channel}:`, error);

      // 4. Network error, mark as failed state
      get().markMessageAsFailed(tempId);
      set({ messagesError: "Failed to send message" });
      return false;
    }
  },

  sendDirectMessage: async (targetAgentId: string, content: string) => {
    const connection = get().getConnection();
    if (!connection || !content.trim()) return false;

    console.log(
      `ChatStore: Sending direct message to ${targetAgentId}: "${content}"`
    );

    // 1. Immediately add optimistic update message
    const tempId = get().addOptimisticDirectMessage(
      targetAgentId,
      content.trim()
    );

    try {
      const response = await connection.sendEvent({
        event_name: EventNames.THREAD_DIRECT_MESSAGE_SEND,
        source_id: connection.getAgentId(),
        destination_id: `agent:${targetAgentId}`,
        payload: {
          target_agent_id: targetAgentId,
          content: { text: content.trim() },
          message_type: "direct_message",
        },
      });

      if (response.success) {
        console.log(
          `ChatStore: Direct message sent successfully to ${targetAgentId}`
        );

        // 2. After success, check backend response data structure
        console.log(
          `ChatStore: Backend response for direct message:`,
          response
        );

        // Try to get message_id from different paths
        let realMessageId: string | null = null;
        if (response.data && response.data.message_id) {
          realMessageId = response.data.message_id;
        } else if (response.event_id) {
          // If no message_id, use event_id as real ID
          realMessageId = response.event_id;
        } else if (response.data && response.data.event_id) {
          realMessageId = response.data.event_id;
        }

        if (realMessageId) {
          // Update optimistic message with real ID returned from backend
          console.log(
            `ChatStore: Updating optimistic direct message ${tempId} with real ID ${realMessageId}`
          );
          get().updateMessage(tempId, {
            id: realMessageId,
            status: "sent" as MessageStatus,
            isOptimistic: false,
          });

          // Record ID mapping
          set((state) => {
            const newTempIdToRealIdMap = new Map(state.tempIdToRealIdMap);
            newTempIdToRealIdMap.set(tempId, realMessageId!);
            return {
              ...state,
              tempIdToRealIdMap: newTempIdToRealIdMap,
            };
          });
        } else {
          // If no real ID returned, only update status
          console.log(
            `ChatStore: No real message ID found in response, keeping temp ID ${tempId}`
          );
          get().updateMessage(tempId, { status: "sent" as MessageStatus });
        }

        return true;
      } else {
        console.error(
          `ChatStore: Failed to send direct message to ${targetAgentId}:`,
          response.message
        );

        // 3. Send failed, mark as failed state
        get().markMessageAsFailed(tempId);
        set({
          messagesError: response.message || "Failed to send direct message",
        });
        return false;
      }
    } catch (error) {
      console.error(
        `ChatStore: Failed to send direct message to ${targetAgentId}:`,
        error
      );

      // 4. Network error, mark as failed state
      get().markMessageAsFailed(tempId);
      set({ messagesError: "Failed to send direct message" });
      return false;
    }
  },

  clearMessagesError: () => {
    set({ messagesError: null });
  },

  // Agents management
  loadAgents: async () => {
    const state = get();
    const connection = state.getConnection();

    // Prevent duplicate calls
    // if (state.agentsLoading || state.agentsLoaded) {
    //   console.log("ChatStore: Agents already loading or loaded, skipping");
    //   return;
    // }
    if (state.agentsLoading) {
      console.log("ChatStore: Agents already loading or loaded, skipping");
      return;
    }

    if (!connection) {
      console.warn("ChatStore: No connection available for loadAgents");
      set({ agentsError: "No connection available" });
      return;
    }

    console.log("ChatStore: Loading connected agents...");
    set({ agentsLoading: true, agentsError: null });

    try {
      // Use eventConnector's getConnectedAgents method
      const agents = await connection.getConnectedAgents();

      console.log("ChatStore: Loaded agents:", agents.length);
      set({
        agents: agents,
        agentsLoading: false,
        agentsLoaded: true,
      });
    } catch (error) {
      console.error("ChatStore: Failed to load agents:", error);
      set({
        agentsError: "Failed to load connected agents",
        agentsLoading: false,
      });
    }
  },

  clearAgentsError: () => {
    set({ agentsError: null });
  },

  // Helper method: find real message ID
  findRealMessageId: (messageId: string) => {
    const state = get();

    // If already a real ID, return directly
    if (!messageId.startsWith("temp_")) {
      return messageId;
    }

    // Find real ID from temporary ID mapping
    const realId = state.tempIdToRealIdMap.get(messageId);
    if (realId) {
      console.log(
        `ChatStore: Found real ID ${realId} for temp ID ${messageId}`
      );
      return realId;
    }

    // If no mapping, check if already replaced
    let foundRealId: string | null = null;

    // Search in channel messages
    for (const [channel, messages] of Array.from(
      state.channelMessages.entries()
    )) {
      const message = messages.find(
        (msg: OptimisticMessage) =>
          msg.id === messageId || msg.tempId === messageId
      );
      if (message && !message.isOptimistic) {
        foundRealId = message.id;
        console.log(
          `ChatStore: Found real message ID ${foundRealId} in channel ${channel}`
        );
        break;
      }
    }

    // Search in direct messages
    if (!foundRealId) {
      for (const [targetId, messages] of Array.from(
        state.directMessages.entries()
      )) {
        const message = messages.find(
          (msg: OptimisticMessage) =>
            msg.id === messageId || msg.tempId === messageId
        );
        if (message && !message.isOptimistic) {
          foundRealId = message.id;
          console.log(
            `ChatStore: Found real message ID ${foundRealId} in DM with ${targetId}`
          );
          break;
        }
      }
    }

    return foundRealId || messageId; // If not found, return original ID
  },

  // Reactions management
  addReaction: async (
    messageId: string,
    reactionType: string,
    channel?: string
  ) => {
    const connection = get().getConnection();
    if (!connection) return false;

    // Find real message ID
    const realMessageId = get().findRealMessageId(messageId);
    console.log(
      `ChatStore: Adding reaction ${reactionType} to message ${messageId} (real ID: ${realMessageId})`
    );

    // 1. Immediately add optimistic update reaction
    const tempReactionId = `temp_reaction_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 11)}`;

    // Find message and add optimistic reaction
    const state = get();
    let messageUpdated = false;

    // Update channel message reactions
    const newChannelMessages = new Map(state.channelMessages);
    for (const [ch, messages] of Array.from(newChannelMessages.entries())) {
      const messageIndex = messages.findIndex(
        (msg) => msg.id === realMessageId || msg.id === messageId
      );
      if (messageIndex >= 0) {
        const message = messages[messageIndex];
        const currentReactions = { ...(message.reactions || {}) };

        // Add or increment reaction count
        if (currentReactions[reactionType]) {
          currentReactions[reactionType] += 1;
        } else {
          currentReactions[reactionType] = 1;
        }

        const updatedMessages = [...messages];
        updatedMessages[messageIndex] = {
          ...message,
          reactions: currentReactions,
          tempReactionId: tempReactionId, // Record temporary reaction ID for later replacement
        };
        newChannelMessages.set(ch, updatedMessages);
        messageUpdated = true;
        console.log(
          `ChatStore: Added optimistic reaction ${reactionType} to channel message ${realMessageId}`
        );
        break;
      }
    }

    // Update direct message reactions
    if (!messageUpdated) {
      const newDirectMessages = new Map(state.directMessages);
      for (const [targetId, messages] of Array.from(
        newDirectMessages.entries()
      )) {
        const messageIndex = messages.findIndex(
          (msg) => msg.id === realMessageId || msg.id === messageId
        );
        if (messageIndex >= 0) {
          const message = messages[messageIndex];
          const currentReactions = { ...(message.reactions || {}) };

          // Add or increment reaction count
          if (currentReactions[reactionType]) {
            currentReactions[reactionType] += 1;
          } else {
            currentReactions[reactionType] = 1;
          }

          const updatedMessages = [...messages];
          updatedMessages[messageIndex] = {
            ...message,
            reactions: currentReactions,
            tempReactionId: tempReactionId, // Record temporary reaction ID for later replacement
          };
          newDirectMessages.set(targetId, updatedMessages);
          messageUpdated = true;
          console.log(
            `ChatStore: Added optimistic reaction ${reactionType} to direct message ${realMessageId}`
          );
          break;
        }
      }

      if (messageUpdated) {
        set((state) => ({
          ...state,
          directMessages: newDirectMessages,
        }));
      }
    } else {
      set((state) => ({
        ...state,
        channelMessages: newChannelMessages,
      }));
    }

    try {
      const response = await connection.sendEvent({
        event_name: EventNames.THREAD_REACTION_ADD,
        source_id: connection.getAgentId(),
        destination_id: channel ? `channel:${channel}` : undefined,
        payload: {
          target_message_id: realMessageId,
          reaction_type: reactionType,
          action: "add",
        },
      });

      // Check double-layer success structure
      const isActualSuccess =
        response.success && (!response.data || response.data.success !== false);

      if (isActualSuccess) {
        console.log(
          `ChatStore: Reaction ${reactionType} added successfully to message ${realMessageId}`
        );

        // 2. After success, if backend returns real reaction data, replace temporary data
        if (response.data && response.data.reactions) {
          console.log(
            `ChatStore: Updating reactions with backend response for message ${realMessageId}:`,
            response.data.reactions
          );
          get().updateMessage(realMessageId, {
            reactions: response.data.reactions,
            tempReactionId: undefined, // Clear temporary reaction ID
          });
        }

        return true;
      } else {
        console.error(
          `ChatStore: Failed to add reaction ${reactionType} to message ${realMessageId}:`,
          response.message
        );

        // 3. Send failed, rollback optimistic update
        console.log(
          `ChatStore: Rolling back optimistic reaction for message ${realMessageId}`
        );
        const currentState = get();

        // Rollback channel message reactions
        const rollbackChannelMessages = new Map(currentState.channelMessages);
        for (const [ch, messages] of Array.from(
          rollbackChannelMessages.entries()
        )) {
          const messageIndex = messages.findIndex(
            (msg) =>
              (msg.id === realMessageId || msg.id === messageId) &&
              msg.tempReactionId === tempReactionId
          );
          if (messageIndex >= 0) {
            const message = messages[messageIndex];
            const rollbackReactions = { ...message.reactions };

            if (
              rollbackReactions[reactionType] &&
              rollbackReactions[reactionType] > 1
            ) {
              rollbackReactions[reactionType] -= 1;
            } else {
              delete rollbackReactions[reactionType];
            }

            const updatedMessages = [...messages];
            updatedMessages[messageIndex] = {
              ...message,
              reactions: rollbackReactions,
              tempReactionId: undefined,
            };
            rollbackChannelMessages.set(ch, updatedMessages);
            break;
          }
        }

        // Rollback direct message reactions
        const rollbackDirectMessages = new Map(currentState.directMessages);
        for (const [targetId, messages] of Array.from(
          rollbackDirectMessages.entries()
        )) {
          const messageIndex = messages.findIndex(
            (msg) =>
              (msg.id === realMessageId || msg.id === messageId) &&
              msg.tempReactionId === tempReactionId
          );
          if (messageIndex >= 0) {
            const message = messages[messageIndex];
            const rollbackReactions = { ...message.reactions };

            if (
              rollbackReactions[reactionType] &&
              rollbackReactions[reactionType] > 1
            ) {
              rollbackReactions[reactionType] -= 1;
            } else {
              delete rollbackReactions[reactionType];
            }

            const updatedMessages = [...messages];
            updatedMessages[messageIndex] = {
              ...message,
              reactions: rollbackReactions,
              tempReactionId: undefined,
            };
            rollbackDirectMessages.set(targetId, updatedMessages);
            break;
          }
        }

        set((state) => ({
          ...state,
          channelMessages: rollbackChannelMessages,
          directMessages: rollbackDirectMessages,
        }));

        return false;
      }
    } catch (error) {
      console.error(
        `ChatStore: Failed to add reaction ${reactionType} to message ${realMessageId}:`,
        error
      );

      // 4. Network error, rollback optimistic update (same logic as above)
      console.log(
        `ChatStore: Rolling back optimistic reaction due to network error for message ${realMessageId}`
      );
      const currentState = get();

      // Rollback channel message reactions
      const rollbackChannelMessages = new Map(currentState.channelMessages);
      for (const [ch, messages] of Array.from(
        rollbackChannelMessages.entries()
      )) {
        const messageIndex = messages.findIndex(
          (msg) =>
            (msg.id === realMessageId || msg.id === messageId) &&
            msg.tempReactionId === tempReactionId
        );
        if (messageIndex >= 0) {
          const message = messages[messageIndex];
          const rollbackReactions = { ...message.reactions };

          if (
            rollbackReactions[reactionType] &&
            rollbackReactions[reactionType] > 1
          ) {
            rollbackReactions[reactionType] -= 1;
          } else {
            delete rollbackReactions[reactionType];
          }

          const updatedMessages = [...messages];
          updatedMessages[messageIndex] = {
            ...message,
            reactions: rollbackReactions,
            tempReactionId: undefined,
          };
          rollbackChannelMessages.set(ch, updatedMessages);
          break;
        }
      }

      // Rollback direct message reactions
      const rollbackDirectMessages = new Map(currentState.directMessages);
      for (const [targetId, messages] of Array.from(
        rollbackDirectMessages.entries()
      )) {
        const messageIndex = messages.findIndex(
          (msg) =>
            (msg.id === realMessageId || msg.id === messageId) &&
            msg.tempReactionId === tempReactionId
        );
        if (messageIndex >= 0) {
          const message = messages[messageIndex];
          const rollbackReactions = { ...message.reactions };

          if (
            rollbackReactions[reactionType] &&
            rollbackReactions[reactionType] > 1
          ) {
            rollbackReactions[reactionType] -= 1;
          } else {
            delete rollbackReactions[reactionType];
          }

          const updatedMessages = [...messages];
          updatedMessages[messageIndex] = {
            ...message,
            reactions: rollbackReactions,
            tempReactionId: undefined,
          };
          rollbackDirectMessages.set(targetId, updatedMessages);
          break;
        }
      }

      set((state) => ({
        ...state,
        channelMessages: rollbackChannelMessages,
        directMessages: rollbackDirectMessages,
      }));

      return false;
    }
  },

  removeReaction: async (
    messageId: string,
    reactionType: string,
    channel?: string
  ) => {
    const connection = get().getConnection();
    if (!connection) return false;

    // Find real message ID
    const realMessageId = get().findRealMessageId(messageId);
    console.log(
      `ChatStore: Removing reaction ${reactionType} from message ${messageId} (real ID: ${realMessageId})`
    );

    // 1. Immediately remove optimistic reaction
    const tempReactionId = `temp_reaction_remove_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 11)}`;

    // Find message and remove optimistic reaction
    const state = get();
    let messageUpdated = false;
    let originalReactionCount = 0;

    // Update channel message reactions
    const newChannelMessages = new Map(state.channelMessages);
    for (const [ch, messages] of Array.from(newChannelMessages.entries())) {
      const messageIndex = messages.findIndex(
        (msg) => msg.id === realMessageId || msg.id === messageId
      );
      if (messageIndex >= 0) {
        const message = messages[messageIndex];
        const currentReactions = { ...(message.reactions || {}) };
        originalReactionCount = currentReactions[reactionType] || 0;

        // Decrease or remove reaction count
        if (
          currentReactions[reactionType] &&
          currentReactions[reactionType] > 1
        ) {
          currentReactions[reactionType] -= 1;
        } else {
          delete currentReactions[reactionType];
        }

        const updatedMessages = [...messages];
        updatedMessages[messageIndex] = {
          ...message,
          reactions: currentReactions,
          tempReactionId: tempReactionId,
          originalReactionCount: originalReactionCount, // Record original count for rollback
        };
        newChannelMessages.set(ch, updatedMessages);
        messageUpdated = true;
        console.log(
          `ChatStore: Removed optimistic reaction ${reactionType} from channel message ${realMessageId}`
        );
        break;
      }
    }

    // Update direct message reactions
    if (!messageUpdated) {
      const newDirectMessages = new Map(state.directMessages);
      for (const [targetId, messages] of Array.from(
        newDirectMessages.entries()
      )) {
        const messageIndex = messages.findIndex(
          (msg) => msg.id === realMessageId || msg.id === messageId
        );
        if (messageIndex >= 0) {
          const message = messages[messageIndex];
          const currentReactions = { ...(message.reactions || {}) };
          originalReactionCount = currentReactions[reactionType] || 0;

          // Decrease or remove reaction count
          if (
            currentReactions[reactionType] &&
            currentReactions[reactionType] > 1
          ) {
            currentReactions[reactionType] -= 1;
          } else {
            delete currentReactions[reactionType];
          }

          const updatedMessages = [...messages];
          updatedMessages[messageIndex] = {
            ...message,
            reactions: currentReactions,
            tempReactionId: tempReactionId,
            originalReactionCount: originalReactionCount, // Record original count for rollback
          };
          newDirectMessages.set(targetId, updatedMessages);
          messageUpdated = true;
          console.log(
            `ChatStore: Removed optimistic reaction ${reactionType} from direct message ${realMessageId}`
          );
          break;
        }
      }

      if (messageUpdated) {
        set((state) => ({
          ...state,
          directMessages: newDirectMessages,
        }));
      }
    } else {
      set((state) => ({
        ...state,
        channelMessages: newChannelMessages,
      }));
    }

    try {
      const response = await connection.sendEvent({
        event_name: EventNames.THREAD_REACTION_REMOVE,
        source_id: connection.getAgentId(),
        destination_id: channel ? `channel:${channel}` : undefined,
        payload: {
          target_message_id: realMessageId,
          reaction_type: reactionType,
          action: "remove",
        },
      });

      // Check double-layer success structure
      const isActualSuccess =
        response.success && (!response.data || response.data.success !== false);

      if (isActualSuccess) {
        console.log(
          `ChatStore: Reaction ${reactionType} removed successfully from message ${realMessageId}`
        );

        // 2. After success, if backend returns real reaction data, replace temporary data
        if (response.data && response.data.reactions) {
          console.log(
            `ChatStore: Updating reactions with backend response for message ${realMessageId}:`,
            response.data.reactions
          );
          get().updateMessage(realMessageId, {
            reactions: response.data.reactions,
            tempReactionId: undefined,
            originalReactionCount: undefined, // Clear temporary data
          });
        }

        return true;
      } else {
        console.error(
          `ChatStore: Failed to remove reaction ${reactionType} from message ${realMessageId}:`,
          response.message
        );

        // 3. Send failed, rollback optimistic update
        console.log(
          `ChatStore: Rolling back optimistic reaction removal for message ${realMessageId}`
        );
        const currentState = get();

        // Rollback channel message reactions
        const rollbackChannelMessages = new Map(currentState.channelMessages);
        for (const [ch, messages] of Array.from(
          rollbackChannelMessages.entries()
        )) {
          const messageIndex = messages.findIndex(
            (msg) =>
              (msg.id === realMessageId || msg.id === messageId) &&
              msg.tempReactionId === tempReactionId
          );
          if (messageIndex >= 0) {
            const message = messages[messageIndex];
            const rollbackReactions = { ...message.reactions };

            // Restore original reaction count
            if (
              message.originalReactionCount &&
              message.originalReactionCount > 0
            ) {
              rollbackReactions[reactionType] = message.originalReactionCount;
            }

            const updatedMessages = [...messages];
            updatedMessages[messageIndex] = {
              ...message,
              reactions: rollbackReactions,
              tempReactionId: undefined,
              originalReactionCount: undefined,
            };
            rollbackChannelMessages.set(ch, updatedMessages);
            break;
          }
        }

        // Rollback direct message reactions
        const rollbackDirectMessages = new Map(currentState.directMessages);
        for (const [targetId, messages] of Array.from(
          rollbackDirectMessages.entries()
        )) {
          const messageIndex = messages.findIndex(
            (msg) =>
              (msg.id === realMessageId || msg.id === messageId) &&
              msg.tempReactionId === tempReactionId
          );
          if (messageIndex >= 0) {
            const message = messages[messageIndex];
            const rollbackReactions = { ...message.reactions };

            // Restore original reaction count
            if (
              message.originalReactionCount &&
              message.originalReactionCount > 0
            ) {
              rollbackReactions[reactionType] = message.originalReactionCount;
            }

            const updatedMessages = [...messages];
            updatedMessages[messageIndex] = {
              ...message,
              reactions: rollbackReactions,
              tempReactionId: undefined,
              originalReactionCount: undefined,
            };
            rollbackDirectMessages.set(targetId, updatedMessages);
            break;
          }
        }

        set((state) => ({
          ...state,
          channelMessages: rollbackChannelMessages,
          directMessages: rollbackDirectMessages,
        }));

        return false;
      }
    } catch (error) {
      console.error(
        `ChatStore: Failed to remove reaction ${reactionType} from message ${realMessageId}:`,
        error
      );

      // 4. Network error, rollback optimistic update (same logic as above)
      console.log(
        `ChatStore: Rolling back optimistic reaction removal due to network error for message ${realMessageId}`
      );
      const currentState = get();

      // Rollback channel message reactions
      const rollbackChannelMessages = new Map(currentState.channelMessages);
      for (const [ch, messages] of Array.from(
        rollbackChannelMessages.entries()
      )) {
        const messageIndex = messages.findIndex(
          (msg) =>
            (msg.id === realMessageId || msg.id === messageId) &&
            msg.tempReactionId === tempReactionId
        );
        if (messageIndex >= 0) {
          const message = messages[messageIndex];
          const rollbackReactions = { ...message.reactions };

          // Restore original reaction count
          if (
            message.originalReactionCount &&
            message.originalReactionCount > 0
          ) {
            rollbackReactions[reactionType] = message.originalReactionCount;
          }

          const updatedMessages = [...messages];
          updatedMessages[messageIndex] = {
            ...message,
            reactions: rollbackReactions,
            tempReactionId: undefined,
            originalReactionCount: undefined,
          };
          rollbackChannelMessages.set(ch, updatedMessages);
          break;
        }
      }

      // Rollback direct message reactions
      const rollbackDirectMessages = new Map(currentState.directMessages);
      for (const [targetId, messages] of Array.from(
        rollbackDirectMessages.entries()
      )) {
        const messageIndex = messages.findIndex(
          (msg) =>
            (msg.id === realMessageId || msg.id === messageId) &&
            msg.tempReactionId === tempReactionId
        );
        if (messageIndex >= 0) {
          const message = messages[messageIndex];
          const rollbackReactions = { ...message.reactions };

          // Restore original reaction count
          if (
            message.originalReactionCount &&
            message.originalReactionCount > 0
          ) {
            rollbackReactions[reactionType] = message.originalReactionCount;
          }

          const updatedMessages = [...messages];
          updatedMessages[messageIndex] = {
            ...message,
            reactions: rollbackReactions,
            tempReactionId: undefined,
            originalReactionCount: undefined,
          };
          rollbackDirectMessages.set(targetId, updatedMessages);
          break;
        }
      }

      set((state) => ({
        ...state,
        channelMessages: rollbackChannelMessages,
        directMessages: rollbackDirectMessages,
      }));

      return false;
    }
  },

  // Generate temporary message ID
  generateTempMessageId: () => {
    return `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  },

  // Optimistic update - add channel message
  addOptimisticChannelMessage: (
    channel: string,
    content: string,
    replyToId?: string
  ) => {
    const connection = get().getConnection();
    const tempId = get().generateTempMessageId();

    const optimisticMessage: OptimisticMessage = {
      id: tempId,
      senderId: connection?.getAgentId() || "unknown",
      timestamp: new Date().toISOString(),
      content: content,
      type: replyToId ? "reply_message" : "channel_message",
      channel: channel,
      replyToId: replyToId,
      threadLevel: replyToId ? 1 : undefined, // Add thread level
      isOptimistic: true,
      status: "sending" as MessageStatus,
      tempId: tempId,
    };

    get().addMessageToChannel(channel, optimisticMessage);
    return tempId;
  },

  // Optimistic update - add direct message
  addOptimisticDirectMessage: (targetAgentId: string, content: string) => {
    const connection = get().getConnection();
    const tempId = get().generateTempMessageId();

    const optimisticMessage: OptimisticMessage = {
      id: tempId,
      senderId: connection?.getAgentId() || "unknown",
      timestamp: new Date().toISOString(),
      content: content,
      type: "direct_message",
      targetUserId: targetAgentId,
      isOptimistic: true,
      status: "sending" as MessageStatus,
      tempId: tempId,
    };

    get().addMessageToDirect(targetAgentId, optimisticMessage);
    return tempId;
  },

  // Replace optimistic message with real message
  replaceOptimisticMessage: (tempId: string, realMessage: UnifiedMessage) => {
    set((state) => {
      // Find and replace in channel messages
      const newChannelMessages = new Map(state.channelMessages);
      let messageReplaced = false;

      for (const [channel, messages] of Array.from(
        newChannelMessages.entries()
      )) {
        const messageIndex = messages.findIndex(
          (msg) =>
            (msg.tempId === tempId || msg.id === tempId) && msg.isOptimistic
        );
        if (messageIndex >= 0) {
          const oldMessage = messages[messageIndex];
          console.log(
            `ChatStore: Replacing optimistic message in channel #${channel}:`
          );
          console.log(
            `  - Old: ${JSON.stringify({
              id: oldMessage.id,
              tempId: oldMessage.tempId,
              content: oldMessage.content,
              isOptimistic: oldMessage.isOptimistic,
            })}`
          );
          console.log(
            `  - New: ${JSON.stringify({
              id: realMessage.id,
              content: realMessage.content,
            })}`
          );

          const updatedMessages = [...messages];
          updatedMessages[messageIndex] = {
            ...realMessage,
            isOptimistic: false,
            status: "sent" as MessageStatus,
            originalId: tempId,
          };
          newChannelMessages.set(channel, updatedMessages);
          messageReplaced = true;

          // Record ID mapping
          const newTempIdToRealIdMap = new Map(state.tempIdToRealIdMap);
          newTempIdToRealIdMap.set(tempId, realMessage.id);

          console.log(
            `ChatStore: Successfully replaced optimistic message ${tempId} with real message ${realMessage.id} in channel #${channel}`
          );
          console.log(
            `ChatStore: Channel #${channel} now has ${updatedMessages.length} messages`
          );
          return {
            ...state,
            channelMessages: newChannelMessages,
            tempIdToRealIdMap: newTempIdToRealIdMap,
          };
        }
      }

      // Find and replace in direct messages
      if (!messageReplaced) {
        const newDirectMessages = new Map(state.directMessages);
        for (const [targetAgentId, messages] of Array.from(
          newDirectMessages.entries()
        )) {
          const messageIndex = messages.findIndex(
            (msg) =>
              (msg.tempId === tempId || msg.id === tempId) && msg.isOptimistic
          );
          if (messageIndex >= 0) {
            const oldMessage = messages[messageIndex];
            console.log(
              `ChatStore: Replacing optimistic direct message with ${targetAgentId}:`
            );
            console.log(
              `  - Old: ${JSON.stringify({
                id: oldMessage.id,
                tempId: oldMessage.tempId,
                content: oldMessage.content,
                isOptimistic: oldMessage.isOptimistic,
              })}`
            );
            console.log(
              `  - New: ${JSON.stringify({
                id: realMessage.id,
                content: realMessage.content,
              })}`
            );

            const updatedMessages = [...messages];
            updatedMessages[messageIndex] = {
              ...realMessage,
              isOptimistic: false,
              status: "sent" as MessageStatus,
              originalId: tempId,
            };
            newDirectMessages.set(targetAgentId, updatedMessages);

            // Record ID mapping
            const newTempIdToRealIdMap = new Map(state.tempIdToRealIdMap);
            newTempIdToRealIdMap.set(tempId, realMessage.id);

            console.log(
              `ChatStore: Successfully replaced optimistic message ${tempId} with real message ${realMessage.id} in DM with ${targetAgentId}`
            );
            console.log(
              `ChatStore: DM with ${targetAgentId} now has ${updatedMessages.length} messages`
            );
            return {
              ...state,
              directMessages: newDirectMessages,
              tempIdToRealIdMap: newTempIdToRealIdMap,
            };
          }
        }
      }

      console.warn(
        `ChatStore: Could not find optimistic message ${tempId} to replace`
      );
      return state;
    });
  },

  // Mark message as failed
  markMessageAsFailed: (tempId: string) => {
    get().updateMessage(tempId, { status: "failed" as MessageStatus });
  },

  // Retry message
  retryMessage: async (tempId: string) => {
    const state = get();

    // Find message
    let messageToRetry: OptimisticMessage | undefined;
    let channel: string | undefined;
    let targetAgentId: string | undefined;

    // Find in channel messages
    for (const [ch, messages] of Array.from(state.channelMessages.entries())) {
      const msg = messages.find((m) => m.tempId === tempId || m.id === tempId);
      if (msg) {
        messageToRetry = msg;
        channel = ch;
        break;
      }
    }

    // Find in direct messages
    if (!messageToRetry) {
      for (const [agentId, messages] of Array.from(
        state.directMessages.entries()
      )) {
        const msg = messages.find(
          (m) => m.tempId === tempId || m.id === tempId
        );
        if (msg) {
          messageToRetry = msg;
          targetAgentId = agentId;
          break;
        }
      }
    }

    if (!messageToRetry) {
      console.error(`ChatStore: Could not find message ${tempId} to retry`);
      return false;
    }

    // Update status to sending
    get().updateMessage(tempId, { status: "sending" as MessageStatus });

    // Resend
    try {
      if (channel) {
        return await get().sendChannelMessage(
          channel,
          messageToRetry.content,
          messageToRetry.replyToId
        );
      } else if (targetAgentId) {
        return await get().sendDirectMessage(
          targetAgentId,
          messageToRetry.content
        );
      }
      return false;
    } catch (error) {
      console.error(`ChatStore: Retry failed for message ${tempId}:`, error);
      get().markMessageAsFailed(tempId);
      return false;
    }
  },

  // Real-time updates
  addMessageToChannel: (
    channel: string,
    message: UnifiedMessage | OptimisticMessage
  ) => {
    set((state) => {
      const newChannelMessages = new Map(state.channelMessages);
      const currentMessages = newChannelMessages.get(channel) || [];

      // Enhanced message deduplication mechanism
      const messageToAdd = message as OptimisticMessage;
      const exists = currentMessages.some((msg) => {
        // 1. Direct ID match
        if (msg.id === messageToAdd.id) {
          console.log(
            `ChatStore: Message with ID ${messageToAdd.id} already exists in channel #${channel} (ID match)`
          );
          return true;
        }

        // 2. Temporary ID match
        if (messageToAdd.tempId && msg.tempId === messageToAdd.tempId) {
          console.log(
            `ChatStore: Message with tempId ${messageToAdd.tempId} already exists in channel #${channel} (tempId match)`
          );
          return true;
        }

        // 3. Content and time match (prevent duplicate messages with same content)
        if (
          msg.content === messageToAdd.content &&
          msg.senderId === messageToAdd.senderId &&
          msg.type === messageToAdd.type
        ) {
          const timeDiff = Math.abs(
            new Date(msg.timestamp).getTime() -
              new Date(messageToAdd.timestamp).getTime()
          );
          if (timeDiff < 2000) {
            // Messages within 2 seconds with same content are considered duplicates
            console.log(
              `ChatStore: Duplicate message detected in channel #${channel} (content+time match, ${timeDiff}ms apart)`
            );
            return true;
          }
        }

        return false;
      });

      if (exists) {
        return state;
      }

      // Add new message to the end
      const optimisticMessage: OptimisticMessage = {
        ...message,
        isOptimistic: (message as OptimisticMessage).isOptimistic || false,
        status: (message as OptimisticMessage).status || "sent",
      };

      const updatedMessages = [...currentMessages, optimisticMessage];
      newChannelMessages.set(channel, updatedMessages);

      console.log(
        `ChatStore: Added message to channel #${channel}:`,
        message.content
      );
      console.log(
        `ChatStore: Message details:`,
        {
          id: messageToAdd.id,
          type: messageToAdd.type,
          replyToId: messageToAdd.replyToId,
          threadLevel: messageToAdd.threadLevel,
          senderId: messageToAdd.senderId,
        },
        messageToAdd
      );
      console.log(
        `ChatStore: Channel #${channel} now has ${updatedMessages.length} messages`
      );
      console.log(
        `ChatStore: Updated channelMessages Map size: ${newChannelMessages.size}`
      );

      return {
        ...state,
        channelMessages: newChannelMessages,
      };
    });
  },

  addMessageToDirect: (
    targetAgentId: string,
    message: UnifiedMessage | OptimisticMessage
  ) => {
    set((state) => {
      const newDirectMessages = new Map(state.directMessages);
      const currentMessages = newDirectMessages.get(targetAgentId) || [];

      // Enhanced direct message deduplication mechanism
      const messageToAdd = message as OptimisticMessage;
      const exists = currentMessages.some((msg) => {
        // 1. Direct ID match
        if (msg.id === messageToAdd.id) {
          console.log(
            `ChatStore: Direct message with ID ${messageToAdd.id} already exists with ${targetAgentId} (ID match)`
          );
          return true;
        }

        // 2. Temporary ID match
        if (messageToAdd.tempId && msg.tempId === messageToAdd.tempId) {
          console.log(
            `ChatStore: Direct message with tempId ${messageToAdd.tempId} already exists with ${targetAgentId} (tempId match)`
          );
          return true;
        }

        // 3. Content and time match (prevent duplicate messages with same content)
        if (
          msg.content === messageToAdd.content &&
          msg.senderId === messageToAdd.senderId &&
          msg.type === messageToAdd.type
        ) {
          const timeDiff = Math.abs(
            new Date(msg.timestamp).getTime() -
              new Date(messageToAdd.timestamp).getTime()
          );
          if (timeDiff < 2000) {
            // Messages within 2 seconds with same content are considered duplicates
            console.log(
              `ChatStore: Duplicate direct message detected with ${targetAgentId} (content+time match, ${timeDiff}ms apart)`
            );
            return true;
          }
        }

        return false;
      });

      if (exists) {
        return state;
      }

      // Add new message to the end
      const optimisticMessage: OptimisticMessage = {
        ...message,
        isOptimistic: (message as OptimisticMessage).isOptimistic || false,
        status: (message as OptimisticMessage).status || "sent",
      };

      const updatedMessages = [...currentMessages, optimisticMessage];
      newDirectMessages.set(targetAgentId, updatedMessages);

      console.log(
        `ChatStore: Added direct message with ${targetAgentId}:`,
        message.content
      );
      return {
        ...state,
        directMessages: newDirectMessages,
      };
    });
  },

  updateMessage: (messageId: string, updates: Partial<OptimisticMessage>) => {
    set((state) => {
      let messageUpdated = false;

      // Update channel messages
      const newChannelMessages = new Map(state.channelMessages);
      for (const [channel, messages] of Array.from(
        newChannelMessages.entries()
      )) {
        const messageIndex = messages.findIndex(
          (msg: OptimisticMessage) =>
            msg.id === messageId || msg.tempId === messageId
        );
        if (messageIndex >= 0) {
          const updatedMessages = [...messages];
          updatedMessages[messageIndex] = {
            ...updatedMessages[messageIndex],
            ...updates,
          };
          newChannelMessages.set(channel, updatedMessages);
          messageUpdated = true;
          console.log(
            `ChatStore: Updated message ${messageId} in channel #${channel}`
          );
          break;
        }
      }

      // Update direct messages
      const newDirectMessages = new Map(state.directMessages);
      if (!messageUpdated) {
        for (const [targetAgentId, messages] of Array.from(
          newDirectMessages.entries()
        )) {
          const messageIndex = messages.findIndex(
            (msg: OptimisticMessage) =>
              msg.id === messageId || msg.tempId === messageId
          );
          if (messageIndex >= 0) {
            const updatedMessages = [...messages];
            updatedMessages[messageIndex] = {
              ...updatedMessages[messageIndex],
              ...updates,
            };
            newDirectMessages.set(targetAgentId, updatedMessages);
            messageUpdated = true;
            console.log(
              `ChatStore: Updated message ${messageId} in direct messages with ${targetAgentId}`
            );
            break;
          }
        }
      }

      if (!messageUpdated) {
        console.warn(`ChatStore: Message ${messageId} not found for update`);
      }

      return {
        ...state,
        channelMessages: newChannelMessages,
        directMessages: newDirectMessages,
      };
    });
  },

  // Helper functions
  getChannelMessages: (channel: string) => {
    const { channelMessages } = get();
    return channelMessages.get(channel) || [];
  },

  getDirectMessagesForAgent: (
    targetAgentId: string,
    currentAgentId: string
  ) => {
    const { directMessages } = get();
    const messages = directMessages.get(targetAgentId) || [];

    // Filter messages belonging to current conversation
    return messages.filter(
      (message) =>
        message.type === "direct_message" &&
        ((message.senderId === currentAgentId &&
          message.targetUserId === targetAgentId) ||
          (message.senderId === targetAgentId &&
            message.targetUserId === currentAgentId) ||
          message.senderId === targetAgentId) // Compatible with old format
    );
  },

  // Event handling
  setupEventListeners: () => {
    const connection = get().getConnection();
    if (!connection) return;

    console.log("ChatStore: Setting up chat event listeners");

    // Use event router to listen to chat-related events
    const chatEventHandler = (event: any) => {
      console.log("ChatStore: Received chat event:", event.event_name, event);

      // Handle channel message notifications
      if (
        event.event_name === "thread.channel_message.notification" &&
        event.payload
      ) {
        console.log("ChatStore: Received channel message notification:", event);

        const messageData = event.payload;

        // Show system notification
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

        if (messageData.channel && messageData.content) {
          // Construct unified message format
          const unifiedMessage: UnifiedMessage = {
            id:
              event.event_id ||
              `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
            senderId: event.sender_id || event.source_id || "unknown",
            timestamp: messageData.timestamp || new Date().toISOString(),
            content:
              typeof messageData.content === "string"
                ? messageData.content
                : messageData.content.text || "",
            type: messageData.message_type,
            channel: messageData.channel,
            replyToId: messageData.reply_to_id || event.reply_to_id,
            threadLevel: messageData.thread_level || 1,
            reactions: messageData.reactions,
          };

          // Check if it's own message (may need to replace optimistic update message)
          // const connection = get().getConnection();
          // const currentUserId = connection?.getAgentId();

          // if (unifiedMessage.senderId === currentUserId) {
          //   // This is own message, find and replace corresponding optimistic update message
          //   console.log("ChatStore: This is own message, looking for optimistic message to replace");

          //   const state = get();
          //   const channelMessages = state.channelMessages.get(messageData.channel) || [];
          //   const optimisticMsg = channelMessages.find(msg =>
          //     msg.isOptimistic &&
          //     msg.content === unifiedMessage.content &&
          //     msg.senderId === unifiedMessage.senderId &&
          //     msg.type === unifiedMessage.type &&
          //     Math.abs(new Date(msg.timestamp).getTime() - new Date(unifiedMessage.timestamp).getTime()) < 30000 // Within 30 seconds
          //   );

          //   if (optimisticMsg && optimisticMsg.tempId) {
          //     console.log(`ChatStore: Found matching optimistic message ${optimisticMsg.tempId}, replacing with real message ${unifiedMessage.id}`);
          //     get().replaceOptimisticMessage(optimisticMsg.tempId, unifiedMessage);
          //     return; // Do not execute addMessageToChannel
          //   }
          // }

          // If not own message or no corresponding optimistic update message found, add directly
          get().addMessageToChannel(messageData.channel, unifiedMessage);
        }
      }

      // Handle project notification events
      else if (event.event_name === "project.notification.completed") {
        console.log("ChatStore: Received project completion notification:", event);
        
        const projectData = event.payload || {};
        const projectId = projectData.project_id;
        const summary = projectData.summary || "Project completed";
        
        if (projectId) {
          console.log(`🎉 Project ${projectId} completed: ${summary}`);
          
          // Add a system message to the project channel
          // Note: We need to find the channel name from project_id
          // The channel format is: project-{template_id}-{project_id}
          // For now, we'll try to find it from existing channels
          const state = get();
          let projectChannel: string | null = null;
          
          for (const [channelName] of Array.from(state.channelMessages.entries())) {
            if (channelName.includes(projectId)) {
              projectChannel = channelName;
              break;
            }
          }
          
          if (projectChannel) {
            const systemMessage: UnifiedMessage = {
              id: `project-completion-${Date.now()}`,
              senderId: "system",
              timestamp: new Date().toISOString(),
              content: `🎉 Project completed\n\n${summary}`,
              type: "channel_message",
              channel: projectChannel,
            };
            
            get().addMessageToChannel(projectChannel, systemMessage);
          }
        }
      }
      // Handle project message notifications
      else if (event.event_name === "project.notification.message_received") {
        console.log("ChatStore: Received project message notification:", event);
        
        const messageData = event.payload || {};
        const projectId = messageData.project_id;
        const senderId = messageData.sender_id;
        const content = messageData.content;
        
        if (projectId && content) {
          // Find the project channel
          const state = get();
          let projectChannel: string | null = null;
          
          for (const [channelName] of Array.from(state.channelMessages.entries())) {
            if (channelName.includes(projectId)) {
              projectChannel = channelName;
              break;
            }
          }
          
          if (projectChannel) {
            const messageText = typeof content === "string" 
              ? content 
              : content.message || content.text || "";
            
            const unifiedMessage: UnifiedMessage = {
              id: messageData.message_id || `project-msg-${Date.now()}`,
              senderId: senderId || "unknown",
              timestamp: new Date(messageData.timestamp * 1000).toISOString() || new Date().toISOString(),
              content: messageText,
              type: "channel_message",
              channel: projectChannel,
              replyToId: messageData.reply_to_id,
            };
            
            get().addMessageToChannel(projectChannel, unifiedMessage);
          }
        }
      }

      // Handle reply message notifications
      else if (
        event.event_name === "thread.reply.notification" &&
        event.payload
      ) {
        console.log("ChatStore: Received reply notification:", event);

        const messageData = event.payload;

        // Detailed debugging: check payload structure
        console.log("ChatStore: Reply notification payload structure:", {
          message_id: event.event_id,
          event_source_id: event.source_id,
          sender_id: event.sender_id,
          original_sender: messageData.original_sender,
          channel: messageData.channel,
          content: messageData.content,
          reply_to_id: messageData.reply_to_id,
          thread_level: messageData.thread_level,
          timestamp: event.timestamp,
          reactions: messageData.reactions,
          fullPayload: messageData,
        });

        if (messageData.channel && messageData.content) {
          // Construct unified message format
          // Fix: use correct sender ID - event.source_id or event.sender_id is the actual reply author
          // messageData.original_sender refers to the original author of the replied message, not the reply sender
          const unifiedMessage: UnifiedMessage = {
            id:
              event.event_id ||
              `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
            senderId: event.source_id || event.sender_id || "unknown",
            timestamp: event.timestamp || new Date().toISOString(),
            content:
              typeof messageData.content === "string"
                ? messageData.content
                : messageData.content.text || "",
            type: messageData.message_type,
            channel: messageData.channel,
            replyToId: messageData.reply_to_id,
            threadLevel: messageData.thread_level || 1,
            reactions: messageData.reactions,
          };

          // Debug: check constructed message object
          console.log("ChatStore: Constructed reply message:", {
            id: unifiedMessage.id,
            senderId: unifiedMessage.senderId,
            content: unifiedMessage.content,
            type: unifiedMessage.type,
            replyToId: unifiedMessage.replyToId,
            threadLevel: unifiedMessage.threadLevel,
            channel: unifiedMessage.channel,
          });

          // Check if it's own reply message
          // const myUserId = get().getConnection()?.getAgentId();

          // Show system notification
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

          // if (unifiedMessage.senderId === currentUserId) {
          //   // This is own reply message, find and replace corresponding optimistic update message
          //   console.log("ChatStore: This is own reply message, looking for optimistic message to replace");

          //   const state = get();
          //   const channelMessages = state.channelMessages.get(messageData.channel) || [];

          //   // More precise reply message matching logic
          //   const optimisticMsg = channelMessages.find(msg => {
          //     if (!msg.isOptimistic || msg.status !== 'sending') return false;

          //     const contentMatch = msg.content === unifiedMessage.content;
          //     const senderMatch = msg.senderId === unifiedMessage.senderId;
          //     const typeMatch = msg.type === unifiedMessage.type;
          //     const replyMatch = msg.replyToId === unifiedMessage.replyToId;

          //     // Shorten time window to 5 seconds
          //     const timeDiff = Math.abs(new Date(msg.timestamp).getTime() - new Date(unifiedMessage.timestamp).getTime());
          //     const timeMatch = timeDiff < 5000;

          //     console.log(`ChatStore: Checking optimistic reply ${msg.tempId || msg.id}: content=${contentMatch}, sender=${senderMatch}, type=${typeMatch}, reply=${replyMatch}, time=${timeMatch}`);

          //     return contentMatch && senderMatch && typeMatch && replyMatch && timeMatch;
          //   });

          //   if (optimisticMsg && optimisticMsg.tempId) {
          //     console.log(`ChatStore: Found matching optimistic reply ${optimisticMsg.tempId}, replacing with real message ${unifiedMessage.id}`);
          //     get().replaceOptimisticMessage(optimisticMsg.tempId, unifiedMessage);
          //     return;
          //   } else {
          //     console.log(`ChatStore: No matching optimistic reply found for real message ${unifiedMessage.id}`);
          //   }
          // }

          // Check if it's a reply to current user's message
          const connection = get().getConnection();
          const currentUserId = connection?.getAgentId();

          if (
            unifiedMessage.replyToId &&
            currentUserId &&
            unifiedMessage.senderId !== currentUserId
          ) {
            // Find the original message being replied to
            const state = get();
            const channelMessages =
              state.channelMessages.get(messageData.channel) || [];
            const originalMessage = channelMessages.find(
              (msg) => msg.id === unifiedMessage.replyToId
            );

            // If found original message and sent by current user, show reply notification
            if (originalMessage && originalMessage.senderId === currentUserId) {
              console.log(
                `ChatStore: Detected reply to current user's message. Showing notification.`
              );
              const senderName = unifiedMessage.senderId || "Unknown user";
              const content = unifiedMessage.content || "";

              notificationService.showReplyNotification(
                senderName,
                messageData.channel,
                content
              );
            }
          }

          get().addMessageToChannel(messageData.channel, unifiedMessage);
        }
      }

      // Handle direct message notifications
      else if (
        event.event_name === "thread.direct_message.notification" &&
        event.payload
      ) {
        console.log("ChatStore: Received direct message notification:", event);

        const messageData = event.payload;

        // Show system notification - direct message
        if (messageData.content) {
          const senderName =
            event.source_id || messageData.sender_id || "Unknown user";
          const content =
            typeof messageData.content === "string"
              ? messageData.content
              : messageData.content.text || "";

          notificationService.showChatNotification(
            senderName,
            "",
            content,
            messageData.message_type
          );
        }

        if (messageData.content) {
          // Construct unified message format
          const unifiedMessage: UnifiedMessage = {
            id:
              event.event_id ||
              `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
            senderId: event.source_id || messageData.sender_id || "unknown",
            timestamp: event.timestamp || new Date().toISOString(),
            content:
              typeof messageData.content === "string"
                ? messageData.content
                : messageData.content.text || "",
            type: messageData.message_type,
            targetUserId: messageData.target_agent_id,
            reactions: messageData.reactions,
          };

          // Determine the target agent for the conversation
          const connection = get().getConnection();
          const currentAgentId = connection.getAgentId();
          const targetAgentId =
            messageData.sender_id === currentAgentId
              ? messageData.target_agent_id
              : messageData.sender_id;

          if (targetAgentId) {
            // // Check if it's own direct message
            // if (unifiedMessage.senderId === currentAgentId) {
            //   // This is own direct message, find and replace corresponding optimistic update message
            //   console.log("ChatStore: This is own direct message, looking for optimistic message to replace");

            //   const state = get();
            //   const directMessages = state.directMessages.get(targetAgentId) || [];

            //   // More precise direct message matching logic
            //   const optimisticMsg = directMessages.find(msg => {
            //     if (!msg.isOptimistic || msg.status !== 'sending') return false;

            //     const contentMatch = msg.content === unifiedMessage.content;
            //     const senderMatch = msg.senderId === unifiedMessage.senderId;
            //     const typeMatch = msg.type === unifiedMessage.type;

            //     // Shorten time window to 5 seconds
            //     const timeDiff = Math.abs(new Date(msg.timestamp).getTime() - new Date(unifiedMessage.timestamp).getTime());
            //     const timeMatch = timeDiff < 5000;

            //     console.log(`ChatStore: Checking optimistic direct message ${msg.tempId || msg.id}: content=${contentMatch}, sender=${senderMatch}, type=${typeMatch}, time=${timeMatch}`);

            //     return contentMatch && senderMatch && typeMatch && timeMatch;
            //   });

            //   if (optimisticMsg && optimisticMsg.tempId) {
            //     console.log(`ChatStore: Found matching optimistic direct message ${optimisticMsg.tempId}, replacing with real message ${unifiedMessage.id}`);
            //     get().replaceOptimisticMessage(optimisticMsg.tempId, unifiedMessage);
            //     return;
            //   } else {
            //     console.log(`ChatStore: No matching optimistic direct message found for real message ${unifiedMessage.id}`);
            //   }
            // }

            get().addMessageToDirect(targetAgentId, unifiedMessage);
          }
        }
      }

      // Handle reaction notifications
      else if (
        event.event_name === "thread.reaction.notification" &&
        event.payload
      ) {
        console.log("ChatStore: Received reaction notification:", event);

        const reactionData = event.payload;
        if (
          reactionData.target_message_id &&
          reactionData.reaction_type &&
          reactionData.action
        ) {
          console.log(
            `ChatStore: Processing reaction update for message ${reactionData.target_message_id}: ${reactionData.action} ${reactionData.reaction_type} (total: ${reactionData.total_reactions})`
          );

          // Find target message and update reactions
          const state = get();
          console.log(`ChatStore: State:`, state);
          let messageFound = false;

          // Enhanced message search function
          const findMessageInAllStores = (targetMessageId: string) => {
            const results = {
              found: false,
              location: null as "channel" | "direct" | null,
              channel: null as string | null,
              targetId: null as string | null,
              messageIndex: -1,
              message: null as any,
            };

            // First check ID mapping table to see if there's a mapping from real ID to temporary ID
            let searchIds = [targetMessageId];

            // Add possible temporary IDs (by reverse lookup in mapping table)
            for (const [tempId, realId] of Array.from(
              state.tempIdToRealIdMap.entries()
            )) {
              if (realId === targetMessageId) {
                searchIds.push(tempId);
              }
            }

            console.log(
              `ChatStore: Searching for message with IDs: ${searchIds.join(
                ", "
              )}`
            );

            // Search in all channel messages
            for (const [channel, messages] of Array.from(
              state.channelMessages.entries()
            )) {
              console.log(
                `ChatStore: Searching in channel #${channel} (${messages.length} messages)`
              );
              for (let i = 0; i < messages.length; i++) {
                const msg = messages[i];
                // Check multiple ID matching possibilities
                if (
                  searchIds.includes(msg.id) ||
                  (msg.tempId && searchIds.includes(msg.tempId)) ||
                  searchIds.includes(msg.originalId || "")
                ) {
                  results.found = true;
                  results.location = "channel";
                  results.channel = channel;
                  results.messageIndex = i;
                  results.message = msg;
                  console.log(
                    `ChatStore: Found message in channel #${channel} at index ${i} with ID ${msg.id} (tempId: ${msg.tempId})`
                  );
                  return results;
                }
              }
            }

            // Search in all direct messages
            for (const [targetId, messages] of Array.from(
              state.directMessages.entries()
            )) {
              console.log(
                `ChatStore: Searching in DM with ${targetId} (${messages.length} messages)`
              );
              for (let i = 0; i < messages.length; i++) {
                const msg = messages[i];
                // Check multiple ID matching possibilities
                if (
                  searchIds.includes(msg.id) ||
                  (msg.tempId && searchIds.includes(msg.tempId)) ||
                  searchIds.includes(msg.originalId || "")
                ) {
                  results.found = true;
                  results.location = "direct";
                  results.targetId = targetId;
                  results.messageIndex = i;
                  results.message = msg;
                  console.log(
                    `ChatStore: Found message in DM with ${targetId} at index ${i} with ID ${msg.id} (tempId: ${msg.tempId})`
                  );
                  return results;
                }
              }
            }

            // If not found, output debug information
            console.log(
              `ChatStore: Message not found. Current message store status:`
            );
            console.log(
              `  - Channels: ${Array.from(state.channelMessages.keys()).join(
                ", "
              )}`
            );
            console.log(
              `  - Direct messages: ${Array.from(
                state.directMessages.keys()
              ).join(", ")}`
            );
            console.log(
              `  - ID mapping entries: ${state.tempIdToRealIdMap.size}`
            );
            for (const [tempId, realId] of Array.from(
              state.tempIdToRealIdMap.entries()
            )) {
              console.log(`    ${tempId} -> ${realId}`);
            }

            return results;
          };

          // Use enhanced search function
          const searchResult = findMessageInAllStores(
            reactionData.target_message_id
          );

          if (searchResult.found) {
            messageFound = true;
            const currentReactions = {
              ...(searchResult.message.reactions || {}),
            };

            // Update reactions based on action
            if (reactionData.action === "added") {
              currentReactions[reactionData.reaction_type] =
                reactionData.total_reactions || 1;
            } else if (reactionData.action === "removed") {
              if (
                reactionData.total_reactions &&
                reactionData.total_reactions > 0
              ) {
                currentReactions[reactionData.reaction_type] =
                  reactionData.total_reactions;
              } else {
                delete currentReactions[reactionData.reaction_type];
              }
            }

            // Update message
            const updatedMessage = {
              ...searchResult.message,
              reactions: currentReactions,
              tempReactionId: undefined, // Clear temporary reaction ID as this is real data from backend
            };

            if (searchResult.location === "channel") {
              const newChannelMessages = new Map(state.channelMessages);
              const channelMessages = [
                ...newChannelMessages.get(searchResult.channel!)!,
              ];
              channelMessages[searchResult.messageIndex] = updatedMessage;
              newChannelMessages.set(searchResult.channel!, channelMessages);

              set((state) => ({
                ...state,
                channelMessages: newChannelMessages,
              }));

              console.log(
                `ChatStore: Updated reaction for channel message ${reactionData.target_message_id} in #${searchResult.channel}:`,
                currentReactions
              );
            } else if (searchResult.location === "direct") {
              const newDirectMessages = new Map(state.directMessages);
              const directMessages = [
                ...newDirectMessages.get(searchResult.targetId!)!,
              ];
              directMessages[searchResult.messageIndex] = updatedMessage;
              newDirectMessages.set(searchResult.targetId!, directMessages);

              set((state) => ({
                ...state,
                directMessages: newDirectMessages,
              }));

              console.log(
                `ChatStore: Updated reaction for direct message ${reactionData.target_message_id} with ${searchResult.targetId}:`,
                currentReactions
              );
            }
          }

          if (!messageFound) {
            console.warn(
              `ChatStore: Target message ${reactionData.target_message_id} not found for reaction update using enhanced search`
            );
          }
        } else {
          console.warn(
            "ChatStore: Invalid reaction notification payload - missing required fields:",
            reactionData
          );
        }
      }

      // Handle channel list response
      else if (
        event.event_name === "thread.channels.list_response" &&
        event.payload
      ) {
        console.log("ChatStore: Received channels list response:", event);

        if (event.payload.channels) {
          set({
            channels: event.payload.channels,
            channelsLoading: false,
            channelsLoaded: true, // Mark as loaded to prevent infinite loops
            channelsError: null,
          });
        } else {
          // Even if no channels, mark as loaded to prevent retry loops
          set({
            channelsLoading: false,
            channelsLoaded: true,
            channelsError: null,
          });
        }
      }

      // Handle channel messages retrieve response
      else if (
        event.event_name === "thread.channel_messages.retrieve_response" &&
        event.payload
      ) {
        console.log(
          "ChatStore: Received channel messages retrieve response:",
          event
        );

        const { channel, messages } = event.payload;
        if (channel && messages) {
          // Convert raw messages to unified format
          const rawMessages: RawThreadMessage[] = messages;
          const unifiedMessages =
            MessageAdapter.fromRawThreadMessages(rawMessages);
          const optimisticMessages: OptimisticMessage[] = unifiedMessages.map(
            (msg) => ({
              ...msg,
              isOptimistic: false,
              status: "sent" as MessageStatus,
            })
          );

          // Store in channelMessages Map
          set((state) => {
            const newChannelMessages = new Map(state.channelMessages);
            newChannelMessages.set(channel, optimisticMessages);
            return {
              channelMessages: newChannelMessages,
              messagesLoading: false,
              messagesError: null,
            };
          });
        }
      }

      // Handle direct messages retrieve response
      else if (
        event.event_name === "thread.direct_messages.retrieve_response" &&
        event.payload
      ) {
        console.log(
          "ChatStore: Received direct messages retrieve response:",
          event
        );

        const { target_agent_id, messages } = event.payload;
        if (target_agent_id && messages) {
          // Convert raw messages to unified format
          const rawMessages: RawThreadMessage[] = messages;
          const unifiedMessages =
            MessageAdapter.fromRawThreadMessages(rawMessages);
          const optimisticMessages: OptimisticMessage[] = unifiedMessages.map(
            (msg) => ({
              ...msg,
              isOptimistic: false,
              status: "sent" as MessageStatus,
            })
          );

          // Store in directMessages Map
          set((state) => {
            const newDirectMessages = new Map(state.directMessages);
            newDirectMessages.set(target_agent_id, optimisticMessages);
            return {
              directMessages: newDirectMessages,
              messagesLoading: false,
              messagesError: null,
            };
          });
        }
      }

      // Handle file upload response
      else if (
        event.event_name === "thread.file.upload_response" &&
        event.payload
      ) {
        console.log("ChatStore: Received file upload response:", event);
        // Can handle file upload success logic here
      }
    };

    // Register to event router
    eventRouter.onChatEvent(chatEventHandler);

    // Save handler reference for cleanup
    set({ eventHandler: chatEventHandler });
  },

  cleanupEventListeners: () => {
    const { eventHandler } = get();

    console.log("ChatStore: Cleaning up chat event listeners");

    if (eventHandler) {
      eventRouter.offChatEvent(eventHandler);
      set({ eventHandler: null });
    }
  },

  // Persistence methods
  saveSelectionToStorage: (type: "channel" | "agent", id: string) => {
    ChatSelectionStorage.save(type, id);
  },

  clearPersistedSelection: () => {
    ChatSelectionStorage.clear();
  },

  restorePersistedSelection: async () => {
    const stored = ChatSelectionStorage.load();
    if (!stored) {
      console.log("ChatStore: No persisted selection found");
      return;
    }

    console.log(
      `ChatStore: Restoring persisted selection: ${stored.type}:${stored.id}`
    );
    const state = get();

    if (stored.type === "channel") {
      // Check if channel exists
      const channelExists = state.channels.some((ch) => ch.name === stored.id);
      if (channelExists) {
        console.log(`ChatStore: Restoring channel selection: #${stored.id}`);
        set({
          currentChannel: stored.id,
          currentDirectMessage: null,
          persistedSelectionType: "channel",
          persistedSelectionId: stored.id,
        });
        // Load channel messages
        await get().loadChannelMessages(stored.id);
      } else {
        console.log(
          `ChatStore: Persisted channel #${stored.id} no longer exists, clearing selection`
        );
        get().clearPersistedSelection();
      }
    } else if (stored.type === "agent") {
      // Check if agent exists
      const agentExists = state.agents.some(
        (agent) => agent.agent_id === stored.id
      );
      if (agentExists) {
        console.log(`ChatStore: Restoring agent selection: ${stored.id}`);
        set({
          currentDirectMessage: stored.id,
          currentChannel: null,
          persistedSelectionType: "agent",
          persistedSelectionId: stored.id,
        });
        // Load direct messages
        await get().loadDirectMessages(stored.id);
      } else {
        console.log(
          `ChatStore: Persisted agent ${stored.id} no longer exists, clearing selection`
        );
        get().clearPersistedSelection();
      }
    }
  },

  initializeWithDefaultSelection: async () => {
    const state = get();

    // Wait for channels and agents data to load
    if (!state.channelsLoaded || !state.agentsLoaded) {
      console.log(
        "ChatStore: Waiting for channels and agents to load before initializing default selection"
      );
      return;
    }

    // If already has selection, skip default selection
    if (state.currentChannel || state.currentDirectMessage) {
      console.log(
        "ChatStore: Already has selection, skipping default initialization"
      );
      return;
    }

    console.log("ChatStore: Initializing with default selection");

    // Prioritize selecting first channel
    if (state.channels.length > 0) {
      const firstChannel = state.channels[0].name;
      console.log(`ChatStore: Selecting first channel: #${firstChannel}`);
      get().selectChannel(firstChannel);
      await get().loadChannelMessages(firstChannel);
    }
    // If no channels, select first agent
    else if (state.agents.length > 0) {
      const firstAgent = state.agents[0].agent_id;
      console.log(
        `ChatStore: No channels available, selecting first agent: ${firstAgent}`
      );
      get().selectDirectMessage(firstAgent);
      await get().loadDirectMessages(firstAgent);
    } else {
      console.log(
        "ChatStore: No channels or agents available for default selection"
      );
    }
  },
}));

// Helper function to set global context reference
export const setChatStoreContext = (context: any) => {
  globalOpenAgentsContext = context;
};
