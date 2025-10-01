import { create } from "zustand";
import { ThreadChannel, AgentInfo, EventNames } from "../types/events";
import { UnifiedMessage, RawThreadMessage, MessageAdapter } from "../types/message";
import { eventRouter } from "@/services/eventRouter";
import { notificationService } from "@/services/notificationService";

// 消息发送状态
export type MessageStatus = 'sending' | 'sent' | 'failed';

// 乐观更新消息接口
export interface OptimisticMessage extends UnifiedMessage {
  isOptimistic?: boolean;
  status?: MessageStatus;
  tempId?: string;
  originalId?: string;
  tempReactionId?: string; // 临时反应ID，用于标识和回滚乐观反应更新
  originalReactionCount?: number; // 原始反应计数，用于移除反应时的回滚
}

// Chat Store 接口
interface ChatState {
  // 连接 - 现在通过 context 获取
  // connection: any | null;  // 已移除，使用 context

  currentChannel: string | null;
  currentDirectMessage: string | null;

  // 持久化选择状态 - 用于页面刷新后恢复选择
  persistedSelectionType: 'channel' | 'agent' | null;
  persistedSelectionId: string | null;

  // Channels 状态
  channels: ThreadChannel[];
  channelsLoading: boolean;
  channelsError: string | null;
  channelsLoaded: boolean;

  // Messages 状态 - 按 channel/targetAgentId 分组存储
  channelMessages: Map<string, OptimisticMessage[]>;
  directMessages: Map<string, OptimisticMessage[]>;
  messagesLoading: boolean;
  messagesError: string | null;

  // 消息ID映射 - 临时ID到真实ID的映射
  tempIdToRealIdMap: Map<string, string>;

  // Agents 状态
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
  saveSelectionToStorage: (type: 'channel' | 'agent', id: string) => void;
  clearPersistedSelection: () => void;

  // Actions - Channels
  loadChannels: () => Promise<void>;
  clearChannelsError: () => void;

  // Actions - Messages
  loadChannelMessages: (channel: string, limit?: number, offset?: number) => Promise<void>;
  loadDirectMessages: (targetAgentId: string, limit?: number, offset?: number) => Promise<void>;
  sendChannelMessage: (channel: string, content: string, replyToId?: string) => Promise<boolean>;
  sendDirectMessage: (targetAgentId: string, content: string) => Promise<boolean>;
  clearMessagesError: () => void;

  // Actions - Agents
  loadAgents: () => Promise<void>;
  clearAgentsError: () => void;

  // Actions - Reactions
  addReaction: (messageId: string, reactionType: string, channel?: string) => Promise<boolean>;
  removeReaction: (messageId: string, reactionType: string, channel?: string) => Promise<boolean>;
  findRealMessageId: (messageId: string) => string;

  // Real-time updates
  addMessageToChannel: (channel: string, message: UnifiedMessage) => void;
  addMessageToDirect: (targetAgentId: string, message: UnifiedMessage) => void;
  updateMessage: (messageId: string, updates: Partial<OptimisticMessage>) => void;

  // 乐观更新方法
  addOptimisticChannelMessage: (channel: string, content: string, replyToId?: string) => string;
  addOptimisticDirectMessage: (targetAgentId: string, content: string) => string;
  replaceOptimisticMessage: (tempId: string, realMessage: UnifiedMessage) => void;
  markMessageAsFailed: (tempId: string) => void;
  retryMessage: (tempId: string) => Promise<boolean>;

  // Event handling
  setupEventListeners: () => void;
  cleanupEventListeners: () => void;

  // Event handler reference for cleanup
  eventHandler?: ((event: any) => void) | null;

  // Helper functions
  getChannelMessages: (channel: string) => OptimisticMessage[];
  getDirectMessagesForAgent: (targetAgentId: string, currentAgentId: string) => OptimisticMessage[];
  generateTempMessageId: () => string;
}

// 全局 context 引用，用于在 store 中访问
let globalOpenAgentsContext: any = null;

// localStorage 键名
const CHAT_SELECTION_STORAGE_KEY = 'openagents_chat_selection';

// 持久化选择数据结构
interface PersistedSelection {
  type: 'channel' | 'agent';
  id: string;
  timestamp: number;
}

// localStorage 工具函数
const ChatSelectionStorage = {
  save: (type: 'channel' | 'agent', id: string) => {
    try {
      const data: PersistedSelection = {
        type,
        id,
        timestamp: Date.now()
      };
      localStorage.setItem(CHAT_SELECTION_STORAGE_KEY, JSON.stringify(data));
      console.log(`ChatStore: Saved selection to localStorage: ${type}:${id}`);
    } catch (error) {
      console.warn('ChatStore: Failed to save selection to localStorage:', error);
    }
  },

  load: (): PersistedSelection | null => {
    try {
      const stored = localStorage.getItem(CHAT_SELECTION_STORAGE_KEY);
      if (stored) {
        const data: PersistedSelection = JSON.parse(stored);
        // 检查数据是否过期（30天）
        if (Date.now() - data.timestamp < 30 * 24 * 60 * 60 * 1000) {
          console.log(`ChatStore: Loaded selection from localStorage: ${data.type}:${data.id}`);
          return data;
        } else {
          console.log('ChatStore: Stored selection is expired, removing...');
          ChatSelectionStorage.clear();
        }
      }
    } catch (error) {
      console.warn('ChatStore: Failed to load selection from localStorage:', error);
    }
    return null;
  },

  clear: () => {
    try {
      localStorage.removeItem(CHAT_SELECTION_STORAGE_KEY);
      console.log('ChatStore: Cleared selection from localStorage');
    } catch (error) {
      console.warn('ChatStore: Failed to clear selection from localStorage:', error);
    }
  }
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

  // 消息ID映射
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
      currentDirectMessage: null, // 切换到频道时清除私信选择
      persistedSelectionType: 'channel',
      persistedSelectionId: channel,
    });

    // 保存到 localStorage
    get().saveSelectionToStorage('channel', channel);
  },

  selectDirectMessage: (targetAgentId: string) => {
    console.log(`ChatStore: Selecting direct message with ${targetAgentId}`);
    set({
      currentDirectMessage: targetAgentId,
      currentChannel: null, // 切换到私信时清除频道选择
      persistedSelectionType: 'agent',
      persistedSelectionId: targetAgentId,
    });

    // 保存到 localStorage
    get().saveSelectionToStorage('agent', targetAgentId);
  },

  clearSelection: () => {
    console.log("ChatStore: Clearing selection");
    set({
      currentChannel: null,
      currentDirectMessage: null,
      persistedSelectionType: null,
      persistedSelectionId: null,
    });

    // 清除 localStorage
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

    // 清除 localStorage
    get().clearPersistedSelection();
  },

  // Channels management
  loadChannels: async () => {
    const state = get();
    const connection = state.getConnection();

    // 防止重复调用
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
          message_type: "channel_info"
        },
      });

      if (response.success && response.data) {
        console.log("ChatStore: Loaded channels:", response.data.channels?.length || 0);
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
          channelsError: response.message || "Failed to load channels",
        });
      }
    } catch (error) {
      console.error("ChatStore: Failed to load channels:", error);
      set({
        channelsError: "Failed to load channels",
        channelsLoading: false,
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
      console.warn("ChatStore: No connection available for loadChannelMessages");
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
        console.log(`ChatStore: Loaded ${response.data.messages.length} messages for channel #${channel}`);


        // 转换原始消息为统一格式
        const rawMessages: RawThreadMessage[] = response.data.messages;
        const unifiedMessages = MessageAdapter.fromRawThreadMessages(rawMessages);

        // 过滤掉内容为空的消息（这些可能是历史数据问题）
        const validMessages = unifiedMessages.filter(msg => {
          if (!msg.content || msg.content.trim() === '') {
            console.warn(`ChatStore: Filtering out empty message ${msg.id} from ${msg.senderId}`);
            return false;
          }
          return true;
        });

        const optimisticMessages: OptimisticMessage[] = validMessages.map(msg => ({
          ...msg,
          isOptimistic: false,
          status: 'sent' as MessageStatus
        }));

        console.log(`ChatStore: Loaded ${validMessages.length} valid messages (filtered ${unifiedMessages.length - validMessages.length} empty messages)`);

        // 存储到 channelMessages Map 中
        set((state) => {
          const newChannelMessages = new Map(state.channelMessages);
          newChannelMessages.set(channel, optimisticMessages);
          return {
            channelMessages: newChannelMessages,
            messagesLoading: false,
          };
        });
      } else {
        console.warn(`ChatStore: Failed to load messages for channel #${channel}. Response:`, response);
        set({
          messagesLoading: false,
          messagesError: response.message || `Failed to load messages for channel #${channel}`,
        });
      }
    } catch (error) {
      console.error(`ChatStore: Failed to load messages for channel #${channel}:`, error);
      set({
        messagesError: `Failed to load messages for channel #${channel}`,
        messagesLoading: false,
      });
    }
  },

  loadDirectMessages: async (targetAgentId: string, limit = 200, offset = 0) => {
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
        console.log(`ChatStore: Loaded ${response.data.messages.length} direct messages with ${targetAgentId}`, response.data.messages);

        // // 转换原始消息为统一格式
        const rawMessages: RawThreadMessage[] = response.data.messages;
        const unifiedMessages = MessageAdapter.fromRawThreadMessages(rawMessages);

        // 过滤掉内容为空的消息（这些可能是历史数据问题）
        const validMessages = unifiedMessages.filter(msg => {
          console.log(msg)
          if (!msg.content || msg.content.trim() === '') {
            console.warn(`ChatStore: Filtering out empty DM ${msg.id} from ${msg.senderId}`);
            return false;
          }
          return true;
        });

        const optimisticMessages: OptimisticMessage[] = validMessages.map(msg => ({
          ...msg,
          isOptimistic: false,
          status: 'sent' as MessageStatus
        }));

        console.log(`ChatStore: Loaded ${validMessages.length} valid direct messages (filtered ${unifiedMessages.length - validMessages.length} empty messages)`);

        // 存储到 directMessages Map 中
        set((state) => {
          const newDirectMessages = new Map(state.directMessages);
          newDirectMessages.set(targetAgentId, optimisticMessages);
          return {
            directMessages: newDirectMessages,
            messagesLoading: false,
          };
        });
      } else {
        console.warn(`ChatStore: Failed to load direct messages with ${targetAgentId}. Response:`, response);
        set({
          messagesLoading: false,
          messagesError: response.message || `Failed to load direct messages with ${targetAgentId}`,
        });
      }
    } catch (error) {
      console.error(`ChatStore: Failed to load direct messages with ${targetAgentId}:`, error);
      set({
        messagesError: `Failed to load direct messages with ${targetAgentId}`,
        messagesLoading: false,
      });
    }
  },

  sendChannelMessage: async (channel: string, content: string, replyToId?: string) => {
    const connection = get().getConnection();
    if (!connection || !content.trim()) return false;

    console.log(`ChatStore: Sending message to #${channel}: "${content}"`);

    // 1. 立即添加乐观更新消息
    const tempId = get().addOptimisticChannelMessage(channel, content.trim(), replyToId);

    try {
      // 构建payload
      const payload: any = {
        channel: channel,
        content: { text: content.trim() },
        message_type: replyToId ? "reply_message" : "channel_message",
      };

      // 如果是回复消息，添加回复相关字段
      if (replyToId) {
        payload.reply_to_id = replyToId;
        payload.thread_level = 1; // 设置线程层级

        // 调试：输出发送的回复payload
        console.log(`ChatStore: Sending reply payload:`, {
          event_name: EventNames.THREAD_REPLY_SENT,
          destination_id: `channel:${channel}`,
          payload: payload
        });
      }

      const response = await connection.sendEvent({
        event_name: replyToId ? EventNames.THREAD_REPLY_SENT : EventNames.THREAD_CHANNEL_MESSAGE_POST,
        source_id: connection.getAgentId(),
        destination_id: `channel:${channel}`,
        payload: payload,
      });

      if (response.success) {
        console.log(`ChatStore: Message sent successfully to #${channel}`);

        // 2. 成功后，检查后端返回的数据结构
        console.log(`ChatStore: Backend response for channel message:`, response);

        // 尝试从不同路径获取message_id
        let realMessageId: string | null = null;
        if (response.data && response.data.message_id) {
          realMessageId = response.data.message_id;
        } else if (response.event_id) {
          // 如果没有message_id，使用event_id作为真实ID
          realMessageId = response.event_id;
        } else if (response.data && response.data.event_id) {
          realMessageId = response.data.event_id;
        }

        if (realMessageId) {
          // 使用后端返回的真实ID更新乐观消息
          console.log(`ChatStore: Updating optimistic message ${tempId} with real ID ${realMessageId}`);
          get().updateMessage(tempId, {
            id: realMessageId,
            status: 'sent' as MessageStatus,
            isOptimistic: false
          });

          // 记录ID映射
          set((state) => {
            const newTempIdToRealIdMap = new Map(state.tempIdToRealIdMap);
            newTempIdToRealIdMap.set(tempId, realMessageId!);
            return {
              ...state,
              tempIdToRealIdMap: newTempIdToRealIdMap
            };
          });
        } else {
          // 如果没有返回真实ID，只更新状态
          console.log(`ChatStore: No real message ID found in response, keeping temp ID ${tempId}`);
          get().updateMessage(tempId, { status: 'sent' as MessageStatus });
        }

        return true;
      } else {
        console.error(`ChatStore: Failed to send message to #${channel}:`, response.message);

        // 3. 发送失败，标记为失败状态
        get().markMessageAsFailed(tempId);
        set({ messagesError: response.message || "Failed to send message" });
        return false;
      }
    } catch (error) {
      console.error(`ChatStore: Failed to send message to #${channel}:`, error);

      // 4. 网络错误，标记为失败状态
      get().markMessageAsFailed(tempId);
      set({ messagesError: "Failed to send message" });
      return false;
    }
  },

  sendDirectMessage: async (targetAgentId: string, content: string) => {
    const connection = get().getConnection();
    if (!connection || !content.trim()) return false;

    console.log(`ChatStore: Sending direct message to ${targetAgentId}: "${content}"`);

    // 1. 立即添加乐观更新消息
    const tempId = get().addOptimisticDirectMessage(targetAgentId, content.trim());

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
        console.log(`ChatStore: Direct message sent successfully to ${targetAgentId}`);

        // 2. 成功后，检查后端返回的数据结构
        console.log(`ChatStore: Backend response for direct message:`, response);

        // 尝试从不同路径获取message_id
        let realMessageId: string | null = null;
        if (response.data && response.data.message_id) {
          realMessageId = response.data.message_id;
        } else if (response.event_id) {
          // 如果没有message_id，使用event_id作为真实ID
          realMessageId = response.event_id;
        } else if (response.data && response.data.event_id) {
          realMessageId = response.data.event_id;
        }

        if (realMessageId) {
          // 使用后端返回的真实ID更新乐观消息
          console.log(`ChatStore: Updating optimistic direct message ${tempId} with real ID ${realMessageId}`);
          get().updateMessage(tempId, {
            id: realMessageId,
            status: 'sent' as MessageStatus,
            isOptimistic: false
          });

          // 记录ID映射
          set((state) => {
            const newTempIdToRealIdMap = new Map(state.tempIdToRealIdMap);
            newTempIdToRealIdMap.set(tempId, realMessageId!);
            return {
              ...state,
              tempIdToRealIdMap: newTempIdToRealIdMap
            };
          });
        } else {
          // 如果没有返回真实ID，只更新状态
          console.log(`ChatStore: No real message ID found in response, keeping temp ID ${tempId}`);
          get().updateMessage(tempId, { status: 'sent' as MessageStatus });
        }

        return true;
      } else {
        console.error(`ChatStore: Failed to send direct message to ${targetAgentId}:`, response.message);

        // 3. 发送失败，标记为失败状态
        get().markMessageAsFailed(tempId);
        set({ messagesError: response.message || "Failed to send direct message" });
        return false;
      }
    } catch (error) {
      console.error(`ChatStore: Failed to send direct message to ${targetAgentId}:`, error);

      // 4. 网络错误，标记为失败状态
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

    // 防止重复调用
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
      // 使用 eventConnector 的 getConnectedAgents 方法
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

  // 辅助方法：查找真实消息ID
  findRealMessageId: (messageId: string) => {
    const state = get();

    // 如果已经是真实ID，直接返回
    if (!messageId.startsWith('temp_')) {
      return messageId;
    }

    // 从临时ID映射中查找真实ID
    const realId = state.tempIdToRealIdMap.get(messageId);
    if (realId) {
      console.log(`ChatStore: Found real ID ${realId} for temp ID ${messageId}`);
      return realId;
    }

    // 如果没有映射，检查是否已经被替换
    let foundRealId: string | null = null;

    // 在频道消息中查找
    for (const [channel, messages] of Array.from(state.channelMessages.entries())) {
      const message = messages.find((msg: OptimisticMessage) =>
        msg.id === messageId || msg.tempId === messageId
      );
      if (message && !message.isOptimistic) {
        foundRealId = message.id;
        console.log(`ChatStore: Found real message ID ${foundRealId} in channel ${channel}`);
        break;
      }
    }

    // 在私信中查找
    if (!foundRealId) {
      for (const [targetId, messages] of Array.from(state.directMessages.entries())) {
        const message = messages.find((msg: OptimisticMessage) =>
          msg.id === messageId || msg.tempId === messageId
        );
        if (message && !message.isOptimistic) {
          foundRealId = message.id;
          console.log(`ChatStore: Found real message ID ${foundRealId} in DM with ${targetId}`);
          break;
        }
      }
    }

    return foundRealId || messageId; // 如果找不到，返回原始ID
  },

  // Reactions management
  addReaction: async (messageId: string, reactionType: string, channel?: string) => {
    const connection = get().getConnection();
    if (!connection) return false;

    // 查找真实消息ID
    const realMessageId = get().findRealMessageId(messageId);
    console.log(`ChatStore: Adding reaction ${reactionType} to message ${messageId} (real ID: ${realMessageId})`);

    // 1. 立即添加乐观更新反应
    const tempReactionId = `temp_reaction_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    // 查找消息并添加乐观反应
    const state = get();
    let messageUpdated = false;

    // 更新频道消息的反应
    const newChannelMessages = new Map(state.channelMessages);
    for (const [ch, messages] of Array.from(newChannelMessages.entries())) {
      const messageIndex = messages.findIndex(msg =>
        msg.id === realMessageId || msg.id === messageId
      );
      if (messageIndex >= 0) {
        const message = messages[messageIndex];
        const currentReactions = { ...(message.reactions || {}) };

        // 添加或增加反应计数
        if (currentReactions[reactionType]) {
          currentReactions[reactionType] += 1;
        } else {
          currentReactions[reactionType] = 1;
        }

        const updatedMessages = [...messages];
        updatedMessages[messageIndex] = {
          ...message,
          reactions: currentReactions,
          tempReactionId: tempReactionId // 记录临时反应ID用于后续替换
        };
        newChannelMessages.set(ch, updatedMessages);
        messageUpdated = true;
        console.log(`ChatStore: Added optimistic reaction ${reactionType} to channel message ${realMessageId}`);
        break;
      }
    }

    // 更新私信消息的反应
    if (!messageUpdated) {
      const newDirectMessages = new Map(state.directMessages);
      for (const [targetId, messages] of Array.from(newDirectMessages.entries())) {
        const messageIndex = messages.findIndex(msg =>
          msg.id === realMessageId || msg.id === messageId
        );
        if (messageIndex >= 0) {
          const message = messages[messageIndex];
          const currentReactions = { ...(message.reactions || {}) };

          // 添加或增加反应计数
          if (currentReactions[reactionType]) {
            currentReactions[reactionType] += 1;
          } else {
            currentReactions[reactionType] = 1;
          }

          const updatedMessages = [...messages];
          updatedMessages[messageIndex] = {
            ...message,
            reactions: currentReactions,
            tempReactionId: tempReactionId // 记录临时反应ID用于后续替换
          };
          newDirectMessages.set(targetId, updatedMessages);
          messageUpdated = true;
          console.log(`ChatStore: Added optimistic reaction ${reactionType} to direct message ${realMessageId}`);
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

      // 检查双层success结构
      const isActualSuccess = response.success &&
                             (!response.data || response.data.success !== false);

      if (isActualSuccess) {
        console.log(`ChatStore: Reaction ${reactionType} added successfully to message ${realMessageId}`);

        // 2. 成功后，如果后端返回了真实反应数据，替换临时数据
        if (response.data && response.data.reactions) {
          console.log(`ChatStore: Updating reactions with backend response for message ${realMessageId}:`, response.data.reactions);
          get().updateMessage(realMessageId, {
            reactions: response.data.reactions,
            tempReactionId: undefined // 清除临时反应ID
          });
        }

        return true;
      } else {
        console.error(`ChatStore: Failed to add reaction ${reactionType} to message ${realMessageId}:`, response.message);

        // 3. 发送失败，回滚乐观更新
        console.log(`ChatStore: Rolling back optimistic reaction for message ${realMessageId}`);
        const currentState = get();

        // 回滚频道消息的反应
        const rollbackChannelMessages = new Map(currentState.channelMessages);
        for (const [ch, messages] of Array.from(rollbackChannelMessages.entries())) {
          const messageIndex = messages.findIndex(msg =>
            (msg.id === realMessageId || msg.id === messageId) && msg.tempReactionId === tempReactionId
          );
          if (messageIndex >= 0) {
            const message = messages[messageIndex];
            const rollbackReactions = { ...message.reactions };

            if (rollbackReactions[reactionType] && rollbackReactions[reactionType] > 1) {
              rollbackReactions[reactionType] -= 1;
            } else {
              delete rollbackReactions[reactionType];
            }

            const updatedMessages = [...messages];
            updatedMessages[messageIndex] = {
              ...message,
              reactions: rollbackReactions,
              tempReactionId: undefined
            };
            rollbackChannelMessages.set(ch, updatedMessages);
            break;
          }
        }

        // 回滚私信消息的反应
        const rollbackDirectMessages = new Map(currentState.directMessages);
        for (const [targetId, messages] of Array.from(rollbackDirectMessages.entries())) {
          const messageIndex = messages.findIndex(msg =>
            (msg.id === realMessageId || msg.id === messageId) && msg.tempReactionId === tempReactionId
          );
          if (messageIndex >= 0) {
            const message = messages[messageIndex];
            const rollbackReactions = { ...message.reactions };

            if (rollbackReactions[reactionType] && rollbackReactions[reactionType] > 1) {
              rollbackReactions[reactionType] -= 1;
            } else {
              delete rollbackReactions[reactionType];
            }

            const updatedMessages = [...messages];
            updatedMessages[messageIndex] = {
              ...message,
              reactions: rollbackReactions,
              tempReactionId: undefined
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
      console.error(`ChatStore: Failed to add reaction ${reactionType} to message ${realMessageId}:`, error);

      // 4. 网络错误，回滚乐观更新（同上逻辑）
      console.log(`ChatStore: Rolling back optimistic reaction due to network error for message ${realMessageId}`);
      const currentState = get();

      // 回滚频道消息的反应
      const rollbackChannelMessages = new Map(currentState.channelMessages);
      for (const [ch, messages] of Array.from(rollbackChannelMessages.entries())) {
        const messageIndex = messages.findIndex(msg =>
          (msg.id === realMessageId || msg.id === messageId) && msg.tempReactionId === tempReactionId
        );
        if (messageIndex >= 0) {
          const message = messages[messageIndex];
          const rollbackReactions = { ...message.reactions };

          if (rollbackReactions[reactionType] && rollbackReactions[reactionType] > 1) {
            rollbackReactions[reactionType] -= 1;
          } else {
            delete rollbackReactions[reactionType];
          }

          const updatedMessages = [...messages];
          updatedMessages[messageIndex] = {
            ...message,
            reactions: rollbackReactions,
            tempReactionId: undefined
          };
          rollbackChannelMessages.set(ch, updatedMessages);
          break;
        }
      }

      // 回滚私信消息的反应
      const rollbackDirectMessages = new Map(currentState.directMessages);
      for (const [targetId, messages] of Array.from(rollbackDirectMessages.entries())) {
        const messageIndex = messages.findIndex(msg =>
          (msg.id === realMessageId || msg.id === messageId) && msg.tempReactionId === tempReactionId
        );
        if (messageIndex >= 0) {
          const message = messages[messageIndex];
          const rollbackReactions = { ...message.reactions };

          if (rollbackReactions[reactionType] && rollbackReactions[reactionType] > 1) {
            rollbackReactions[reactionType] -= 1;
          } else {
            delete rollbackReactions[reactionType];
          }

          const updatedMessages = [...messages];
          updatedMessages[messageIndex] = {
            ...message,
            reactions: rollbackReactions,
            tempReactionId: undefined
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

  removeReaction: async (messageId: string, reactionType: string, channel?: string) => {
    const connection = get().getConnection();
    if (!connection) return false;

    // 查找真实消息ID
    const realMessageId = get().findRealMessageId(messageId);
    console.log(`ChatStore: Removing reaction ${reactionType} from message ${messageId} (real ID: ${realMessageId})`);

    // 1. 立即移除乐观更新反应
    const tempReactionId = `temp_reaction_remove_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    // 查找消息并移除乐观反应
    const state = get();
    let messageUpdated = false;
    let originalReactionCount = 0;

    // 更新频道消息的反应
    const newChannelMessages = new Map(state.channelMessages);
    for (const [ch, messages] of Array.from(newChannelMessages.entries())) {
      const messageIndex = messages.findIndex(msg =>
        msg.id === realMessageId || msg.id === messageId
      );
      if (messageIndex >= 0) {
        const message = messages[messageIndex];
        const currentReactions = { ...(message.reactions || {}) };
        originalReactionCount = currentReactions[reactionType] || 0;

        // 减少或移除反应计数
        if (currentReactions[reactionType] && currentReactions[reactionType] > 1) {
          currentReactions[reactionType] -= 1;
        } else {
          delete currentReactions[reactionType];
        }

        const updatedMessages = [...messages];
        updatedMessages[messageIndex] = {
          ...message,
          reactions: currentReactions,
          tempReactionId: tempReactionId,
          originalReactionCount: originalReactionCount // 记录原始计数用于回滚
        };
        newChannelMessages.set(ch, updatedMessages);
        messageUpdated = true;
        console.log(`ChatStore: Removed optimistic reaction ${reactionType} from channel message ${realMessageId}`);
        break;
      }
    }

    // 更新私信消息的反应
    if (!messageUpdated) {
      const newDirectMessages = new Map(state.directMessages);
      for (const [targetId, messages] of Array.from(newDirectMessages.entries())) {
        const messageIndex = messages.findIndex(msg =>
          msg.id === realMessageId || msg.id === messageId
        );
        if (messageIndex >= 0) {
          const message = messages[messageIndex];
          const currentReactions = { ...(message.reactions || {}) };
          originalReactionCount = currentReactions[reactionType] || 0;

          // 减少或移除反应计数
          if (currentReactions[reactionType] && currentReactions[reactionType] > 1) {
            currentReactions[reactionType] -= 1;
          } else {
            delete currentReactions[reactionType];
          }

          const updatedMessages = [...messages];
          updatedMessages[messageIndex] = {
            ...message,
            reactions: currentReactions,
            tempReactionId: tempReactionId,
            originalReactionCount: originalReactionCount // 记录原始计数用于回滚
          };
          newDirectMessages.set(targetId, updatedMessages);
          messageUpdated = true;
          console.log(`ChatStore: Removed optimistic reaction ${reactionType} from direct message ${realMessageId}`);
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

      // 检查双层success结构
      const isActualSuccess = response.success &&
                             (!response.data || response.data.success !== false);

      if (isActualSuccess) {
        console.log(`ChatStore: Reaction ${reactionType} removed successfully from message ${realMessageId}`);

        // 2. 成功后，如果后端返回了真实反应数据，替换临时数据
        if (response.data && response.data.reactions) {
          console.log(`ChatStore: Updating reactions with backend response for message ${realMessageId}:`, response.data.reactions);
          get().updateMessage(realMessageId, {
            reactions: response.data.reactions,
            tempReactionId: undefined,
            originalReactionCount: undefined // 清除临时数据
          });
        }

        return true;
      } else {
        console.error(`ChatStore: Failed to remove reaction ${reactionType} from message ${realMessageId}:`, response.message);

        // 3. 发送失败，回滚乐观更新
        console.log(`ChatStore: Rolling back optimistic reaction removal for message ${realMessageId}`);
        const currentState = get();

        // 回滚频道消息的反应
        const rollbackChannelMessages = new Map(currentState.channelMessages);
        for (const [ch, messages] of Array.from(rollbackChannelMessages.entries())) {
          const messageIndex = messages.findIndex(msg =>
            (msg.id === realMessageId || msg.id === messageId) && msg.tempReactionId === tempReactionId
          );
          if (messageIndex >= 0) {
            const message = messages[messageIndex];
            const rollbackReactions = { ...message.reactions };

            // 恢复原始反应计数
            if (message.originalReactionCount && message.originalReactionCount > 0) {
              rollbackReactions[reactionType] = message.originalReactionCount;
            }

            const updatedMessages = [...messages];
            updatedMessages[messageIndex] = {
              ...message,
              reactions: rollbackReactions,
              tempReactionId: undefined,
              originalReactionCount: undefined
            };
            rollbackChannelMessages.set(ch, updatedMessages);
            break;
          }
        }

        // 回滚私信消息的反应
        const rollbackDirectMessages = new Map(currentState.directMessages);
        for (const [targetId, messages] of Array.from(rollbackDirectMessages.entries())) {
          const messageIndex = messages.findIndex(msg =>
            (msg.id === realMessageId || msg.id === messageId) && msg.tempReactionId === tempReactionId
          );
          if (messageIndex >= 0) {
            const message = messages[messageIndex];
            const rollbackReactions = { ...message.reactions };

            // 恢复原始反应计数
            if (message.originalReactionCount && message.originalReactionCount > 0) {
              rollbackReactions[reactionType] = message.originalReactionCount;
            }

            const updatedMessages = [...messages];
            updatedMessages[messageIndex] = {
              ...message,
              reactions: rollbackReactions,
              tempReactionId: undefined,
              originalReactionCount: undefined
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
      console.error(`ChatStore: Failed to remove reaction ${reactionType} from message ${realMessageId}:`, error);

      // 4. 网络错误，回滚乐观更新（同上逻辑）
      console.log(`ChatStore: Rolling back optimistic reaction removal due to network error for message ${realMessageId}`);
      const currentState = get();

      // 回滚频道消息的反应
      const rollbackChannelMessages = new Map(currentState.channelMessages);
      for (const [ch, messages] of Array.from(rollbackChannelMessages.entries())) {
        const messageIndex = messages.findIndex(msg =>
          (msg.id === realMessageId || msg.id === messageId) && msg.tempReactionId === tempReactionId
        );
        if (messageIndex >= 0) {
          const message = messages[messageIndex];
          const rollbackReactions = { ...message.reactions };

          // 恢复原始反应计数
          if (message.originalReactionCount && message.originalReactionCount > 0) {
            rollbackReactions[reactionType] = message.originalReactionCount;
          }

          const updatedMessages = [...messages];
          updatedMessages[messageIndex] = {
            ...message,
            reactions: rollbackReactions,
            tempReactionId: undefined,
            originalReactionCount: undefined
          };
          rollbackChannelMessages.set(ch, updatedMessages);
          break;
        }
      }

      // 回滚私信消息的反应
      const rollbackDirectMessages = new Map(currentState.directMessages);
      for (const [targetId, messages] of Array.from(rollbackDirectMessages.entries())) {
        const messageIndex = messages.findIndex(msg =>
          (msg.id === realMessageId || msg.id === messageId) && msg.tempReactionId === tempReactionId
        );
        if (messageIndex >= 0) {
          const message = messages[messageIndex];
          const rollbackReactions = { ...message.reactions };

          // 恢复原始反应计数
          if (message.originalReactionCount && message.originalReactionCount > 0) {
            rollbackReactions[reactionType] = message.originalReactionCount;
          }

          const updatedMessages = [...messages];
          updatedMessages[messageIndex] = {
            ...message,
            reactions: rollbackReactions,
            tempReactionId: undefined,
            originalReactionCount: undefined
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

  // 生成临时消息ID
  generateTempMessageId: () => {
    return `temp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  },

  // 乐观更新 - 添加频道消息
  addOptimisticChannelMessage: (channel: string, content: string, replyToId?: string) => {
    const connection = get().getConnection();
    const tempId = get().generateTempMessageId();

    const optimisticMessage: OptimisticMessage = {
      id: tempId,
      senderId: connection?.getAgentId() || 'unknown',
      timestamp: new Date().toISOString(),
      content: content,
      type: replyToId ? 'reply_message' : 'channel_message',
      channel: channel,
      replyToId: replyToId,
      threadLevel: replyToId ? 1 : undefined, // 添加线程层级
      isOptimistic: true,
      status: 'sending' as MessageStatus,
      tempId: tempId
    };

    get().addMessageToChannel(channel, optimisticMessage);
    return tempId;
  },

  // 乐观更新 - 添加私信消息
  addOptimisticDirectMessage: (targetAgentId: string, content: string) => {
    const connection = get().getConnection();
    const tempId = get().generateTempMessageId();

    const optimisticMessage: OptimisticMessage = {
      id: tempId,
      senderId: connection?.getAgentId() || 'unknown',
      timestamp: new Date().toISOString(),
      content: content,
      type: 'direct_message',
      targetUserId: targetAgentId,
      isOptimistic: true,
      status: 'sending' as MessageStatus,
      tempId: tempId
    };

    get().addMessageToDirect(targetAgentId, optimisticMessage);
    return tempId;
  },

  // 替换乐观更新消息为真实消息
  replaceOptimisticMessage: (tempId: string, realMessage: UnifiedMessage) => {
    set((state) => {
      // 在频道消息中查找并替换
      const newChannelMessages = new Map(state.channelMessages);
      let messageReplaced = false;

      for (const [channel, messages] of Array.from(newChannelMessages.entries())) {
        const messageIndex = messages.findIndex(msg =>
          (msg.tempId === tempId || msg.id === tempId) && msg.isOptimistic
        );
        if (messageIndex >= 0) {
          const oldMessage = messages[messageIndex];
          console.log(`ChatStore: Replacing optimistic message in channel #${channel}:`);
          console.log(`  - Old: ${JSON.stringify({id: oldMessage.id, tempId: oldMessage.tempId, content: oldMessage.content, isOptimistic: oldMessage.isOptimistic})}`);
          console.log(`  - New: ${JSON.stringify({id: realMessage.id, content: realMessage.content})}`);

          const updatedMessages = [...messages];
          updatedMessages[messageIndex] = {
            ...realMessage,
            isOptimistic: false,
            status: 'sent' as MessageStatus,
            originalId: tempId
          };
          newChannelMessages.set(channel, updatedMessages);
          messageReplaced = true;

          // 记录ID映射
          const newTempIdToRealIdMap = new Map(state.tempIdToRealIdMap);
          newTempIdToRealIdMap.set(tempId, realMessage.id);

          console.log(`ChatStore: Successfully replaced optimistic message ${tempId} with real message ${realMessage.id} in channel #${channel}`);
          console.log(`ChatStore: Channel #${channel} now has ${updatedMessages.length} messages`);
          return {
            ...state,
            channelMessages: newChannelMessages,
            tempIdToRealIdMap: newTempIdToRealIdMap
          };
        }
      }

      // 在私信消息中查找并替换
      if (!messageReplaced) {
        const newDirectMessages = new Map(state.directMessages);
        for (const [targetAgentId, messages] of Array.from(newDirectMessages.entries())) {
          const messageIndex = messages.findIndex(msg =>
            (msg.tempId === tempId || msg.id === tempId) && msg.isOptimistic
          );
          if (messageIndex >= 0) {
            const oldMessage = messages[messageIndex];
            console.log(`ChatStore: Replacing optimistic direct message with ${targetAgentId}:`);
            console.log(`  - Old: ${JSON.stringify({id: oldMessage.id, tempId: oldMessage.tempId, content: oldMessage.content, isOptimistic: oldMessage.isOptimistic})}`);
            console.log(`  - New: ${JSON.stringify({id: realMessage.id, content: realMessage.content})}`);

            const updatedMessages = [...messages];
            updatedMessages[messageIndex] = {
              ...realMessage,
              isOptimistic: false,
              status: 'sent' as MessageStatus,
              originalId: tempId
            };
            newDirectMessages.set(targetAgentId, updatedMessages);

            // 记录ID映射
            const newTempIdToRealIdMap = new Map(state.tempIdToRealIdMap);
            newTempIdToRealIdMap.set(tempId, realMessage.id);

            console.log(`ChatStore: Successfully replaced optimistic message ${tempId} with real message ${realMessage.id} in DM with ${targetAgentId}`);
            console.log(`ChatStore: DM with ${targetAgentId} now has ${updatedMessages.length} messages`);
            return {
              ...state,
              directMessages: newDirectMessages,
              tempIdToRealIdMap: newTempIdToRealIdMap
            };
          }
        }
      }

      console.warn(`ChatStore: Could not find optimistic message ${tempId} to replace`);
      return state;
    });
  },

  // 标记消息为失败
  markMessageAsFailed: (tempId: string) => {
    get().updateMessage(tempId, { status: 'failed' as MessageStatus });
  },

  // 重试消息
  retryMessage: async (tempId: string) => {
    const state = get();

    // 查找消息
    let messageToRetry: OptimisticMessage | undefined;
    let channel: string | undefined;
    let targetAgentId: string | undefined;

    // 在频道消息中查找
    for (const [ch, messages] of Array.from(state.channelMessages.entries())) {
      const msg = messages.find(m => m.tempId === tempId || m.id === tempId);
      if (msg) {
        messageToRetry = msg;
        channel = ch;
        break;
      }
    }

    // 在私信消息中查找
    if (!messageToRetry) {
      for (const [agentId, messages] of Array.from(state.directMessages.entries())) {
        const msg = messages.find(m => m.tempId === tempId || m.id === tempId);
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

    // 更新状态为发送中
    get().updateMessage(tempId, { status: 'sending' as MessageStatus });

    // 重新发送
    try {
      if (channel) {
        return await get().sendChannelMessage(channel, messageToRetry.content, messageToRetry.replyToId);
      } else if (targetAgentId) {
        return await get().sendDirectMessage(targetAgentId, messageToRetry.content);
      }
      return false;
    } catch (error) {
      console.error(`ChatStore: Retry failed for message ${tempId}:`, error);
      get().markMessageAsFailed(tempId);
      return false;
    }
  },

  // Real-time updates
  addMessageToChannel: (channel: string, message: UnifiedMessage | OptimisticMessage) => {
    set((state) => {
      const newChannelMessages = new Map(state.channelMessages);
      const currentMessages = newChannelMessages.get(channel) || [];

      // 强化的消息去重机制
      const messageToAdd = message as OptimisticMessage;
      const exists = currentMessages.some(msg => {
        // 1. 直接ID匹配
        if (msg.id === messageToAdd.id) {
          console.log(`ChatStore: Message with ID ${messageToAdd.id} already exists in channel #${channel} (ID match)`);
          return true;
        }

        // 2. 临时ID匹配
        if (messageToAdd.tempId && msg.tempId === messageToAdd.tempId) {
          console.log(`ChatStore: Message with tempId ${messageToAdd.tempId} already exists in channel #${channel} (tempId match)`);
          return true;
        }

        // 3. 内容和时间匹配（防止相同内容的重复消息）
        if (msg.content === messageToAdd.content &&
            msg.senderId === messageToAdd.senderId &&
            msg.type === messageToAdd.type) {
          const timeDiff = Math.abs(new Date(msg.timestamp).getTime() - new Date(messageToAdd.timestamp).getTime());
          if (timeDiff < 2000) { // 2秒内的相同消息认为是重复
            console.log(`ChatStore: Duplicate message detected in channel #${channel} (content+time match, ${timeDiff}ms apart)`);
            return true;
          }
        }

        return false;
      });

      if (exists) {
        return state;
      }

      // 添加新消息到末尾
      const optimisticMessage: OptimisticMessage = {
        ...message,
        isOptimistic: (message as OptimisticMessage).isOptimistic || false,
        status: (message as OptimisticMessage).status || 'sent'
      };

      const updatedMessages = [...currentMessages, optimisticMessage];
      newChannelMessages.set(channel, updatedMessages);

      console.log(`ChatStore: Added message to channel #${channel}:`, message.content);
      console.log(`ChatStore: Message details:`, {
        id: messageToAdd.id,
        type: messageToAdd.type,
        replyToId: messageToAdd.replyToId,
        threadLevel: messageToAdd.threadLevel,
        senderId: messageToAdd.senderId
      }, messageToAdd);
      console.log(`ChatStore: Channel #${channel} now has ${updatedMessages.length} messages`);
      console.log(`ChatStore: Updated channelMessages Map size: ${newChannelMessages.size}`);

      return {
        ...state,
        channelMessages: newChannelMessages,
      };
    });
  },

  addMessageToDirect: (targetAgentId: string, message: UnifiedMessage | OptimisticMessage) => {
    set((state) => {
      const newDirectMessages = new Map(state.directMessages);
      const currentMessages = newDirectMessages.get(targetAgentId) || [];

      // 强化的私信消息去重机制
      const messageToAdd = message as OptimisticMessage;
      const exists = currentMessages.some(msg => {
        // 1. 直接ID匹配
        if (msg.id === messageToAdd.id) {
          console.log(`ChatStore: Direct message with ID ${messageToAdd.id} already exists with ${targetAgentId} (ID match)`);
          return true;
        }

        // 2. 临时ID匹配
        if (messageToAdd.tempId && msg.tempId === messageToAdd.tempId) {
          console.log(`ChatStore: Direct message with tempId ${messageToAdd.tempId} already exists with ${targetAgentId} (tempId match)`);
          return true;
        }

        // 3. 内容和时间匹配（防止相同内容的重复消息）
        if (msg.content === messageToAdd.content &&
            msg.senderId === messageToAdd.senderId &&
            msg.type === messageToAdd.type) {
          const timeDiff = Math.abs(new Date(msg.timestamp).getTime() - new Date(messageToAdd.timestamp).getTime());
          if (timeDiff < 2000) { // 2秒内的相同消息认为是重复
            console.log(`ChatStore: Duplicate direct message detected with ${targetAgentId} (content+time match, ${timeDiff}ms apart)`);
            return true;
          }
        }

        return false;
      });

      if (exists) {
        return state;
      }

      // 添加新消息到末尾
      const optimisticMessage: OptimisticMessage = {
        ...message,
        isOptimistic: (message as OptimisticMessage).isOptimistic || false,
        status: (message as OptimisticMessage).status || 'sent'
      };

      const updatedMessages = [...currentMessages, optimisticMessage];
      newDirectMessages.set(targetAgentId, updatedMessages);

      console.log(`ChatStore: Added direct message with ${targetAgentId}:`, message.content);
      return {
        ...state,
        directMessages: newDirectMessages,
      };
    });
  },

  updateMessage: (messageId: string, updates: Partial<OptimisticMessage>) => {
    set((state) => {
      let messageUpdated = false;

      // 更新 channel messages
      const newChannelMessages = new Map(state.channelMessages);
      for (const [channel, messages] of Array.from(newChannelMessages.entries())) {
        const messageIndex = messages.findIndex((msg: OptimisticMessage) =>
          msg.id === messageId || msg.tempId === messageId
        );
        if (messageIndex >= 0) {
          const updatedMessages = [...messages];
          updatedMessages[messageIndex] = { ...updatedMessages[messageIndex], ...updates };
          newChannelMessages.set(channel, updatedMessages);
          messageUpdated = true;
          console.log(`ChatStore: Updated message ${messageId} in channel #${channel}`);
          break;
        }
      }

      // 更新 direct messages
      const newDirectMessages = new Map(state.directMessages);
      if (!messageUpdated) {
        for (const [targetAgentId, messages] of Array.from(newDirectMessages.entries())) {
          const messageIndex = messages.findIndex((msg: OptimisticMessage) =>
            msg.id === messageId || msg.tempId === messageId
          );
          if (messageIndex >= 0) {
            const updatedMessages = [...messages];
            updatedMessages[messageIndex] = { ...updatedMessages[messageIndex], ...updates };
            newDirectMessages.set(targetAgentId, updatedMessages);
            messageUpdated = true;
            console.log(`ChatStore: Updated message ${messageId} in direct messages with ${targetAgentId}`);
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

  getDirectMessagesForAgent: (targetAgentId: string, currentAgentId: string) => {
    const { directMessages } = get();
    const messages = directMessages.get(targetAgentId) || [];

    // 过滤属于当前会话的消息
    return messages.filter(message =>
      (message.type === 'direct_message') &&
      ((message.senderId === currentAgentId && message.targetUserId === targetAgentId) ||
      (message.senderId === targetAgentId && message.targetUserId === currentAgentId) ||
      (message.senderId === targetAgentId))  // 兼容旧格式
    );
  },

  // Event handling
  setupEventListeners: () => {
    const connection = get().getConnection();
    if (!connection) return;

    console.log("ChatStore: Setting up chat event listeners");

    // 使用事件路由器监听chat相关事件
    const chatEventHandler = (event: any) => {
      console.log("ChatStore: Received chat event:", event.event_name, event);

      // 处理频道消息通知
      if (event.event_name === "thread.channel_message.notification" && event.payload) {
        console.log("ChatStore: Received channel message notification:", event);

        const messageData = event.payload;

        // 显示系统通知
        if (messageData.channel && messageData.content) {
          const senderName = event.sender_id || event.source_id || "未知用户";
          const content = typeof messageData.content === 'string'
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
          // 构造统一消息格式
          const unifiedMessage: UnifiedMessage = {
            id: event.event_id || `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
            senderId: event.sender_id || event.source_id || "unknown",
            timestamp: messageData.timestamp || new Date().toISOString(),
            content: typeof messageData.content === 'string' ? messageData.content : messageData.content.text || "",
            type: messageData.message_type,
            channel: messageData.channel,
            replyToId: messageData.reply_to_id || event.reply_to_id,
            threadLevel: messageData.thread_level || 1,
            reactions: messageData.reactions,
          };

          // 检查是否是自己发送的消息（可能需要替换乐观更新消息）
          // const connection = get().getConnection();
          // const currentUserId = connection?.getAgentId();

          // if (unifiedMessage.senderId === currentUserId) {
          //   // 这是自己发送的消息，查找并替换对应的乐观更新消息
          //   console.log("ChatStore: This is own message, looking for optimistic message to replace");

          //   const state = get();
          //   const channelMessages = state.channelMessages.get(messageData.channel) || [];
          //   const optimisticMsg = channelMessages.find(msg =>
          //     msg.isOptimistic &&
          //     msg.content === unifiedMessage.content &&
          //     msg.senderId === unifiedMessage.senderId &&
          //     msg.type === unifiedMessage.type &&
          //     Math.abs(new Date(msg.timestamp).getTime() - new Date(unifiedMessage.timestamp).getTime()) < 30000 // 30秒内
          //   );

          //   if (optimisticMsg && optimisticMsg.tempId) {
          //     console.log(`ChatStore: Found matching optimistic message ${optimisticMsg.tempId}, replacing with real message ${unifiedMessage.id}`);
          //     get().replaceOptimisticMessage(optimisticMsg.tempId, unifiedMessage);
          //     return; // 不再执行 addMessageToChannel
          //   }
          // }

          // 如果不是自己的消息或没找到对应的乐观更新消息，直接添加
          get().addMessageToChannel(messageData.channel, unifiedMessage);
        }
      }

      // 处理回复消息通知
      else if (event.event_name === "thread.reply.notification" && event.payload) {
        console.log("ChatStore: Received reply notification:", event);

        const messageData = event.payload;

        // 详细调试：检查payload结构
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
          fullPayload: messageData
        });

        if (messageData.channel && messageData.content) {
          // 构造统一消息格式
          // 修复：使用正确的发送者ID - event.source_id 或 event.sender_id 是实际的回复作者
          // messageData.original_sender 指的是被回复消息的原作者，不是回复的发送者
          const unifiedMessage: UnifiedMessage = {
            id: event.event_id || `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
            senderId: event.source_id || event.sender_id || "unknown",
            timestamp: event.timestamp || new Date().toISOString(),
            content: typeof messageData.content === 'string' ? messageData.content : messageData.content.text || "",
            type: messageData.message_type,
            channel: messageData.channel,
            replyToId: messageData.reply_to_id,
            threadLevel: messageData.thread_level || 1,
            reactions: messageData.reactions,
          };

          // 调试：检查构造的消息对象
          console.log("ChatStore: Constructed reply message:", {
            id: unifiedMessage.id,
            senderId: unifiedMessage.senderId,
            content: unifiedMessage.content,
            type: unifiedMessage.type,
            replyToId: unifiedMessage.replyToId,
            threadLevel: unifiedMessage.threadLevel,
            channel: unifiedMessage.channel
          });

          // 检查是否是自己发送的回复消息
          const myUserId = get().getConnection()?.getAgentId();

          // 显示系统通知
          if (messageData.channel && messageData.content) {
            const senderName = event.sender_id || event.source_id || "未知用户";
            const content = typeof messageData.content === 'string'
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
          //   // 这是自己发送的回复消息，查找并替换对应的乐观更新消息
          //   console.log("ChatStore: This is own reply message, looking for optimistic message to replace");

          //   const state = get();
          //   const channelMessages = state.channelMessages.get(messageData.channel) || [];

          //   // 更精确的回复消息匹配逻辑
          //   const optimisticMsg = channelMessages.find(msg => {
          //     if (!msg.isOptimistic || msg.status !== 'sending') return false;

          //     const contentMatch = msg.content === unifiedMessage.content;
          //     const senderMatch = msg.senderId === unifiedMessage.senderId;
          //     const typeMatch = msg.type === unifiedMessage.type;
          //     const replyMatch = msg.replyToId === unifiedMessage.replyToId;

          //     // 缩短时间窗口到 5 秒
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

          // 检查是否是回复当前用户的消息
          const connection = get().getConnection();
          const currentUserId = connection?.getAgentId();

          if (unifiedMessage.replyToId && currentUserId && unifiedMessage.senderId !== currentUserId) {
            // 查找被回复的原始消息
            const state = get();
            const channelMessages = state.channelMessages.get(messageData.channel) || [];
            const originalMessage = channelMessages.find(msg => msg.id === unifiedMessage.replyToId);

            // 如果找到原始消息且是当前用户发送的，显示回复通知
            if (originalMessage && originalMessage.senderId === currentUserId) {
              console.log(`ChatStore: Detected reply to current user's message. Showing notification.`);
              const senderName = unifiedMessage.senderId || "未知用户";
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

      // 处理私信消息通知
      else if (event.event_name === "thread.direct_message.notification" && event.payload) {
        console.log("ChatStore: Received direct message notification:", event);

        const messageData = event.payload;

        // 显示系统通知 - 私信
        if (messageData.content) {
          const senderName = event.source_id || messageData.sender_id || "未知用户";
          const content = typeof messageData.content === 'string'
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
          // 构造统一消息格式
          const unifiedMessage: UnifiedMessage = {
            id: event.event_id || `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
            senderId: event.source_id || messageData.sender_id || "unknown",
            timestamp: event.timestamp || new Date().toISOString(),
            content: typeof messageData.content === 'string' ? messageData.content : messageData.content.text || "",
            type: messageData.message_type,
            targetUserId: messageData.target_agent_id,
            reactions: messageData.reactions,
          };

          // 确定对话的目标 agent
          const connection = get().getConnection();
          const currentAgentId = connection.getAgentId();
          const targetAgentId = messageData.sender_id === currentAgentId
            ? messageData.target_agent_id
            : messageData.sender_id;

          if (targetAgentId) {
            // // 检查是否是自己发送的私信消息
            // if (unifiedMessage.senderId === currentAgentId) {
            //   // 这是自己发送的私信消息，查找并替换对应的乐观更新消息
            //   console.log("ChatStore: This is own direct message, looking for optimistic message to replace");

            //   const state = get();
            //   const directMessages = state.directMessages.get(targetAgentId) || [];

            //   // 更精确的私信消息匹配逻辑
            //   const optimisticMsg = directMessages.find(msg => {
            //     if (!msg.isOptimistic || msg.status !== 'sending') return false;

            //     const contentMatch = msg.content === unifiedMessage.content;
            //     const senderMatch = msg.senderId === unifiedMessage.senderId;
            //     const typeMatch = msg.type === unifiedMessage.type;

            //     // 缩短时间窗口到 5 秒
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

      // 处理反应通知
      else if (event.event_name === "thread.reaction.notification" && event.payload) {
        console.log("ChatStore: Received reaction notification:", event);

        const reactionData = event.payload;
        if (reactionData.target_message_id && reactionData.reaction_type && reactionData.action) {
          console.log(`ChatStore: Processing reaction update for message ${reactionData.target_message_id}: ${reactionData.action} ${reactionData.reaction_type} (total: ${reactionData.total_reactions})`);

          // 查找目标消息并更新反应
          const state = get();
          console.log(`ChatStore: State:`, state);
          let messageFound = false;

          // 增强的消息查找函数
          const findMessageInAllStores = (targetMessageId: string) => {
            const results = {
              found: false,
              location: null as 'channel' | 'direct' | null,
              channel: null as string | null,
              targetId: null as string | null,
              messageIndex: -1,
              message: null as any
            };

            // 首先检查ID映射表，看看是否有从真实ID到临时ID的映射
            let searchIds = [targetMessageId];

            // 添加可能的临时ID（通过反向查找映射表）
            for (const [tempId, realId] of Array.from(state.tempIdToRealIdMap.entries())) {
              if (realId === targetMessageId) {
                searchIds.push(tempId);
              }
            }

            console.log(`ChatStore: Searching for message with IDs: ${searchIds.join(', ')}`);

            // 在所有频道消息中搜索
            for (const [channel, messages] of Array.from(state.channelMessages.entries())) {
              console.log(`ChatStore: Searching in channel #${channel} (${messages.length} messages)`);
              for (let i = 0; i < messages.length; i++) {
                const msg = messages[i];
                // 检查多种ID匹配可能性
                if (searchIds.includes(msg.id) ||
                    (msg.tempId && searchIds.includes(msg.tempId)) ||
                    searchIds.includes(msg.originalId || '')) {
                  results.found = true;
                  results.location = 'channel';
                  results.channel = channel;
                  results.messageIndex = i;
                  results.message = msg;
                  console.log(`ChatStore: Found message in channel #${channel} at index ${i} with ID ${msg.id} (tempId: ${msg.tempId})`);
                  return results;
                }
              }
            }

            // 在所有私信中搜索
            for (const [targetId, messages] of Array.from(state.directMessages.entries())) {
              console.log(`ChatStore: Searching in DM with ${targetId} (${messages.length} messages)`);
              for (let i = 0; i < messages.length; i++) {
                const msg = messages[i];
                // 检查多种ID匹配可能性
                if (searchIds.includes(msg.id) ||
                    (msg.tempId && searchIds.includes(msg.tempId)) ||
                    searchIds.includes(msg.originalId || '')) {
                  results.found = true;
                  results.location = 'direct';
                  results.targetId = targetId;
                  results.messageIndex = i;
                  results.message = msg;
                  console.log(`ChatStore: Found message in DM with ${targetId} at index ${i} with ID ${msg.id} (tempId: ${msg.tempId})`);
                  return results;
                }
              }
            }

            // 如果没找到，输出调试信息
            console.log(`ChatStore: Message not found. Current message store status:`);
            console.log(`  - Channels: ${Array.from(state.channelMessages.keys()).join(', ')}`);
            console.log(`  - Direct messages: ${Array.from(state.directMessages.keys()).join(', ')}`);
            console.log(`  - ID mapping entries: ${state.tempIdToRealIdMap.size}`);
            for (const [tempId, realId] of Array.from(state.tempIdToRealIdMap.entries())) {
              console.log(`    ${tempId} -> ${realId}`);
            }

            return results;
          };

          // 使用增强的查找函数
          const searchResult = findMessageInAllStores(reactionData.target_message_id);

          if (searchResult.found) {
            messageFound = true;
            const currentReactions = { ...(searchResult.message.reactions || {}) };

            // 根据action更新反应
            if (reactionData.action === 'added') {
              currentReactions[reactionData.reaction_type] = reactionData.total_reactions || 1;
            } else if (reactionData.action === 'removed') {
              if (reactionData.total_reactions && reactionData.total_reactions > 0) {
                currentReactions[reactionData.reaction_type] = reactionData.total_reactions;
              } else {
                delete currentReactions[reactionData.reaction_type];
              }
            }

            // 更新消息
            const updatedMessage = {
              ...searchResult.message,
              reactions: currentReactions,
              tempReactionId: undefined, // 清除临时反应ID，因为这是来自后端的真实数据
            };

            if (searchResult.location === 'channel') {
              const newChannelMessages = new Map(state.channelMessages);
              const channelMessages = [...newChannelMessages.get(searchResult.channel!)!];
              channelMessages[searchResult.messageIndex] = updatedMessage;
              newChannelMessages.set(searchResult.channel!, channelMessages);

              set((state) => ({
                ...state,
                channelMessages: newChannelMessages,
              }));

              console.log(`ChatStore: Updated reaction for channel message ${reactionData.target_message_id} in #${searchResult.channel}:`, currentReactions);
            } else if (searchResult.location === 'direct') {
              const newDirectMessages = new Map(state.directMessages);
              const directMessages = [...newDirectMessages.get(searchResult.targetId!)!];
              directMessages[searchResult.messageIndex] = updatedMessage;
              newDirectMessages.set(searchResult.targetId!, directMessages);

              set((state) => ({
                ...state,
                directMessages: newDirectMessages,
              }));

              console.log(`ChatStore: Updated reaction for direct message ${reactionData.target_message_id} with ${searchResult.targetId}:`, currentReactions);
            }
          }

          if (!messageFound) {
            console.warn(`ChatStore: Target message ${reactionData.target_message_id} not found for reaction update using enhanced search`);
          }
        } else {
          console.warn("ChatStore: Invalid reaction notification payload - missing required fields:", reactionData);
        }
      }

      // 处理频道列表响应
      else if (event.event_name === "thread.channels.list_response" && event.payload) {
        console.log("ChatStore: Received channels list response:", event);

        if (event.payload.channels) {
          set({
            channels: event.payload.channels,
            channelsLoading: false,
            channelsError: null,
          });
        }
      }

      // 处理频道消息检索响应
      else if (event.event_name === "thread.channel_messages.retrieve_response" && event.payload) {
        console.log("ChatStore: Received channel messages retrieve response:", event);

        const { channel, messages } = event.payload;
        if (channel && messages) {
          // 转换原始消息为统一格式
          const rawMessages: RawThreadMessage[] = messages;
          const unifiedMessages = MessageAdapter.fromRawThreadMessages(rawMessages);
          const optimisticMessages: OptimisticMessage[] = unifiedMessages.map(msg => ({
            ...msg,
            isOptimistic: false,
            status: 'sent' as MessageStatus
          }));

          // 存储到 channelMessages Map 中
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

      // 处理私信检索响应
      else if (event.event_name === "thread.direct_messages.retrieve_response" && event.payload) {
        console.log("ChatStore: Received direct messages retrieve response:", event);

        const { target_agent_id, messages } = event.payload;
        if (target_agent_id && messages) {
          // 转换原始消息为统一格式
          const rawMessages: RawThreadMessage[] = messages;
          const unifiedMessages = MessageAdapter.fromRawThreadMessages(rawMessages);
          const optimisticMessages: OptimisticMessage[] = unifiedMessages.map(msg => ({
            ...msg,
            isOptimistic: false,
            status: 'sent' as MessageStatus
          }));

          // 存储到 directMessages Map 中
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

      // 处理文件上传响应
      else if (event.event_name === "thread.file.upload_response" && event.payload) {
        console.log("ChatStore: Received file upload response:", event);
        // 可以在这里处理文件上传成功的逻辑
      }
    };

    // 注册到事件路由器
    eventRouter.onChatEvent(chatEventHandler);

    // 保存handler引用以便清理
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
  saveSelectionToStorage: (type: 'channel' | 'agent', id: string) => {
    ChatSelectionStorage.save(type, id);
  },

  clearPersistedSelection: () => {
    ChatSelectionStorage.clear();
  },

  restorePersistedSelection: async () => {
    const stored = ChatSelectionStorage.load();
    if (!stored) {
      console.log('ChatStore: No persisted selection found');
      return;
    }

    console.log(`ChatStore: Restoring persisted selection: ${stored.type}:${stored.id}`);
    const state = get();

    if (stored.type === 'channel') {
      // 检查频道是否存在
      const channelExists = state.channels.some(ch => ch.name === stored.id);
      if (channelExists) {
        console.log(`ChatStore: Restoring channel selection: #${stored.id}`);
        set({
          currentChannel: stored.id,
          currentDirectMessage: null,
          persistedSelectionType: 'channel',
          persistedSelectionId: stored.id,
        });
        // 加载频道消息
        await get().loadChannelMessages(stored.id);
      } else {
        console.log(`ChatStore: Persisted channel #${stored.id} no longer exists, clearing selection`);
        get().clearPersistedSelection();
      }
    } else if (stored.type === 'agent') {
      // 检查代理是否存在
      const agentExists = state.agents.some(agent => agent.agent_id === stored.id);
      if (agentExists) {
        console.log(`ChatStore: Restoring agent selection: ${stored.id}`);
        set({
          currentDirectMessage: stored.id,
          currentChannel: null,
          persistedSelectionType: 'agent',
          persistedSelectionId: stored.id,
        });
        // 加载私信消息
        await get().loadDirectMessages(stored.id);
      } else {
        console.log(`ChatStore: Persisted agent ${stored.id} no longer exists, clearing selection`);
        get().clearPersistedSelection();
      }
    }
  },

  initializeWithDefaultSelection: async () => {
    const state = get();

    // 等待频道和代理数据加载完成
    if (!state.channelsLoaded || !state.agentsLoaded) {
      console.log('ChatStore: Waiting for channels and agents to load before initializing default selection');
      return;
    }

    // 如果已经有选择，不执行默认选择
    if (state.currentChannel || state.currentDirectMessage) {
      console.log('ChatStore: Already has selection, skipping default initialization');
      return;
    }

    console.log('ChatStore: Initializing with default selection');

    // 优先选择第一个频道
    if (state.channels.length > 0) {
      const firstChannel = state.channels[0].name;
      console.log(`ChatStore: Selecting first channel: #${firstChannel}`);
      get().selectChannel(firstChannel);
      await get().loadChannelMessages(firstChannel);
    }
    // 如果没有频道，选择第一个代理
    else if (state.agents.length > 0) {
      const firstAgent = state.agents[0].agent_id;
      console.log(`ChatStore: No channels available, selecting first agent: ${firstAgent}`);
      get().selectDirectMessage(firstAgent);
      await get().loadDirectMessages(firstAgent);
    }
    else {
      console.log('ChatStore: No channels or agents available for default selection');
    }
  },
}));

// Helper function 用于设置全局 context 引用
export const setChatStoreContext = (context: any) => {
  globalOpenAgentsContext = context;
};