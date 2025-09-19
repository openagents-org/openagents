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
import { UseOpenAgentsReturn } from "../../hooks/useOpenAgents";
import { ThreadState } from "../../App";
import { MessageSendResult } from "../../services/openAgentsService";
import MessageDisplay from "./MessageDisplay";
import ThreadMessageInput from "./ThreadMessageInput";
import DocumentsView from "../documents/DocumentsView";
import { ReadMessageStore } from "../../utils/readMessageStore";
import { ConnectionStatusEnum } from "@/types/connection";
import { useThemeStore } from "@/stores/themeStore";

interface ThreadMessagingViewEventBasedProps {
  openAgentsHook: UseOpenAgentsReturn;
  agentName: string;
  onProfileClick?: () => void;
  hasSharedDocuments?: boolean;
  onDocumentsClick?: () => void;
  onThreadStateChange?: (state: ThreadState) => void;
}

export interface ThreadMessagingViewEventBasedRef {
  getState: () => ThreadState;
  selectChannel: (channel: string) => void;
  selectDirectMessage: (agentId: string) => void;
}

const CONNECTED_STATUS_COLOR = {
  [ConnectionStatusEnum.CONNECTED]: "#10b981",
  [ConnectionStatusEnum.CONNECTING]: "#f59e0b",
  [ConnectionStatusEnum.DISCONNECTED]: "#6b7280",
  [ConnectionStatusEnum.ERROR]: "#ef4444",
  default: "#6b7280",
};

const ThreadMessagingViewEventBased = forwardRef<
  ThreadMessagingViewEventBasedRef,
  ThreadMessagingViewEventBasedProps
>(
  (
    {
      openAgentsHook,
      agentName,
      onProfileClick,
      hasSharedDocuments,
      onDocumentsClick,
      onThreadStateChange,
    },
    ref
  ) => {
    // Use theme from store
    const { theme: currentTheme, toggleTheme } = useThemeStore();
    // Destructure the event system hook
    const {
      connectionStatus,
      channels,
      messages,
      setMessages,
      sendChannelMessage,
      sendDirectMessage,
      addReaction,
      removeReaction,
      loadChannels,
      loadChannelMessages,
      loadDirectMessages,
      loadConnectedAgents,
      isLoading,
      lastError,
      clearError,
    } = openAgentsHook;

    // Local state
    const [currentChannel, setCurrentChannel] = useState<string>("");
    const [currentDirectMessage, setCurrentDirectMessage] =
      useState<string>("");
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
        setCurrentChannel(channelName);
        setCurrentDirectMessage("");
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
      [currentChannel, loadChannelMessages, messages]
    );

    // Load connected agents
    const loadAgents = useCallback(async () => {
      try {
        const agentList = await loadConnectedAgents();
        console.log(`👥 Loaded ${agentList.length} connected agents`);
        setAgents(agentList);
      } catch (error) {
        console.error("Failed to load connected agents:", error);
      }
    }, [loadConnectedAgents]);

    // Load initial data function
    const loadInitialData = useCallback(async () => {
      try {
        // Load channels first
        const channelList = await loadChannels();
        console.log(`📋 Loaded ${channelList.length} channels`);

        // Load connected agents
        await loadAgents();

        // Select first channel if available
        if (channelList.length > 0 && !currentChannel) {
          handleChannelSelect(channelList[0].name);
        }
      } catch (error) {
        console.error("Failed to load initial data:", error);
      }
    }, [loadChannels, loadAgents, currentChannel, handleChannelSelect]);

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

    // Handle direct message selection
    const handleDirectMessageSelect = useCallback(
      async (agentId: string) => {
        if (agentId === currentDirectMessage) return;

        console.log(`📨 Switching to DM with ${agentId}`);
        setCurrentDirectMessage(agentId);
        setCurrentChannel("");
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
      [currentDirectMessage, loadDirectMessages, messages]
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
            .substr(2, 9)}`,
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
            result = await sendChannelMessage(
              currentChannel,
              content,
              replyToId
            );
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
            console.log("✅ Message sent successfully");

            // If the server returns a real message ID, update the optimistic message
            if (result.messageId) {
              const updatedMessages = (messagesRef.current || []).map(
                (msg: ThreadMessage) =>
                  msg.message_id === optimisticMessage.message_id
                    ? { ...msg, message_id: result.messageId! }
                    : msg
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
          }
        } catch (error) {
          console.error(`Failed to ${action} reaction:`, error);
        }
      },
      [addReaction, removeReaction, currentChannel]
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

          <div className="flex items-center space-x-2">
            {hasSharedDocuments && (
              <button
                onClick={() => setShowDocuments(!showDocuments)}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  showDocuments
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                }`}
              >
                📄 Documents
              </button>
            )}
            {onProfileClick && (
              <button
                onClick={onProfileClick}
                className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 p-1"
              >
                👤
              </button>
            )}
            {toggleTheme && (
              <button
                onClick={toggleTheme}
                className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 p-1"
              >
                {currentTheme === "light" ? "🌙" : "☀️"}
              </button>
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
                      // For direct messages, match the target agent or sender
                      // Include messages where current user is sender or receiver
                      const currentUserId =
                        connectionStatus.agentId || agentName;
                      return (
                        message.message_type === "direct_message" &&
                        (message.target_agent_id === currentDirectMessage ||
                          message.sender_id === currentDirectMessage ||
                          (message.sender_id === currentUserId &&
                            message.target_agent_id === currentDirectMessage))
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
                      timestamp = String(timestamp);
                      // Handle ISO string format
                      if (timestamp.includes("T") || timestamp.includes("-")) {
                        return new Date(timestamp).getTime();
                      }
                      // Handle Unix timestamp (seconds or milliseconds)
                      const num = parseInt(timestamp);
                      if (isNaN(num)) return 0;
                      return num < 1e10 ? num * 1000 : num;
                    };

                    const aTime = parseTimestamp(a.timestamp);
                    const bTime = parseTimestamp(b.timestamp);

                    console.log("🔧 Sorting messages:", {
                      aId: a.message_id,
                      aTimestamp: a.timestamp,
                      aTime,
                      bId: b.message_id,
                      bTimestamp: b.timestamp,
                      bTime,
                      result: aTime - bTime,
                    });

                    return aTime - bTime;
                  });

                  // Render all messages together so MessageDisplay can build proper thread structure
                  return (
                    <MessageDisplay
                      key="all-messages"
                      messages={sortedMessages}
                      currentUserId={connectionStatus.agentId || agentName}
                      onReaction={(messageId: string, reactionType: string) => {
                        handleReaction(messageId, reactionType, "add");
                      }}
                      onReply={startReply}
                      onQuote={startQuote}
                      currentTheme={currentTheme}
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
  }
);

ThreadMessagingViewEventBased.displayName = "ThreadMessagingViewEventBased";

export default ThreadMessagingViewEventBased;
