/**
 * Thread Messaging View using the New Event System
 *
 * This component provides the same UI as the original ThreadMessagingView
 * and uses the new event-based services with HTTP transport.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
  useMemo,
} from "react";
import { AgentInfo, ThreadMessage } from "../../types/events";
import { useOpenAgentsService } from "@/contexts/OpenAgentsServiceContext";
import { useOpenAgentsData } from "@/hooks/useOpenAgentsData";
import { ThreadState } from "@/types/thread";
import { MessageSendResult } from "../../services/openAgentsService";
import MessageRenderer from "./MessageRenderer";
import ThreadMessageInput from "./ThreadMessageInput";
import DocumentsView from "../documents/DocumentsView";
import { ReadMessageStore } from "../../utils/readMessageStore";
import { useThemeStore } from "@/stores/themeStore";
import { useThreadStore } from "@/stores/threadStore";
import { CONNECTED_STATUS_COLOR } from "@/constants/chatConstants";

interface ThreadMessagingViewEventBasedProps {
  agentName: string;
  onThreadStateChange?: (state: ThreadState) => void;
}

export interface ThreadMessagingViewEventBasedRef {
  getState: () => ThreadState;
  selectChannel: (channel: string) => void;
  selectDirectMessage: (agentId: string) => void;
}


const ThreadMessagingViewEventBased = forwardRef<
  ThreadMessagingViewEventBasedRef,
  ThreadMessagingViewEventBasedProps
>(({ agentName, onThreadStateChange }, ref) => {
  // Use theme from store
  const { theme: currentTheme } = useThemeStore();

  // 从 threadStore 获取当前状态，而不是使用本地状态
  const { threadState } = useThreadStore();
  const currentChannel = threadState?.currentChannel || "";
  const currentDirectMessage = threadState?.currentDirectMessage || "";

  // 调试日志：监听 threadState 变化
  useEffect(() => {
    console.log(
      `📋 ThreadState changed: channel="${currentChannel}", direct="${currentDirectMessage}"`
    );
  }, [currentChannel, currentDirectMessage]);

  // Clear reply and quote states when channel or direct message changes
  useEffect(() => {
    console.log(`🧹 Clearing reply/quote states due to channel/DM change`);
    setReplyingTo(null);
    setQuotingMessage(null);
  }, [currentChannel, currentDirectMessage]);

  // 这些本地状态用于 UI 控制，不影响频道选择逻辑

  // 使用全局服务层
  const {
    connectionStatus,
    sendChannelMessage,
    sendDirectMessage,
    addReaction,
    removeReaction,
    lastError,
    clearError,
  } = useOpenAgentsService();

  // 使用组件数据层，传入当前关注的频道/私信
  const {
    channels,
    messages,
    setMessages,
    loadChannels,
    loadChannelMessages,
    loadDirectMessages,
    loadConnectedAgents,
    isLoading,
  } = useOpenAgentsData({
    autoLoadChannels: true,
    currentChannel: currentChannel || undefined,
    currentDirectTarget: currentDirectMessage || undefined,
  });
  const [sendingMessage, setSendingMessage] = useState<boolean>(false);
  const [showDocuments, setShowDocuments] = useState<boolean>(false);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [replyingTo, setReplyingTo] = useState<{
    messageId: string;
    text: string;
    author: string;
  } | null>(null);
  const [quotingMessage, setQuotingMessage] = useState<{
    messageId: string;
    text: string;
    author: string;
  } | null>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<ThreadMessage[]>([]);
  const readMessageStore = useRef(
    new ReadMessageStore(
      connectionStatus.agentId?.split("@")[1] || "localhost", // extract host from agentId
      8700, // default port
      agentName
    )
  );

  // Keep messagesRef synchronized with messages state
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Handle channel selection
  const handleChannelSelect = useCallback(
    async (channelName: string) => {
      if (channelName === currentChannel) return;

      console.log(`📂 Switching to channel #${channelName}`);

      // Clear reply and quote states when switching channels
      setReplyingTo(null);
      setQuotingMessage(null);

      // 通过 store 更新状态而不是本地状态
      if (onThreadStateChange) {
        onThreadStateChange({
          currentChannel: channelName,
          currentDirectMessage: null,
        });
      }

      setShowDocuments(false);

      // Load messages for the selected channel
      try {
        await loadChannelMessages(channelName);
        readMessageStore.current?.markChannelAsRead(
          channelName,
          messages.map((m) => m.message_id)
        );
      } catch (error) {
        console.error(`Failed to load messages for #${channelName}:`, error);
      }
    },
    [currentChannel, loadChannelMessages, messages, onThreadStateChange]
  );

  // Load connected agents
  const loadAgents = useCallback(async () => {
    try {
      const agentList = await loadConnectedAgents();
      const currentUserId = connectionStatus.agentId || agentName;

      // 过滤掉当前用户，避免用户在 DM 列表中看到自己
      const filteredAgentList = agentList.filter(
        (agent) => agent.agent_id !== currentUserId
      );

      console.log(`👥 Loaded ${agentList.length} connected agents, filtered to ${filteredAgentList.length} (excluded current user: ${currentUserId})`);
      setAgents(filteredAgentList);
    } catch (error) {
      console.error("Failed to load connected agents:", error);
    }
  }, [loadConnectedAgents, connectionStatus.agentId, agentName]);

  // Load initial data function
  const loadInitialData = useCallback(async () => {
    try {
      // Load channels first
      const channelList = await loadChannels();
      console.log(`📋 Loaded ${channelList.length} channels`);

      // Load connected agents
      const agentList = await loadConnectedAgents();
      const currentUserId = connectionStatus.agentId || agentName;

      // 过滤掉当前用户，避免用户在 DM 列表中看到自己
      const filteredAgentList = agentList.filter(
        (agent) => agent.agent_id !== currentUserId
      );

      console.log(`👥 Loaded ${agentList.length} connected agents, filtered to ${filteredAgentList.length} (excluded current user: ${currentUserId})`);
      setAgents(filteredAgentList);

      // 智能频道选择逻辑
      if (channelList.length > 0 && onThreadStateChange) {
        console.log(`🔍 Channel selection logic:`, {
          currentChannel,
          currentDirectMessage,
          availableChannels: channelList.map((c) => c.name),
          availableAgents: filteredAgentList.map((a) => a.agent_id),
          threadStateFromStore: threadState,
        });

        let selectedChannel = null;
        let selectionReason = "";

        if (currentChannel) {
          // 检查当前选择的频道是否仍然存在
          const channelExists = channelList.some(
            (channel) => channel.name === currentChannel
          );
          console.log(
            `🔍 Current channel "${currentChannel}" exists: ${channelExists}`
          );

          if (channelExists) {
            selectedChannel = currentChannel;
            selectionReason = "恢复上次选择";
          } else {
            selectedChannel = channelList[0].name;
            selectionReason = "上次频道不存在，回退到首个频道";
            console.warn(
              `⚠️ Previously selected channel "${currentChannel}" no longer exists, falling back to first channel`
            );
          }
        } else if (currentDirectMessage) {
          // 检查当前选择的直接消息对象是否仍然在连接的代理列表中
          const agentExists = filteredAgentList.some(
            (agent) => agent.agent_id === currentDirectMessage
          );
          console.log(
            `🔍 Current DM agent "${currentDirectMessage}" exists: ${agentExists}`
          );

          if (!agentExists) {
            // 如果直接消息的代理不再可用，回退到第一个频道
            selectedChannel = channelList[0].name;
            selectionReason = "直接消息代理不可用，回退到首个频道";
            console.warn(
              `⚠️ DM agent "${currentDirectMessage}" is no longer available, falling back to first channel`
            );
          }
          // 如果代理存在，不设置selectedChannel，保持当前直接消息状态
        } else {
          // 没有任何选择，选择第一个频道
          selectedChannel = channelList[0].name;
          selectionReason = "首次选择第一个频道";
          console.log(
            `🎯 No current selection, choosing first channel: ${selectedChannel}`
          );
        }

        if (selectedChannel && selectedChannel !== currentChannel) {
          console.log(`🎯 ${selectionReason}: ${selectedChannel}`);
          // Clear reply and quote states when automatically switching channels
          setReplyingTo(null);
          setQuotingMessage(null);
          onThreadStateChange({
            currentChannel: selectedChannel,
            currentDirectMessage: null,
          });
        } else if (selectedChannel === currentChannel) {
          console.log(`✅ 保持当前频道选择: ${selectedChannel}`);
        } else if (currentDirectMessage && filteredAgentList.some(agent => agent.agent_id === currentDirectMessage)) {
          console.log(`✅ 保持当前直接消息选择: ${currentDirectMessage}`);
        }
      }
    } catch (error) {
      console.error("Failed to load initial data:", error);
    }
  }, [
    loadChannels,
    loadConnectedAgents,
    currentChannel,
    currentDirectMessage,
    onThreadStateChange,
    threadState,
    connectionStatus.agentId,
    agentName,
  ]);

  // Load initial data when connected
  useEffect(() => {
    if (connectionStatus.status === "connected" && channels.length === 0) {
      console.log("🔧 Loading initial data...");
      loadInitialData();
    }
  }, [connectionStatus.status, channels.length, loadInitialData]);

  // Periodic refresh of agents list
  useEffect(() => {
    if (connectionStatus.status === "connected") {
      // Refresh agents list every 30 seconds
      const interval = setInterval(() => {
        console.log("🔄 Refreshing agents list...");
        loadAgents();
      }, 30000);

      return () => clearInterval(interval);
    }
  }, [connectionStatus.status, loadAgents]);

  // 当 threadStore 状态恢复后，加载对应的消息
  useEffect(() => {
    if (connectionStatus.status === "connected" && channels.length > 0) {
      if (currentChannel) {
        console.log(
          `🔄 Loading messages for restored channel: ${currentChannel}`
        );
        loadChannelMessages(currentChannel);
      } else if (currentDirectMessage) {
        console.log(
          `🔄 Loading messages for restored direct message: ${currentDirectMessage}`
        );
        loadDirectMessages(currentDirectMessage);
      }
    }
  }, [
    connectionStatus.status,
    channels.length,
    currentChannel,
    currentDirectMessage,
    loadChannelMessages,
    loadDirectMessages,
  ]);

  // Handle direct message selection
  const handleDirectMessageSelect = useCallback(
    async (agentId: string) => {
      if (agentId === currentDirectMessage) return;

      console.log(`📨 Switching to DM with ${agentId}`);

      // Clear reply and quote states when switching to direct messages
      setReplyingTo(null);
      setQuotingMessage(null);

      // 通过 store 更新状态而不是本地状态
      if (onThreadStateChange) {
        onThreadStateChange({
          currentChannel: null,
          currentDirectMessage: agentId,
        });
      }

      setShowDocuments(false);

      // Load direct messages
      try {
        await loadDirectMessages(agentId);
        readMessageStore.current?.markDirectMessageAsRead(
          agentId,
          messages.map((m) => m.message_id)
        );
      } catch (error) {
        console.error(`Failed to load DMs with ${agentId}:`, error);
      }
    },
    [currentDirectMessage, loadDirectMessages, messages, onThreadStateChange]
  );

  // Handle sending messages
  const handleSendMessage = useCallback(
    async (
      content: string,
      replyToId?: string,
      quotedMessageId?: string,
      quotedText?: string
    ) => {
      if (!content.trim() || sendingMessage) return;

      console.log("🔧 HandleSendMessage called:", {
        content,
        replyToId,
        currentChannel,
        currentDirectMessage,
      });
      setSendingMessage(true);

      // Create optimistic message
      const optimisticMessage: ThreadMessage = {
        message_id: `temp_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 11)}`,
        sender_id: connectionStatus.agentId || agentName,
        timestamp: Date.now().toString(),
        content: { text: content },
        message_type: replyToId
          ? "reply_message"
          : currentChannel
          ? "channel_message"
          : "direct_message",
        channel: currentChannel || undefined,
        target_agent_id: currentDirectMessage || undefined,
        reply_to_id: replyToId,
        quoted_message_id: quotedMessageId,
        quoted_text: quotedText,
        thread_level: replyToId ? 2 : 1,
        reactions: {},
      };

      // Add optimistic message to UI immediately
      console.log("🔧 Adding optimistic message:", optimisticMessage);
      const currentMessages = messagesRef.current || [];
      console.log("🔧 Previous messages count:", currentMessages.length);
      const newMessages = [...currentMessages, optimisticMessage];
      console.log("🔧 New messages count:", newMessages.length);
      console.log("🔧 Setting messages with optimistic update");
      setMessages(newMessages);

      // Force a re-render by updating a dummy state if needed
      console.log("🔧 Messages state should update now");

      try {
        let result: MessageSendResult;
        if (currentChannel) {
          result = await sendChannelMessage(currentChannel, content, replyToId);
        } else if (currentDirectMessage) {
          result = await sendDirectMessage(currentDirectMessage, content);
        } else {
          console.error("No channel or direct message selected");
          // Remove optimistic message on error
          const filteredMessages = (messagesRef.current || []).filter(
            (msg: ThreadMessage) =>
              msg.message_id !== optimisticMessage.message_id
          );
          setMessages(filteredMessages);
          return;
        }

        if (result.success) {
          console.log("✅ Message sent successfully", result);

          // If the server returns a real message ID, update the optimistic message
          if (result.messageId) {
            const updatedMessages = (messagesRef.current || []).map(
              (msg: ThreadMessage) =>
                msg.message_id === optimisticMessage.message_id
                  ? { ...msg, message_id: result.messageId! }
                  : msg
            );
            console.log(
              "✅ Message updatedMessages successfully",
              updatedMessages
            );
            setMessages(updatedMessages);
          }
        } else {
          console.error("❌ Failed to send message:", result.message);
          // Remove optimistic message on failure
          const filteredMessages = (messagesRef.current || []).filter(
            (msg: ThreadMessage) =>
              msg.message_id !== optimisticMessage.message_id
          );
          setMessages(filteredMessages);
        }
      } catch (error) {
        console.error("Failed to send message:", error);
        // Remove optimistic message on error
        const filteredMessages = (messagesRef.current || []).filter(
          (msg: ThreadMessage) =>
            msg.message_id !== optimisticMessage.message_id
        );
        setMessages(filteredMessages);
      } finally {
        setSendingMessage(false);
      }
    },
    [
      currentChannel,
      currentDirectMessage,
      sendingMessage,
      sendChannelMessage,
      sendDirectMessage,
      connectionStatus.agentId,
      agentName,
      setMessages,
    ]
  );

  // Handle reply and quote actions
  const startReply = useCallback(
    (messageId: string, text: string, author: string) => {
      setReplyingTo({ messageId, text, author });
      setQuotingMessage(null); // Clear quote if replying
    },
    []
  );

  const startQuote = useCallback(
    (messageId: string, text: string, author: string) => {
      setQuotingMessage({ messageId, text, author });
      setReplyingTo(null); // Clear reply if quoting
    },
    []
  );

  const cancelReply = useCallback(() => {
    setReplyingTo(null);
  }, []);

  const cancelQuote = useCallback(() => {
    setQuotingMessage(null);
  }, []);

  // Handle reactions
  const handleReaction = useCallback(
    async (
      messageId: string,
      reactionType: string,
      action: "add" | "remove" = "add"
    ) => {
      // 乐观更新：立即更新本地状态
      const currentMessages = messagesRef.current || [];
      const optimisticMessages = currentMessages.map((msg) => {
        if (msg.message_id === messageId) {
          const reactions = { ...(msg.reactions || {}) };
          const currentCount = reactions[reactionType] || 0;

          if (action === "add") {
            reactions[reactionType] = currentCount + 1;
          } else {
            reactions[reactionType] = Math.max(currentCount - 1, 0);
            // 如果计数为0，从reactions对象中删除这个属性
            if (reactions[reactionType] === 0) {
              delete reactions[reactionType];
            }
          }

          return { ...msg, reactions };
        }
        return msg;
      });

      console.log(
        `🔧 Optimistic reaction update: ${action} ${reactionType} on message ${messageId}`
      );
      setMessages(optimisticMessages);

      try {
        const result =
          action === "add"
            ? await addReaction(messageId, reactionType, currentChannel)
            : await removeReaction(messageId, reactionType, currentChannel);

        if (result.success) {
          console.log(
            `${
              action === "add" ? "➕" : "➖"
            } Reaction ${reactionType} ${action}ed to message ${messageId}`
          );
        } else {
          console.error(`Failed to ${action} reaction:`, result.message);

          // 如果服务器请求失败，回滚乐观更新
          console.log(`🔄 Rolling back optimistic reaction update`);
          setMessages(currentMessages);
        }
      } catch (error) {
        console.error(`Failed to ${action} reaction:`, error);

        // 如果请求出错，回滚乐观更新
        console.log(`🔄 Rolling back optimistic reaction update due to error`);
        setMessages(currentMessages);
      }
    },
    [addReaction, removeReaction, currentChannel, setMessages]
  );

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    getState: () => ({
      channels: channels,
      agents: agents,
      currentChannel,
      currentDirectMessage,
    }),
    selectChannel: handleChannelSelect,
    selectDirectMessage: handleDirectMessageSelect,
  }));

  // Notify parent of state changes
  useEffect(() => {
    if (onThreadStateChange) {
      onThreadStateChange({
        channels: channels,
        agents: agents,
        currentChannel,
        currentDirectMessage,
      });
    }
  }, [
    channels,
    agents,
    currentChannel,
    currentDirectMessage,
    onThreadStateChange,
  ]);

  // Get connection status color
  const getConnectionStatusColor = useMemo(() => {
    return (
      CONNECTED_STATUS_COLOR[connectionStatus.status] ||
      CONNECTED_STATUS_COLOR["default"]
    );
  }, [connectionStatus.status]);

  // Get current view title
  const getCurrentViewTitle = useMemo(() => {
    if (showDocuments) return "Documents";
    if (currentChannel) return `#${currentChannel}`;
    if (currentDirectMessage) return `@${currentDirectMessage}`;
    return "Select a channel";
  }, [showDocuments, currentChannel, currentDirectMessage]);

  return (
    <div className="thread-messaging-view h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="thread-header flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center space-x-3">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: getConnectionStatusColor }}
            title={`Connection: ${connectionStatus.status}`}
          />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {getCurrentViewTitle}
          </h2>
          {isLoading && (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
          )}
        </div>
      </div>

      {/* Error display */}
      {lastError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 text-sm dark:bg-red-900 dark:border-red-700 dark:text-red-100">
          <span>Error: {lastError}</span>
          <button
            onClick={clearError}
            className="ml-2 text-red-500 hover:text-red-700 dark:text-red-300 dark:hover:text-red-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 flex flex-col min-h-0">
        {showDocuments ? (
          <DocumentsView onBackClick={() => setShowDocuments(false)} />
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4">
              {(() => {
                // Filter messages based on current channel or direct message
                const filteredMessages = messages.filter((message) => {
                  // Debug: uncomment to debug message filtering
                  // console.log('🔧 Filtering message:', {
                  //   messageId: message.message_id,
                  //   messageType: message.message_type,
                  //   channel: message.channel,
                  //   targetAgent: message.target_agent_id,
                  //   senderId: message.sender_id,
                  //   currentChannel,
                  //   currentDirectMessage
                  // });



                  if (currentChannel) {
                    // For channel messages, match the channel
                    // Also include optimistic messages that are being sent to this channel
                    return (
                      (message.message_type === "channel_message" &&
                        message.channel === currentChannel) ||
                      (message.message_type === "reply_message" &&
                        message.channel === currentChannel)
                    );
                  } else if (currentDirectMessage) {
                    // 安全获取字段，支持多种数据格式（standardized 和 原始格式）
                    const messageType = message.message_type;
                    const targetAgentId = message.target_agent_id;
                    const senderId = message.sender_id;

                    // For direct messages, match the target agent or sender
                    // Include messages where current user is sender or receiver
                    const currentUserId = connectionStatus.agentId || agentName;
                    console.log('🔧 Filtering direct message:', {
                      messageId: message.message_id,
                      messageType,
                      targetAgentId,
                      senderId,
                      currentDirectMessage,
                      currentUserId,
                      message
                    });

                    return (
                      messageType === "direct_message" &&
                      (targetAgentId === currentDirectMessage ||
                        senderId === currentDirectMessage ||
                        (senderId === currentUserId &&
                          targetAgentId === currentDirectMessage))
                    );
                  }
                  return false;
                });

                if (filteredMessages.length === 0) {
                  return (
                    <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                      {currentChannel
                        ? `No messages in #${currentChannel} yet. Start the conversation!`
                        : currentDirectMessage
                        ? `No messages with ${currentDirectMessage} yet.`
                        : "Select a channel to start chatting."}
                    </div>
                  );
                }

                // Sort messages by timestamp (oldest first, newest last)
                const sortedMessages = filteredMessages.sort((a, b) => {
                  const parseTimestamp = (
                    timestamp: string | number
                  ): number => {
                    if (!timestamp) return 0;
                    
                    const timestampStr = String(timestamp);
                    
                    // Handle ISO string format (e.g., '2025-09-22T20:20:09.000Z')
                    if (timestampStr.includes("T") || timestampStr.includes("-")) {
                      const time = new Date(timestampStr).getTime();
                      return isNaN(time) ? 0 : time;
                    }
                    
                    // Handle Unix timestamp (seconds or milliseconds)
                    const num = parseInt(timestampStr);
                    if (isNaN(num)) return 0;
                    
                    // If timestamp appears to be in seconds (typical range: 10 digits)
                    // Convert to milliseconds. Otherwise assume it's already in milliseconds
                    if (num < 10000000000) { // Less than 10 billion = seconds
                      return num * 1000;
                    } else {
                      return num; // Already in milliseconds
                    }
                  };

                  const aTime = parseTimestamp(a.timestamp);
                  const bTime = parseTimestamp(b.timestamp);

                  return aTime - bTime;
                });

                // Render all messages together so MessageRenderer can build proper thread structure
                return (
                  <MessageRenderer
                    key="all-messages"
                    messages={sortedMessages}
                    currentUserId={connectionStatus.agentId || agentName}
                    onReaction={(messageId: string, reactionType: string, action?: "add" | "remove") => {
                      // 如果MessageRenderer没有指定action，则默认为add
                      const finalAction = action || "add";
                      console.log(`🔧 Reaction click: ${finalAction} ${reactionType} for message ${messageId}`);
                      handleReaction(messageId, reactionType, finalAction);
                    }}
                    onReply={startReply}
                    onQuote={startQuote}
                  />
                );
              })()}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            {(currentChannel || currentDirectMessage) && (
              <ThreadMessageInput
                onSendMessage={(
                  text: string,
                  replyTo?: string,
                  quotedMessageId?: string
                ) => {
                  console.log("🔧 ThreadMessageInput onSendMessage called:", {
                    text,
                    replyTo,
                    quotedMessageId,
                    replyingTo,
                    quotingMessage,
                  });

                  // Use the replyTo parameter passed from ThreadMessageInput
                  if (replyTo) {
                    // This is a reply (comment)
                    handleSendMessage(text, replyTo);
                    setReplyingTo(null);
                  } else if (quotingMessage && quotedMessageId) {
                    // This is a quote (independent message that references another)
                    handleSendMessage(
                      `> ${quotingMessage.text}\n\n${text}`,
                      undefined, // No replyToId for quotes
                      quotedMessageId,
                      quotingMessage.text
                    );
                    setQuotingMessage(null);
                  } else {
                    // Regular message
                    handleSendMessage(text);
                  }
                }}
                disabled={
                  sendingMessage || connectionStatus.status !== "connected"
                }
                placeholder={
                  sendingMessage
                    ? "Sending..."
                    : currentChannel
                    ? `Message #${currentChannel}`
                    : currentDirectMessage
                    ? `Message ${currentDirectMessage}`
                    : "Select a channel to start typing..."
                }
                currentTheme={currentTheme}
                currentChannel={currentChannel}
                currentAgentId={connectionStatus.agentId || agentName}
                replyingTo={replyingTo}
                quotingMessage={quotingMessage}
                onCancelReply={cancelReply}
                onCancelQuote={cancelQuote}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
});

ThreadMessagingViewEventBased.displayName = "ThreadMessagingViewEventBased";

export default ThreadMessagingViewEventBased;
