/**
 * useDirectMessages Hook - 专门处理私信逻辑
 *
 * 职责：
 * 1. 管理私信数据的加载和缓存
 * 2. 处理私信事件订阅
 * 3. 提供私信相关的操作方法
 * 4. 维护连接的agents列表
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useOpenAgentsService } from "@/contexts/OpenAgentsServiceContext";
import { UnifiedMessage, MessageAdapter } from "@/types/message";
import { AgentInfo } from "@/types/events";

interface UseDirectMessagesOptions {
  // 当前关注的私信对象
  targetUserId?: string;
  // 是否自动加载agents列表
  autoLoadAgents?: boolean;
  // 是否启用消息缓存
  enableCaching?: boolean;
  // 当前用户ID（用于过滤消息）
  currentUserId?: string;
}

interface UseDirectMessagesReturn {
  // 数据状态
  messages: UnifiedMessage[];
  agents: AgentInfo[];
  isLoading: boolean;

  // 数据管理
  setMessages: (messages: UnifiedMessage[] | ((prev: UnifiedMessage[]) => UnifiedMessage[])) => void;
  addMessage: (message: UnifiedMessage) => void;
  updateMessage: (messageId: string, updates: Partial<UnifiedMessage>) => void;

  // 数据加载
  loadDirectMessages: (targetUserId: string, limit?: number, offset?: number) => Promise<UnifiedMessage[]>;
  loadConnectedAgents: () => Promise<AgentInfo[]>;

  // 消息操作
  sendDirectMessage: (targetUserId: string, content: string) => Promise<{ success: boolean; messageId?: string; message?: string }>;

  // 状态管理
  setTargetUser: (targetUserId: string | undefined) => void;
  clearMessages: () => void;
}

export const useDirectMessages = (
  options: UseDirectMessagesOptions = {}
): UseDirectMessagesReturn => {
  const {
    targetUserId,
    autoLoadAgents = true,
    enableCaching = true,
    currentUserId,
  } = options;

  const {
    service,
    isConnected,
    sendDirectMessage: serviceSendDirectMessage,
    loadDirectMessages: serviceLoadDirectMessages,
    loadConnectedAgents: serviceLoadConnectedAgents,
  } = useOpenAgentsService();

  // 本地状态
  const [messages, setMessages] = useState<UnifiedMessage[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [isLoading, setLoading] = useState<boolean>(false);
  const [currentTargetUser, setCurrentTargetUser] = useState<string | undefined>(targetUserId);

  // 消息缓存 - 按用户ID缓存消息
  const messageCache = useRef<Map<string, UnifiedMessage[]>>(new Map());

  // 事件处理器引用，避免重复订阅
  const eventHandlersRef = useRef<{
    onNewDirectMessage?: (message: UnifiedMessage) => void;
  }>({});

  // 处理新的私信消息
  const handleNewDirectMessage = useCallback(
    (rawMessage: any) => {
      try {
        // 将原始消息转换为统一格式
        const unifiedMessage = MessageAdapter.fromRawThreadMessage(rawMessage);

        console.log(`📨 New direct message received: ${unifiedMessage.id}`, unifiedMessage);

        // 检查是否是当前关注的对话
        if (currentTargetUser && currentUserId) {
          const isRelevant =
            unifiedMessage.senderId === currentTargetUser ||
            unifiedMessage.targetUserId === currentTargetUser ||
            (unifiedMessage.senderId === currentUserId && unifiedMessage.targetUserId === currentTargetUser);

          if (isRelevant) {
            console.log(`✅ Adding direct message to current conversation`);
            addMessage(unifiedMessage);

            // 更新缓存
            if (enableCaching && currentTargetUser && messageCache.current) {
              const cached = messageCache.current.get(currentTargetUser) || [];
              const exists = cached.some(msg => msg.id === unifiedMessage.id);
              if (!exists) {
                messageCache.current.set(currentTargetUser, [...cached, unifiedMessage]);
              }
            }
          } else {
            console.log(`❌ Skipping direct message - not relevant to current conversation`);
          }
        }
      } catch (error) {
        console.error('Error handling new direct message:', error);
      }
    },
    [currentTargetUser, currentUserId, enableCaching]
  );

  // 订阅私信事件
  useEffect(() => {
    if (!service) return;

    // 移除之前的事件监听器
    if (eventHandlersRef.current?.onNewDirectMessage) {
      service.off("newDirectMessage", eventHandlersRef.current.onNewDirectMessage);
    }

    // 添加新的事件监听器
    if (eventHandlersRef.current) {
      eventHandlersRef.current.onNewDirectMessage = handleNewDirectMessage;
    }
    service.on("newDirectMessage", handleNewDirectMessage);

    return () => {
      // 清理事件监听器
      if (eventHandlersRef.current?.onNewDirectMessage) {
        service.off("newDirectMessage", eventHandlersRef.current.onNewDirectMessage);
      }
    };
  }, [service, handleNewDirectMessage]);

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
      if (enableCaching && currentTargetUser && messageCache.current) {
        const cached = messageCache.current.get(currentTargetUser) || [];
        const updated = cached.map((msg) =>
          msg.id === messageId ? { ...msg, ...updates } : msg
        );
        messageCache.current.set(currentTargetUser, updated);
      }
    },
    [enableCaching, currentTargetUser]
  );

  // 加载私信消息
  const loadDirectMessages = useCallback(
    async (targetUserId: string, limit?: number, offset?: number): Promise<UnifiedMessage[]> => {
      setLoading(true);
      try {
        // 检查缓存
        if (enableCaching && !offset && messageCache.current && messageCache.current.has(targetUserId)) {
          const cached = messageCache.current.get(targetUserId)!;
          console.log(`📱 Using cached direct messages for ${targetUserId}: ${cached.length} messages`);
          setMessages(cached);
          return cached;
        }

        const rawMessages = await serviceLoadDirectMessages(targetUserId, limit, offset);
        const unifiedMessages = MessageAdapter.fromRawThreadMessages(rawMessages);

        console.log(`📱 Loaded ${unifiedMessages.length} direct messages for ${targetUserId}`);

        // 如果是初始加载，替换消息；否则合并
        if (!offset || offset === 0) {
          setMessages(unifiedMessages);

          // 更新缓存
          if (enableCaching && messageCache.current) {
            messageCache.current.set(targetUserId, unifiedMessages);
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
              messageCache.current.set(targetUserId, merged);
            }

            return merged;
          });
        }

        return unifiedMessages;
      } catch (error) {
        console.error(`Failed to load direct messages for ${targetUserId}:`, error);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [serviceLoadDirectMessages, enableCaching]
  );

  // 加载连接的agents
  const loadConnectedAgents = useCallback(async (): Promise<AgentInfo[]> => {
    try {
      const agentList = await serviceLoadConnectedAgents();

      // 过滤掉当前用户
      const filteredAgentList = currentUserId
        ? agentList.filter(agent => agent.agent_id !== currentUserId)
        : agentList;

      console.log(`👥 Loaded ${agentList.length} connected agents, filtered to ${filteredAgentList.length} (excluded current user: ${currentUserId})`);
      setAgents(filteredAgentList);
      return filteredAgentList;
    } catch (error) {
      console.error("Failed to load connected agents:", error);
      return [];
    }
  }, [serviceLoadConnectedAgents, currentUserId]);

  // 发送私信
  const sendDirectMessage = useCallback(
    async (targetUserId: string, content: string) => {
      try {
        const result = await serviceSendDirectMessage(targetUserId, content);

        if (result.success) {
          console.log(`✅ Direct message sent to ${targetUserId}`);
        } else {
          console.error(`❌ Failed to send direct message to ${targetUserId}:`, result.message);
        }

        return result;
      } catch (error) {
        console.error(`Failed to send direct message to ${targetUserId}:`, error);
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    },
    [serviceSendDirectMessage]
  );

  // 设置目标用户
  const setTargetUser = useCallback((newTargetUserId: string | undefined) => {
    if (newTargetUserId !== currentTargetUser) {
      setCurrentTargetUser(newTargetUserId);

      // 如果有缓存，立即加载
      if (enableCaching && newTargetUserId && messageCache.current && messageCache.current.has(newTargetUserId)) {
        const cached = messageCache.current.get(newTargetUserId)!;
        setMessages(cached);
      } else {
        setMessages([]);
      }
    }
  }, [currentTargetUser, enableCaching]);

  // 清除消息
  const clearMessages = useCallback(() => {
    setMessages([]);
    if (enableCaching && currentTargetUser && messageCache.current) {
      messageCache.current.delete(currentTargetUser);
    }
  }, [enableCaching, currentTargetUser]);

  // 自动加载agents
  useEffect(() => {
    if (isConnected && autoLoadAgents && agents.length === 0) {
      loadConnectedAgents();
    }
  }, [isConnected, autoLoadAgents, agents.length, loadConnectedAgents]);

  // 当目标用户改变时，加载对应的消息
  useEffect(() => {
    if (isConnected && currentTargetUser) {
      loadDirectMessages(currentTargetUser);
    }
  }, [isConnected, currentTargetUser, loadDirectMessages]);

  // 定期刷新agents列表
  useEffect(() => {
    if (isConnected && autoLoadAgents) {
      const interval = setInterval(() => {
        console.log("🔄 Refreshing agents list...");
        loadConnectedAgents();
      }, 30000); // 30秒刷新一次

      return () => clearInterval(interval);
    }
  }, [isConnected, autoLoadAgents, loadConnectedAgents]);

  return {
    // 数据状态
    messages,
    agents,
    isLoading,

    // 数据管理
    setMessages,
    addMessage,
    updateMessage,

    // 数据加载
    loadDirectMessages,
    loadConnectedAgents,

    // 消息操作
    sendDirectMessage,

    // 状态管理
    setTargetUser,
    clearMessages,
  };
};