/**
 * 组件数据层 Hook - useOpenAgentsData
 *
 * 职责：
 * 1. 管理组件相关的消息数据（messages, channels 等）
 * 2. 订阅全局服务的事件并过滤处理
 * 3. 提供组件级别的数据加载和管理
 * 4. 处理 loading 状态
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useOpenAgentsService } from "@/contexts/OpenAgentsServiceContext";
import { ThreadMessage, ThreadChannel, AgentInfo } from "@/types/events";

interface UseOpenAgentsDataOptions {
  // 是否自动加载 channels
  autoLoadChannels?: boolean;
  // 当前关注的 channel（用于过滤消息）
  currentChannel?: string;
  // 当前关注的 direct message 对象（用于过滤消息）
  currentDirectTarget?: string;
}

interface UseOpenAgentsDataReturn {
  // 数据状态
  channels: ThreadChannel[];
  messages: ThreadMessage[];
  connectedAgents: AgentInfo[];

  // 数据管理
  setMessages: (
    messages: ThreadMessage[] | ((prev: ThreadMessage[]) => ThreadMessage[])
  ) => void;
  addMessage: (message: ThreadMessage) => void;
  updateMessage: (messageId: string, updates: Partial<ThreadMessage>) => void;

  // 数据加载
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

  // 状态
  isLoading: boolean;
  setLoading: (loading: boolean) => void;
}

export const useOpenAgentsData = (
  options: UseOpenAgentsDataOptions = {}
): UseOpenAgentsDataReturn => {
  const {
    autoLoadChannels = false,
    currentChannel,
    currentDirectTarget,
  } = options;

  const {
    service,
    isConnected,
    loadChannels: serviceLoadChannels,
    loadChannelMessages: serviceLoadChannelMessages,
    loadDirectMessages: serviceLoadDirectMessages,
    loadConnectedAgents: serviceLoadConnectedAgents,
  } = useOpenAgentsService();

  // 本地数据状态
  const [channels, setChannels] = useState<ThreadChannel[]>([]);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [connectedAgents, setConnectedAgents] = useState<AgentInfo[]>([]);
  const [isLoading, setLoading] = useState<boolean>(false);

  // 事件处理器引用，避免重复订阅
  const eventHandlersRef = useRef<{
    onNewChannelMessage?: (message: ThreadMessage) => void;
    onNewDirectMessage?: (message: ThreadMessage) => void;
    onNewReaction?: (reaction: any) => void;
  }>({});

  // 添加消息（去重）
  const addMessage = useCallback((message: ThreadMessage) => {
    setMessages((prev) => {
      const exists = prev.some(
        (existingMsg) => existingMsg.message_id === message.message_id
      );
      if (exists) {
        return prev;
      }
      return [...prev, message];
    });
  }, []);

  // 更新消息（比如添加/移除反应）
  const updateMessage = useCallback(
    (messageId: string, updates: Partial<ThreadMessage>) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.message_id === messageId ? { ...msg, ...updates } : msg
        )
      );
    },
    []
  );

  // 处理新频道消息
  const handleNewChannelMessage = useCallback(
    (message: ThreadMessage) => {
      console.log(
        `📨 New channel message received: ${message.message_id}, channel: ${message.channel}`
      );

      // 只有当前关注的频道消息才添加到本地状态
      if (!currentChannel || message.channel === currentChannel) {
        addMessage(message);
      }
    },
    [currentChannel, addMessage]
  );

  // 处理新私信消息
  const handleNewDirectMessage = useCallback(
    (message: ThreadMessage) => {
      const currentUserId = service?.getAgentId();
      console.log(
        `📨 New direct message received: ${message.message_id}`,
        message
      );
      console.log(`🔍 Direct message filter check:`, {
        messageId: message.message_id,
        senderId: message.sender_id,
        targetAgentId: message.target_agent_id,
        currentDirectTarget,
        currentUserId,
      });
      if (
        !currentDirectTarget ||
        message.sender_id === currentDirectTarget ||
        message.target_agent_id === currentDirectTarget
      ) {
        console.log(`✅ Adding direct message to local state`);
        addMessage(message);
      } else {
        console.log(
          `❌ Skipping direct message - not relevant to current user`
        );
      }
    },
    [currentDirectTarget, addMessage, service]
  );

  // 处理新反应
  const handleNewReaction = useCallback(
    (reaction: any) => {
      console.log(
        `📨 handleNewReaction: ${reaction.message_id}, type: ${reaction.reaction_type}, total: ${reaction.total_reactions}`
      );

      updateMessage(reaction.message_id, {
        reactions: {
          ...messages.find((msg) => msg.message_id === reaction.message_id)
            ?.reactions,
          // [reaction.reaction_type]: Math.max(
          //   (messages.find((msg) => msg.message_id === reaction.message_id)
          //     ?.reactions?.[reaction.reaction_type] || 0) +
          //     (reaction.action === "add" ? 1 : -1),
          //   0
          // ),
          [reaction.reaction_type]: reaction.total_reactions,
        },
      });
    },
    [messages, updateMessage]
  );

  // 订阅事件
  useEffect(() => {
    if (!service) return;

    // 移除之前的事件监听器
    if (eventHandlersRef.current?.onNewChannelMessage) {
      service.off(
        "newChannelMessage",
        eventHandlersRef.current.onNewChannelMessage
      );
    }
    if (eventHandlersRef.current?.onNewDirectMessage) {
      service.off(
        "newDirectMessage",
        eventHandlersRef.current.onNewDirectMessage
      );
    }
    if (eventHandlersRef.current?.onNewReaction) {
      service.off("newReaction", eventHandlersRef.current.onNewReaction);
    }

    // 添加新的事件监听器
    if (eventHandlersRef.current) {
      eventHandlersRef.current.onNewChannelMessage = handleNewChannelMessage;
      eventHandlersRef.current.onNewDirectMessage = handleNewDirectMessage;
      eventHandlersRef.current.onNewReaction = handleNewReaction;
    }

    service.on("newChannelMessage", handleNewChannelMessage);
    service.on("newDirectMessage", handleNewDirectMessage);
    service.on("newReaction", handleNewReaction);

    return () => {
      // 清理事件监听器
      service.off("newChannelMessage", handleNewChannelMessage);
      service.off("newDirectMessage", handleNewDirectMessage);
      service.off("newReaction", handleNewReaction);
    };
  }, [
    service,
    handleNewChannelMessage,
    handleNewDirectMessage,
    handleNewReaction,
  ]);

  // 数据加载方法
  const loadChannels = useCallback(async (): Promise<ThreadChannel[]> => {
    setLoading(true);
    try {
      const channelList = await serviceLoadChannels();
      setChannels(channelList);
      return channelList;
    } finally {
      setLoading(false);
    }
  }, [serviceLoadChannels]);

  const loadChannelMessages = useCallback(
    async (
      channel: string,
      limit?: number,
      offset?: number
    ): Promise<ThreadMessage[]> => {
      setLoading(true);
      try {
        const messageList = await serviceLoadChannelMessages(
          channel,
          limit,
          offset
        );

        // 替换消息如果是初始加载，否则合并
        if (!offset || offset === 0) {
          setMessages(messageList);
        } else {
          // 合并旧消息，避免重复
          setMessages((prev) => {
            const existingIds = new Set(prev.map((msg) => msg.message_id));
            const newMessages = messageList.filter(
              (msg) => !existingIds.has(msg.message_id)
            );
            return [...newMessages, ...prev];
          });
        }

        return messageList;
      } finally {
        setLoading(false);
      }
    },
    [serviceLoadChannelMessages]
  );

  const loadDirectMessages = useCallback(
    async (
      targetAgentId: string,
      limit?: number,
      offset?: number
    ): Promise<ThreadMessage[]> => {
      setLoading(true);
      try {
        const messageList = await serviceLoadDirectMessages(
          targetAgentId,
          limit,
          offset
        );

        // 替换消息如果是初始加载，否则合并
        if (!offset || offset === 0) {
          setMessages(messageList);
        } else {
          // 合并旧消息，避免重复
          setMessages((prev) => {
            const existingIds = new Set(prev.map((msg) => msg.message_id));
            const newMessages = messageList.filter(
              (msg) => !existingIds.has(msg.message_id)
            );
            return [...newMessages, ...prev];
          });
        }

        return messageList;
      } finally {
        setLoading(false);
      }
    },
    [serviceLoadDirectMessages]
  );

  const loadConnectedAgents = useCallback(async (): Promise<AgentInfo[]> => {
    try {
      const agentList = await serviceLoadConnectedAgents();
      setConnectedAgents(agentList);
      return agentList;
    } catch (error) {
      console.error("Failed to load connected agents:", error);
      return [];
    }
  }, [serviceLoadConnectedAgents]);

  // 自动加载 channels
  useEffect(() => {
    if (isConnected && autoLoadChannels) {
      loadChannels();
    }
  }, [isConnected, autoLoadChannels, loadChannels]);

  return {
    // 数据状态
    channels,
    messages,
    connectedAgents,

    // 数据管理
    setMessages,
    addMessage,
    updateMessage,

    // 数据加载
    loadChannels,
    loadChannelMessages,
    loadDirectMessages,
    loadConnectedAgents,

    // 状态
    isLoading,
    setLoading,
  };
};
