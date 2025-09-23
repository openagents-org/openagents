/**
 * useChannelMessages Hook - 专门处理频道消息逻辑
 *
 * 职责：
 * 1. 管理频道消息数据的加载和缓存
 * 2. 处理频道消息事件订阅
 * 3. 提供频道相关的操作方法
 * 4. 维护频道列表
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useOpenAgentsService } from "@/contexts/OpenAgentsServiceContext";
import { UnifiedMessage, MessageAdapter } from "@/types/message";
import { ThreadChannel } from "@/types/events";

interface UseChannelMessagesOptions {
  // 当前关注的频道
  currentChannel?: string;
  // 是否自动加载频道列表
  autoLoadChannels?: boolean;
  // 是否启用消息缓存
  enableCaching?: boolean;
  // 当前用户ID（用于过滤消息）
  currentUserId?: string;
}

interface UseChannelMessagesReturn {
  // 数据状态
  messages: UnifiedMessage[];
  channels: ThreadChannel[];
  isLoading: boolean;

  // 数据管理
  setMessages: (messages: UnifiedMessage[] | ((prev: UnifiedMessage[]) => UnifiedMessage[])) => void;
  addMessage: (message: UnifiedMessage) => void;
  updateMessage: (messageId: string, updates: Partial<UnifiedMessage>) => void;

  // 数据加载
  loadChannelMessages: (channel: string, limit?: number, offset?: number) => Promise<UnifiedMessage[]>;
  loadChannels: () => Promise<ThreadChannel[]>;

  // 消息操作
  sendChannelMessage: (channel: string, content: string, replyToId?: string) => Promise<{ success: boolean; messageId?: string; message?: string }>;

  // 状态管理
  setCurrentChannel: (channel: string | undefined) => void;
  clearMessages: () => void;
}

export const useChannelMessages = (
  options: UseChannelMessagesOptions = {}
): UseChannelMessagesReturn => {
  const {
    currentChannel,
    autoLoadChannels = true,
    enableCaching = true,
    currentUserId,
  } = options;

  const {
    service,
    isConnected,
    sendChannelMessage: serviceSendChannelMessage,
    loadChannelMessages: serviceLoadChannelMessages,
    loadChannels: serviceLoadChannels,
  } = useOpenAgentsService();

  // 本地状态
  const [messages, setMessages] = useState<UnifiedMessage[]>([]);
  const [channels, setChannels] = useState<ThreadChannel[]>([]);
  const [isLoading, setLoading] = useState<boolean>(false);
  const [currentChannelState, setCurrentChannelState] = useState<string | undefined>(currentChannel);

  // 消息缓存 - 按频道名缓存消息
  const messageCache = useRef<Map<string, UnifiedMessage[]>>(new Map());

  // 事件处理器引用，避免重复订阅
  const eventHandlersRef = useRef<{
    onNewChannelMessage?: (message: UnifiedMessage) => void;
    onNewReaction?: (reaction: any) => void;
  }>({});

  // 处理新的频道消息
  const handleNewChannelMessage = useCallback(
    (rawMessage: any) => {
      try {
        // 将原始消息转换为统一格式
        const unifiedMessage = MessageAdapter.fromRawThreadMessage(rawMessage);

        console.log(`📨 New channel message received: ${unifiedMessage.id}, channel: ${unifiedMessage.channel}`);

        // 检查是否是当前关注的频道消息
        if (currentChannelState && unifiedMessage.channel === currentChannelState) {
          console.log(`✅ Adding channel message to current channel: ${currentChannelState}`);
          addMessage(unifiedMessage);

          // 更新缓存
          if (enableCaching && messageCache.current) {
            const cached = messageCache.current.get(currentChannelState) || [];
            const exists = cached.some(msg => msg.id === unifiedMessage.id);
            if (!exists) {
              messageCache.current.set(currentChannelState, [...cached, unifiedMessage]);
            }
          }
        } else {
          console.log(`❌ Skipping channel message - not for current channel (current: ${currentChannelState}, message: ${unifiedMessage.channel})`);
        }
      } catch (error) {
        console.error('Error handling new channel message:', error);
      }
    },
    [currentChannelState, enableCaching]
  );

  // 处理新的反应
  const handleNewReaction = useCallback(
    (reaction: any) => {
      console.log(`📨 New reaction received: ${reaction.message_id}, type: ${reaction.reaction_type}, total: ${reaction.total_reactions}`);

      updateMessage(reaction.message_id, {
        reactions: {
          ...messages.find((msg) => msg.id === reaction.message_id)?.reactions,
          [reaction.reaction_type]: reaction.total_reactions,
        },
      });
    },
    [messages]
  );

  // 订阅频道事件
  useEffect(() => {
    if (!service) return;

    // 移除之前的事件监听器
    if (eventHandlersRef.current?.onNewChannelMessage) {
      service.off("newChannelMessage", eventHandlersRef.current.onNewChannelMessage);
    }
    if (eventHandlersRef.current?.onNewReaction) {
      service.off("newReaction", eventHandlersRef.current.onNewReaction);
    }

    // 添加新的事件监听器
    if (eventHandlersRef.current) {
      eventHandlersRef.current.onNewChannelMessage = handleNewChannelMessage;
      eventHandlersRef.current.onNewReaction = handleNewReaction;
    }

    service.on("newChannelMessage", handleNewChannelMessage);
    service.on("newReaction", handleNewReaction);

    return () => {
      // 清理事件监听器
      if (eventHandlersRef.current?.onNewChannelMessage) {
        service.off("newChannelMessage", eventHandlersRef.current.onNewChannelMessage);
      }
      if (eventHandlersRef.current?.onNewReaction) {
        service.off("newReaction", eventHandlersRef.current.onNewReaction);
      }
    };
  }, [service, handleNewChannelMessage, handleNewReaction]);

  // 添加消息（去重）
  const addMessage = useCallback((message: UnifiedMessage) => {
    setMessages((prev) => {
      const exists = prev.some(existingMsg => existingMsg.id === message.id);
      if (exists) {
        return prev;
      }
      return [...prev, message];
    });
  }, []);

  // 更新消息
  const updateMessage = useCallback(
    (messageId: string, updates: Partial<UnifiedMessage>) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, ...updates } : msg
        )
      );

      // 更新缓存
      if (enableCaching && currentChannelState && messageCache.current) {
        const cached = messageCache.current.get(currentChannelState) || [];
        const updated = cached.map((msg) =>
          msg.id === messageId ? { ...msg, ...updates } : msg
        );
        messageCache.current.set(currentChannelState, updated);
      }
    },
    [enableCaching, currentChannelState]
  );

  // 加载频道消息
  const loadChannelMessages = useCallback(
    async (channel: string, limit?: number, offset?: number): Promise<UnifiedMessage[]> => {
      setLoading(true);
      try {
        // 检查缓存
        if (enableCaching && !offset && messageCache.current && messageCache.current.has(channel)) {
          const cached = messageCache.current.get(channel)!;
          console.log(`📺 Using cached channel messages for #${channel}: ${cached.length} messages`);
          setMessages(cached);
          return cached;
        }

        const rawMessages = await serviceLoadChannelMessages(channel, limit, offset);
        const unifiedMessages = MessageAdapter.fromRawThreadMessages(rawMessages);

        console.log(`📺 Loaded ${unifiedMessages.length} channel messages for #${channel}`);

        // 如果是初始加载，替换消息；否则合并
        if (!offset || offset === 0) {
          setMessages(unifiedMessages);

          // 更新缓存
          if (enableCaching && messageCache.current) {
            messageCache.current.set(channel, unifiedMessages);
          }
        } else {
          // 合并旧消息，避免重复
          setMessages((prev) => {
            const existingIds = new Set(prev.map((msg) => msg.id));
            const newMessages = unifiedMessages.filter(
              (msg) => !existingIds.has(msg.id)
            );
            const merged = [...newMessages, ...prev];

            // 更新缓存
            if (enableCaching && messageCache.current) {
              messageCache.current.set(channel, merged);
            }

            return merged;
          });
        }

        return unifiedMessages;
      } catch (error) {
        console.error(`Failed to load channel messages for #${channel}:`, error);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [serviceLoadChannelMessages, enableCaching]
  );

  // 加载频道列表
  const loadChannels = useCallback(async (): Promise<ThreadChannel[]> => {
    setLoading(true);
    try {
      const channelList = await serviceLoadChannels();
      console.log(`📋 Loaded ${channelList.length} channels`);
      setChannels(channelList);
      return channelList;
    } catch (error) {
      console.error("Failed to load channels:", error);
      return [];
    } finally {
      setLoading(false);
    }
  }, [serviceLoadChannels]);

  // 发送频道消息
  const sendChannelMessage = useCallback(
    async (channel: string, content: string, replyToId?: string) => {
      try {
        const result = await serviceSendChannelMessage(channel, content, replyToId);

        if (result.success) {
          console.log(`✅ Channel message sent to #${channel}${replyToId ? ` (reply to ${replyToId})` : ''}`);
        } else {
          console.error(`❌ Failed to send channel message to #${channel}:`, result.message);
        }

        return result;
      } catch (error) {
        console.error(`Failed to send channel message to #${channel}:`, error);
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    },
    [serviceSendChannelMessage]
  );

  // 设置当前频道
  const setCurrentChannel = useCallback((newChannel: string | undefined) => {
    if (newChannel !== currentChannelState) {
      setCurrentChannelState(newChannel);

      // 如果有缓存，立即加载
      if (enableCaching && newChannel && messageCache.current && messageCache.current.has(newChannel)) {
        const cached = messageCache.current.get(newChannel)!;
        setMessages(cached);
      } else {
        setMessages([]);
      }
    }
  }, [currentChannelState, enableCaching]);

  // 清除消息
  const clearMessages = useCallback(() => {
    setMessages([]);
    if (enableCaching && currentChannelState && messageCache.current) {
      messageCache.current.delete(currentChannelState);
    }
  }, [enableCaching, currentChannelState]);

  // 自动加载频道列表
  useEffect(() => {
    if (isConnected && autoLoadChannels && channels.length === 0) {
      loadChannels();
    }
  }, [isConnected, autoLoadChannels, channels.length, loadChannels]);

  // 当当前频道改变时，加载对应的消息
  useEffect(() => {
    if (isConnected && currentChannelState) {
      loadChannelMessages(currentChannelState);
    }
  }, [isConnected, currentChannelState, loadChannelMessages]);

  return {
    // 数据状态
    messages,
    channels,
    isLoading,

    // 数据管理
    setMessages,
    addMessage,
    updateMessage,

    // 数据加载
    loadChannelMessages,
    loadChannels,

    // 消息操作
    sendChannelMessage,

    // 状态管理
    setCurrentChannel,
    clearMessages,
  };
};