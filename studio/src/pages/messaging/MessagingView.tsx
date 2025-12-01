/**
 * Messaging View using the New Event System
 *
 * This component provides the same UI as the original MessagingView
 * and uses the new event-based services with HTTP transport.
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
// useNavigate and useLocation moved to global handling, no longer needed here
import { useOpenAgents } from "@/context/OpenAgentsProvider";
import { useChatStore, setChatStoreContext } from "@/stores/chatStore";
import MessageRenderer from "./components/MessageRenderer";
import MessageInput from "./components/MessageInput";
import NotificationPermissionOverlay from "./components/NotificationPermissionOverlay";
import { useThemeStore } from "@/stores/themeStore";
import { CONNECTED_STATUS_COLOR } from "@/constants/chatConstants";
import { useAuthStore } from "@/stores/authStore";
import { toast } from "sonner";
import { isProjectChannel, extractProjectIdFromChannel } from "@/utils/projectUtils";
import ProjectChatRoom from "./components/ProjectChatRoom";

const ThreadMessagingViewEventBased: React.FC = () => {
  const { agentName } = useAuthStore();
  // Use theme from store
  const { theme: currentTheme } = useThemeStore();

  // Get current selection state and selection methods from chatStore
  const { currentChannel, currentDirectMessage, selectChannel } = useChatStore();

  // Check if current channel is project channel
  const isProjectChannelActive = useMemo(() => {
    return currentChannel ? isProjectChannel(currentChannel) : false;
  }, [currentChannel]);

  // Debug log: monitor selection state changes
  useEffect(() => {
    console.log(
      `📋 Selection changed: channel="${currentChannel || ""}", direct="${currentDirectMessage || ""}"`
    );
  }, [currentChannel, currentDirectMessage]);

  // Clear reply and quote states when channel or direct message changes
  useEffect(() => {
    console.log(`🧹 Clearing reply/quote states due to channel/DM change`);
    setReplyingTo(null);
    setQuotingMessage(null);
  }, [currentChannel, currentDirectMessage]);

  // These local states are for UI control, don't affect channel selection logic

  // Use new OpenAgents context
  const { connector, connectionStatus, isConnected } = useOpenAgents();

  // Set chatStore context reference
  useEffect(() => {
    setChatStoreContext({ connector, connectionStatus, isConnected });
  }, [connector, connectionStatus, isConnected]);

  // Use new Chat Store
  const {
    channels,
    channelsLoading,
    channelsLoaded,
    channelsError,
    agents,
    agentsLoading,
    agentsLoaded,
    agentsError,
    messagesLoading,
    messagesError,
    // Directly get message data instead of getter methods, so React can detect changes
    channelMessages,
    directMessages,
    loadChannels,
    loadChannelMessages,
    loadDirectMessages,
    loadAgents,
    sendChannelMessage,
    sendDirectMessage,
    addReaction,
    removeReaction,
    setupEventListeners,
    cleanupEventListeners,
    clearChannelsError,
    clearMessagesError,
    clearAgentsError,
  } = useChatStore();
  const [sendingMessage, setSendingMessage] = useState<boolean>(false);
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
  const [announcement, setAnnouncement] = useState<string>("");

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevMessagesLength = useRef<number>(0);
  const prevScrollHeight = useRef<number>(0);

  // Get messages for current channel or DM
  const messages = useMemo(() => {
    if (currentChannel) {
      // Get data directly from Map
      const msgs = channelMessages.get(currentChannel) || [];
      console.log(`MessagingView: Channel #${currentChannel} has ${msgs.length} messages`);
      return msgs;
    } else if (currentDirectMessage) {
      const currentAgentId = connectionStatus.agentId || agentName;
      const directMsgs = directMessages.get(currentDirectMessage) || [];

      // Filter messages belonging to current conversation
      const filteredMsgs = directMsgs.filter(message =>
        (message.type === 'direct_message') &&
        ((message.senderId === currentAgentId && message.targetUserId === currentDirectMessage) ||
          (message.senderId === currentDirectMessage && message.targetUserId === currentAgentId) ||
          (message.senderId === currentDirectMessage))  // Compatible with old format
      );
      console.log(`MessagingView: Direct messages with ${currentDirectMessage}: ${filteredMsgs.length} messages`);
      return filteredMsgs;
    }
    return [];
  }, [currentChannel, currentDirectMessage, channelMessages, directMessages, connectionStatus.agentId, agentName]);

  // Load announcements for current channel
  useEffect(() => {
    const loadAnnouncement = async () => {

      if (!currentChannel || !isConnected || !connector) {
        setAnnouncement("");
        return;
      }

      try {
        const response = await connector.getChannelAnnouncement(currentChannel);
        if (response?.success && response?.data) {
          const text = response.data.text || "";
          setAnnouncement(text);
        } else {
          setAnnouncement("");
        }
      } catch (error) {
        setAnnouncement("");
      }
    };

    loadAnnouncement();

  }, [currentChannel, isConnected, connector]);

  // Set up event listeners
  useEffect(() => {
    if (isConnected) {
      setupEventListeners();
    }
    return () => {
      cleanupEventListeners();
    };
  }, [isConnected, setupEventListeners, cleanupEventListeners]);

  // Notification click handling moved to global (OpenAgentsProvider), no need to duplicate listener here


  // Smart auto-scroll: only scroll to bottom if user is already near the bottom
  useEffect(() => {
    const container = messagesContainerRef.current;
    const messagesEnd = messagesEndRef.current;

    if (!container || !messagesEnd) return;

    // Check if this is a new message being added
    // eslint-disable-next-line
    const isNewMessage = messages.length > (prevMessagesLength.current ?? 0);
    const currentScrollHeight = container.scrollHeight;
    const previousScrollHeight = prevScrollHeight.current || 0;

    prevMessagesLength.current = messages.length;
    prevScrollHeight.current = currentScrollHeight;

    if (isNewMessage) {
      // For new messages, we need to check if user was near bottom BEFORE the new content was added
      // Calculate where user was relative to the bottom before content height changed
      const { scrollTop, clientHeight } = container;
      const originalDistanceFromBottom = previousScrollHeight - scrollTop - clientHeight;
      const isNearBottom = originalDistanceFromBottom < 100;


      if (isNearBottom) {
        // User was near bottom before new message, auto-scroll to new message
        messagesEnd.scrollIntoView({ behavior: "smooth" });
      }
      // If user was not near bottom, don't auto-scroll (let them continue reading)
    } else {
      // Not a new message (e.g., initial load, channel switch), always scroll to bottom
      messagesEnd.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);


  // Get filtered agents (excluding current user)
  const filteredAgents = useMemo(() => {
    const currentUserId = connectionStatus.agentId || agentName || "";
    return agents.filter(agent => agent.agent_id !== currentUserId);
  }, [agents, connectionStatus.agentId, agentName]);

  // Load initial data function
  const loadInitialData = useCallback(async () => {
    try {
      // Load channels and agents only if not loaded yet
      const promises = [];
      if (!channelsLoaded && !channelsLoading) {
        promises.push(loadChannels());
      }
      if (!agentsLoaded && !agentsLoading) {
        promises.push(loadAgents());
      }

      if (promises.length > 0) {
        await Promise.all(promises);
      }

      console.log(`📋 Loaded ${channels.length} channels`);
      console.log(`👥 Loaded ${filteredAgents.length} agents (excluding current user)`);

      // Smart channel selection logic
      // First check if its a project channel (independent of channels list)
      if (currentChannel && currentChannel.startsWith("project-")) {
        // Project channel is independent of other mods, doesnt need to be in channels list
        // Keep selection, ProjectChatRoom will handle display
        console.log(
          `✅ Project channel "${currentChannel}" - keeping selection (independent of channel list)`
        );
        // No action needed, keep current selection
      } else if (channels.length > 0) {
        console.log(`🔍 Channel selection logic:`, {
          currentChannel,
          currentDirectMessage,
          availableChannels: channels.map((c) => c.name),
          availableAgents: filteredAgents.map((a) => a.agent_id),
          selectionStateFromChatStore: { currentChannel, currentDirectMessage },
        });

        let selectedChannel = null;
        let selectionReason = "";

        if (currentChannel) {
          // Check if currently selected regular channel still exists
          const channelExists = channels.some(
            (channel) => channel.name === currentChannel
          );
          console.log(
            `🔍 Current channel "${currentChannel}" exists: ${channelExists}`
          );

          if (channelExists) {
            selectedChannel = currentChannel;
            selectionReason = "Restore last selection";
          } else {
            selectedChannel = channels.length > 0 ? channels[0].name : null;
            selectionReason = "Last channel doesnt exist, fallback to first channel";
            console.warn(
              `⚠️ Previously selected channel "${currentChannel}" no longer exists, falling back to first channel`
            );
          }
        } else if (currentDirectMessage) {
          // Check if currently selected DM target is still in connected agents list
          const agentExists = filteredAgents.some(
            (agent) => agent.agent_id === currentDirectMessage
          );
          console.log(
            `🔍 Current DM agent "${currentDirectMessage}" exists: ${agentExists}`
          );

          if (!agentExists) {
            // If DM agent is no longer available, fallback to first channel
            selectedChannel = channels[0].name;
            selectionReason = "DM agent unavailable, fallback to first channel";
            console.warn(
              `⚠️ DM agent "${currentDirectMessage}" is no longer available, falling back to first channel`
            );
          }
          // If agent exists, dont set selectedChannel, keep current DM state
        } else {
          // No selection, select first channel
          selectedChannel = channels[0].name;
          selectionReason = "First time selecting first channel";
          console.log(
            `🎯 No current selection, choosing first channel: ${selectedChannel}`
          );
        }

        if (selectedChannel && selectedChannel !== currentChannel) {
          console.log(`🎯 ${selectionReason}: ${selectedChannel}`);
          // Clear reply and quote states when automatically switching channels
          setReplyingTo(null);
          setQuotingMessage(null);
          selectChannel(selectedChannel);
        } else if (selectedChannel === currentChannel) {
          console.log(`✅ Keep current channel selection: ${selectedChannel}`);
        } else if (currentDirectMessage && filteredAgents.some(agent => agent.agent_id === currentDirectMessage)) {
          console.log(`✅ Keep current DM selection: ${currentDirectMessage}`);
        }
      }
    } catch (error) {
      console.error("Failed to load initial data:", error);
    }
  }, [
    loadChannels,
    loadAgents,
    channelsLoaded,
    channelsLoading,
    agentsLoaded,
    agentsLoading,
    channels,
    filteredAgents,
    currentChannel,
    currentDirectMessage,
    selectChannel,
  ]);

  // Load initial data when connected
  useEffect(() => {
    if (isConnected && (!channelsLoaded || !agentsLoaded)) {
      console.log("🔧 Loading initial data...");
      loadInitialData();
    }
  }, [isConnected, channelsLoaded, agentsLoaded, loadInitialData]);

  // Periodic refresh of agents list
  useEffect(() => {
    if (isConnected) {
      // Refresh agents list every 30 seconds
      const interval = setInterval(() => {
        console.log("🔄 Refreshing agents list...");
        loadAgents();
      }, 30000);

      return () => clearInterval(interval);
    }
  }, [isConnected, loadAgents]);

  // Listen for project completion notifications
  useEffect(() => {
    if (!isConnected || !connector) return;

    const handleProjectCompletion = (event: any) => {
      // Listen for project.notification.completed event
      if (event.event_name === "project.notification.completed") {
        const projectData = event.payload || {};
        const projectId = projectData.project_id;
        const summary = projectData.summary || "Project completed";

        if (projectId) {
          console.log(`🎉 Project ${projectId} completed: ${summary}`);
          toast.success(`Project completed`, {
            description: summary,
            duration: 10000,
          });
        }
      }
    };

    // Register event listener
    connector.on("rawEvent", handleProjectCompletion);

    return () => {
      connector.off("rawEvent", handleProjectCompletion);
    };
  }, [isConnected, connector]);

  // When chatStore selection state changes, load corresponding messages
  useEffect(() => {
    if (isConnected && channels.length > 0) {
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
    isConnected,
    channels.length,
    currentChannel,
    currentDirectMessage,
    loadChannelMessages,
    loadDirectMessages,
  ]);


  // Handle sending messages
  const handleSendMessage = useCallback(
    async (
      content: string,
      replyToId?: string,
      _quotedMessageId?: string,
      _quotedText?: string
    ) => {
      if (!content.trim() || sendingMessage) return;

      // In project channel, replies and quotes are not allowed
      if (isProjectChannelActive && (replyToId || _quotedMessageId)) {
        toast.error("Replies and quotes are not allowed in project channel");
        return;
      }

      console.log("📤 Sending message:", {
        content,
        replyToId,
        currentChannel,
        currentDirectMessage,
        isProjectChannel: isProjectChannelActive,
      });
      setSendingMessage(true);

      try {
        let success = false;
        if (currentChannel) {
          // Check if this is a project channel
          const projectId = extractProjectIdFromChannel(currentChannel);
          
          if (isProjectChannelActive && projectId && connector) {
            // Use project.message.send for project channels
            try {
              const agentId = connectionStatus.agentId || connector.getAgentId();

              // Send message using project.message.send
              const messageResponse = await connector.sendEvent({
                event_name: "project.message.send",
                source_id: agentId,
                destination_id: "mod:openagents.mods.workspace.project",
                payload: {
                  project_id: projectId,
                  content: {
                    type: "text",
                    message: content.trim(),
                  },
                  reply_to_id: replyToId,
                },
              });

              if (messageResponse.success) {
                success = true;
                console.log("✅ Project message sent", { projectId, messageId: messageResponse.data?.message_id });
              } else {
                throw new Error(messageResponse.message || "Failed to send project message");
              }
            } catch (error: any) {
              console.error("Failed to send project message:", error);
              toast.error(`Send message failed: ${error.message || "Unknown error"}`);
              success = false;
            }
          } else {
            // Use regular channel message for non-project channels
            success = await sendChannelMessage(currentChannel, content, replyToId);
          }
        } else if (currentDirectMessage) {
          success = await sendDirectMessage(currentDirectMessage, content);
        } else {
          console.error("No channel or direct message selected");
          return;
        }

        if (success) {
          console.log("✅ Message sent successfully");
          // Messages will be automatically added to store via event listener
        } else {
          console.error("❌ Failed to send message");
        }
      } catch (error) {
        console.error("Failed to send message:", error);
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
      isProjectChannelActive,
      connector,
      connectionStatus.agentId,
    ]
  );

  // Handle reply and quote actions
  const startReply = useCallback(
    (messageId: string, text: string, author: string) => {
      // Disable reply features in project channel
      if (isProjectChannelActive) {
        toast.error("Replies are not allowed in project channel");
        return;
      }
      setReplyingTo({ messageId, text, author });
      setQuotingMessage(null); // Clear quote if replying
    },
    [isProjectChannelActive]
  );

  const startQuote = useCallback(
    (messageId: string, text: string, author: string) => {
      // Disable quote features in project channel
      if (isProjectChannelActive) {
        toast.error("Quotes are not allowed in project channel");
        return;
      }
      setQuotingMessage({ messageId, text, author });
      setReplyingTo(null); // Clear reply if quoting
    },
    [isProjectChannelActive]
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
      // Disable reaction features in project channel
      if (isProjectChannelActive) {
        toast.error("Adding or removing reactions is not allowed in project channel");
        return;
      }

      try {
        const success = action === "add"
          ? await addReaction(messageId, reactionType, currentChannel || undefined)
          : await removeReaction(messageId, reactionType, currentChannel || undefined);

        if (success) {
          console.log(
            `${action === "add" ? "➕" : "➖"} Reaction ${reactionType} ${action}ed to message ${messageId}`
          );
          // Reaction updates will be automatically synced to store via event listener
        } else {
          console.error(`Failed to ${action} reaction`);
          // Show error toast
          toast.error(`Failed to ${action} reaction "${reactionType}". Please try again.`);
        }
      } catch (error) {
        console.error(`Failed to ${action} reaction:`, error);
        // Show network error toast
        toast.error(`Network error while ${action}ing reaction "${reactionType}". Please check your connection and try again.`);
      }
    },
    [addReaction, removeReaction, currentChannel, isProjectChannelActive]
  );

  // Methods are managed through chatStore state, no ref needed

  // State changes are managed by chatStore - no need to notify parent

  // Get connection status color
  const getConnectionStatusColor = useMemo(() => {
    return (
      CONNECTED_STATUS_COLOR[connectionStatus.state] ||
      CONNECTED_STATUS_COLOR["default"]
    );
  }, [connectionStatus.state]);

  // Merge all loading states
  const isLoading = channelsLoading || messagesLoading || agentsLoading;

  // Merge all error messages
  const lastError = channelsError || messagesError || agentsError;

  // Function to clear errors
  const clearError = useCallback(() => {
    clearChannelsError();
    clearMessagesError();
    clearAgentsError();
  }, [clearChannelsError, clearMessagesError, clearAgentsError]);

  // Get current view title
  const getCurrentViewTitle = useMemo(() => {
    if (currentChannel) return `#${currentChannel}`;
    if (currentDirectMessage) return `@${currentDirectMessage}`;
    return "Select a channel";
  }, [currentChannel, currentDirectMessage]);

  // Check if its a project channel, if so use ProjectChatRoom component
  const projectId = useMemo(() => {
    if (currentChannel && isProjectChannelActive) {
      return extractProjectIdFromChannel(currentChannel);
    }
    return null;
  }, [currentChannel, isProjectChannelActive]);

  // If its a project channel, render ProjectChatRoom component
  if (projectId && currentChannel) {
    return (
      <ProjectChatRoom
        channelName={currentChannel}
        projectId={projectId}
      />
    );
  }

  return (
    <div className="thread-messaging-view h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Notification Permission Overlay */}
      <NotificationPermissionOverlay />

      {/* Header */}
      <div className="thread-header flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center space-x-3">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: getConnectionStatusColor }}
            title={`Connection: ${connectionStatus.state}`}
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
        <>
          {/* Announcement Banner */}
          {announcement && (
            <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-3 shadow-md">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0 pr-3 overflow-hidden">
                  <div className="oa-marquee">
                    <div className="oa-marquee__track">
                      <span className="font-medium mr-8">{announcement}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setAnnouncement("")}
                  className="text-white hover:text-gray-200 transition-colors flex-shrink-0"
                  aria-label="Close announcement"
                >
                  ✕
                </button>
              </div>
              <style>{`
                .oa-marquee { position: relative; overflow: hidden; }
                .oa-marquee__track {
                  display: inline-block;
                  white-space: nowrap;
                  will-change: transform;
                  animation: oa-marquee 35s linear infinite;
                }
                .oa-marquee__track:hover { animation-play-state: paused; }
                @keyframes oa-marquee {
                  0% { transform: translateX(0); }
                  100% { transform: translateX(-50%); }
                }
              `}</style>
            </div>
          )}

          {/* Messages */}
          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4">
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
                  return (
                    (message.type === "channel_message" &&
                      message.channel === currentChannel) ||
                    (message.type === "reply_message" &&
                      message.channel === currentChannel)
                  );
                } else if (currentDirectMessage) {
                  // Safely get fields, support multiple data formats (standardized and raw)
                  const messageType = message.type;
                  const targetUserId = message.targetUserId;
                  const senderId = message.senderId;

                  // For direct messages, match the target agent or sender
                  // Include messages where current user is sender or receiver
                  const currentUserId = connectionStatus.agentId || agentName || "";
                  console.log('🔧 Filtering direct message:', {
                    messageId: message.id,
                    messageType,
                    targetUserId,
                    senderId,
                    currentDirectMessage,
                    currentUserId,
                    message
                  });

                  return (
                    messageType === "direct_message" &&
                    (targetUserId === currentDirectMessage ||
                      senderId === currentDirectMessage ||
                      (senderId === currentUserId &&
                        targetUserId === currentDirectMessage))
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
                  currentUserId={connectionStatus.agentId || agentName || ""}
                  onReaction={(messageId: string, reactionType: string, action?: "add" | "remove") => {
                    // If MessageRenderer doesnt specify action, default to add
                    const finalAction = action || "add";
                    console.log(`🔧 Reaction click: ${finalAction} ${reactionType} for message ${messageId}`);
                    handleReaction(messageId, reactionType, finalAction);
                  }}
                  onReply={startReply}
                  onQuote={startQuote}
                  isDMChat={!!currentDirectMessage}
                  disableReactions={isProjectChannelActive}
                  disableQuotes={isProjectChannelActive}
                />
              );
            })()}
            <div ref={messagesEndRef} />
          </div>

          {/* Message Input */}
          {(currentChannel || currentDirectMessage) && (
            <MessageInput
              agents={currentDirectMessage ? [] : filteredAgents}
              onSendMessage={(
                text: string,
                replyTo?: string,
                quotedMessageId?: string
              ) => {
                console.log("🔧 MessageInput onSendMessage called:", {
                  text,
                  replyTo,
                  quotedMessageId,
                  replyingTo,
                  quotingMessage,
                });

                // Use the replyTo parameter passed from MessageInput
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
                sendingMessage || !isConnected
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
              currentChannel={currentChannel || undefined}
              currentDirectMessage={currentDirectMessage || undefined}
              currentAgentId={connectionStatus.agentId || agentName || ""}
              replyingTo={replyingTo}
              quotingMessage={quotingMessage}
              onCancelReply={cancelReply}
              onCancelQuote={cancelQuote}
            />
          )}
        </>
      </div>
    </div>
  );
};

ThreadMessagingViewEventBased.displayName = "ThreadMessagingViewEventBased";

export default ThreadMessagingViewEventBased;
