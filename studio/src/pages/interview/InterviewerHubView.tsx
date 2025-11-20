/**
 * Interviewer Hub View Component
 *
 * A dedicated chat room component for interview communications that maintains
 * the same style and functionality as the regular chat room.
 * Connects to a private channel "chatroom-{username}" for each candidate.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, useContext } from "react"
import { OpenAgentsContext } from "@/context/OpenAgentsProvider"
import MessageRenderer from "@/pages/messaging/components/MessageRenderer"
import MessageInput from "@/pages/messaging/components/MessageInput"
import { useThemeStore } from "@/stores/themeStore"
import { CONNECTED_STATUS_COLOR } from "@/constants/chatConstants"
import { useAuthStore } from "@/stores/authStore"
import { toast } from "sonner"
import { UnifiedMessage } from "@/types/message"

const InterviewerHubView: React.FC = () => {
  const { agentName } = useAuthStore()
  const { theme: currentTheme } = useThemeStore()
  const context = useContext(OpenAgentsContext)
  const connector = context?.connector
  const connectionStatus = context?.connectionStatus
  const isConnected = context?.isConnected

  // Construct channel name based on current username
  const channelName = useMemo(() => {
    const username = connectionStatus?.agentId || agentName || ""
    return username ? `chatroom-${username}` : null
  }, [connectionStatus?.agentId, agentName])

  // State management
  const [messages, setMessages] = useState<UnifiedMessage[]>([])
  const [sendingMessage, setSendingMessage] = useState<boolean>(false)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false)

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const prevMessagesLength = useRef<number>(0)
  const prevScrollHeight = useRef<number>(0)

  // Initialize channel and load message history
  useEffect(() => {
    const initializeChannelAndLoadHistory = async () => {
      if (!channelName || !connector || !isConnected) return

      setLoadingMessages(true)
      try {
        const agentId = connectionStatus?.agentId || connector.getAgentId()

        // First, ensure channel exists by trying to subscribe/join
        console.log(`🔗 Initializing channel: ${channelName}`)
        try {
          await connector.sendEvent({
            event_name: "thread.channel.subscribe",
            source_id: agentId,
            destination_id: "mod:openagents.mods.workspace.messaging",
            payload: {
              channel_name: channelName,
            },
          })
          console.log(`✅ Subscribed to channel: ${channelName}`)
        } catch (err) {
          console.warn(`⚠️ Channel subscribe failed (channel may already exist):`, err)
        }

        // Load message history
        const response = await connector.sendEvent({
          event_name: "thread.channel_messages.retrieve",
          source_id: agentId,
          destination_id: "mod:openagents.mods.workspace.messaging",
          payload: {
            channel_name: channelName,
            limit: 100,
          },
        })

        if (response.success && response.data?.messages) {
          console.log(`📜 Loaded ${response.data.messages.length} messages from history`)

          const historyMessages = response.data.messages.map((msg: any) => ({
            id: msg.message_id,
            senderId: msg.sender_id || "",
            content: msg.content?.text || "",
            timestamp: String(msg.timestamp || Date.now()),
            type: "channel_message",
            channel: channelName,
          } as UnifiedMessage))

          setMessages(historyMessages)
        } else {
          console.log(`📜 No message history found for ${channelName}`)
          setMessages([])
        }
      } catch (error) {
        console.error("Failed to load message history:", error)
        setMessagesError("Failed to load message history")
      } finally {
        setLoadingMessages(false)
      }
    }

    initializeChannelAndLoadHistory()
  }, [channelName, connector, isConnected, connectionStatus?.agentId])

  // Listen for incoming messages
  useEffect(() => {
    if (!isConnected || !connector || !channelName) return

    const handleChannelMessage = (event: any) => {
      // Listen for thread.channel_message.posted event
      if (event.event_name === "thread.channel_message.posted") {
        const messageData = event.payload || {}
        const eventChannelName = messageData.channel_name

        if (eventChannelName === channelName) {
          console.log(`📨 Received message for ${channelName}:`, messageData)

          const unifiedMessage: UnifiedMessage = {
            id: messageData.message_id || `msg-${Date.now()}`,
            senderId: messageData.sender_id || "",
            content: messageData.content?.text || "",
            timestamp: String(messageData.timestamp || Date.now()),
            type: "channel_message",
            channel: channelName,
          }

          setMessages((prev) => {
            // Check if message already exists
            const messageExists = prev.some((msg) => msg.id === unifiedMessage.id)
            if (messageExists) {
              return prev
            }

            // Remove temporary message if it matches
            const filtered = prev.filter((msg) => {
              if (
                msg.id.startsWith("temp-") &&
                msg.senderId === unifiedMessage.senderId &&
                msg.content === unifiedMessage.content
              ) {
                return false
              }
              return true
            })

            return [...filtered, unifiedMessage]
          })
        }
      }
    }

    connector.on("rawEvent", handleChannelMessage)

    return () => {
      connector.off("rawEvent", handleChannelMessage)
    }
  }, [isConnected, connector, channelName])

  // Auto-scroll logic
  useEffect(() => {
    const container = messagesContainerRef.current
    const messagesEnd = messagesEndRef.current

    if (!container || !messagesEnd) return

    const isNewMessage = messages.length > (prevMessagesLength.current ?? 0)
    const currentScrollHeight = container.scrollHeight
    const previousScrollHeight = prevScrollHeight.current || 0

    prevMessagesLength.current = messages.length
    prevScrollHeight.current = currentScrollHeight

    if (isNewMessage) {
      const { scrollTop, clientHeight } = container
      const originalDistanceFromBottom = previousScrollHeight - scrollTop - clientHeight
      const isNearBottom = originalDistanceFromBottom < 100

      if (isNearBottom) {
        messagesEnd.scrollIntoView({ behavior: "smooth" })
      }
    } else {
      messagesEnd.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages])

  // Send message handler
  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || sendingMessage || !connector || !channelName) return

      console.log("📤 Sending message to interviewer hub:", { content, channelName })
      setSendingMessage(true)

      try {
        const agentId = connectionStatus?.agentId || connector.getAgentId()

        const messageResponse = await connector.sendEvent({
          event_name: "thread.channel_message.post",
          source_id: agentId,
          destination_id: `channel:${channelName}`,
          payload: {
            channel: channelName,
            content: {
              text: content.trim(),
            },
            message_type: "channel_message",
          },
        })

        if (messageResponse.success) {
          console.log("✅ Message sent to interviewer hub", {
            channelName,
            messageId: messageResponse.data?.message_id,
          })

          // Add optimistic message
          const optimisticMessage: UnifiedMessage = {
            id: `temp-${Date.now()}`,
            senderId: agentId,
            content: content.trim(),
            timestamp: String(Date.now()),
            type: "channel_message",
            channel: channelName,
          }

          setMessages((prev) => [...prev, optimisticMessage])
        } else {
          throw new Error(messageResponse.message || "Failed to send message")
        }
      } catch (error: any) {
        console.error("Failed to send message:", error)
        toast.error(`Failed to send message: ${error.message || "Unknown error"}`)
      } finally {
        setSendingMessage(false)
      }
    },
    [sendingMessage, connector, channelName, connectionStatus?.agentId]
  )

  // Get connection status color
  const getConnectionStatusColor = useMemo(() => {
    return (
      CONNECTED_STATUS_COLOR[connectionStatus?.state || ""] ||
      CONNECTED_STATUS_COLOR["default"]
    )
  }, [connectionStatus?.state])

  // Clear error function
  const clearError = useCallback(() => {
    setMessagesError(null)
  }, [])

  // Sort messages by timestamp
  const sortedMessages = useMemo(() => {
    return [...messages].sort((a, b) => {
      const parseTimestamp = (timestamp: string | number): number => {
        if (!timestamp) return 0

        const timestampStr = String(timestamp)

        if (timestampStr.includes("T") || timestampStr.includes("-")) {
          const time = new Date(timestampStr).getTime()
          return isNaN(time) ? 0 : time
        }

        const num = parseInt(timestampStr)
        if (isNaN(num)) return 0

        if (num < 10000000000) {
          return num * 1000
        } else {
          return num
        }
      }

      const aTime = parseTimestamp(a.timestamp)
      const bTime = parseTimestamp(b.timestamp)

      return aTime - bTime
    })
  }, [messages])

  if (!channelName) {
    return (
      <div className="h-full flex items-center justify-center bg-white dark:bg-gray-900">
        <div className="text-center text-gray-500 dark:text-gray-400 py-8">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <p className="text-lg mb-2">Waiting for Connection</p>
          <p className="text-sm">Please connect to the network to access the interviewer hub</p>
        </div>
      </div>
    )
  }

  return (
    <div className="interviewer-hub h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="thread-header flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center space-x-3">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: getConnectionStatusColor }}
            title={`Connection: ${connectionStatus?.state || "unknown"}`}
          />
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              #{channelName}
            </span>
            <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              Interviewer Hub
            </span>
          </div>
        </div>
      </div>

      {/* Error display */}
      {messagesError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 text-sm dark:bg-red-900 dark:border-red-700 dark:text-red-100">
          <span>Error: {messagesError}</span>
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
        {/* Messages */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4">
          {loadingMessages ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              <p className="text-sm">Loading messages...</p>
            </div>
          ) : sortedMessages.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              <svg
                className="w-16 h-16 mx-auto mb-4 text-blue-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a2 2 0 01-2-2V6a2 2 0 012-2h6a2 2 0 012 2v2z"
                />
              </svg>
              <p className="text-lg mb-2 font-semibold">Welcome to Interviewer Hub</p>
              <p className="text-sm mb-4">
                This is your private communication channel with recruiters and interviewers.
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Send your first message below to start the conversation!
              </p>
            </div>
          ) : (
            <>
              <MessageRenderer
                messages={sortedMessages}
                currentUserId={connectionStatus?.agentId || agentName || ""}
                isDMChat={false}
                disableReactions={true}
                disableQuotes={true}
                renderMode="flat"
                onQuote={() => {
                  toast.error("Quote is not supported in interviewer hub")
                }}
                onReaction={() => {
                  toast.error("Reactions are not supported in interviewer hub")
                }}
              />
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Message Input */}
        <MessageInput
          agents={[]}
          onSendMessage={(text: string) => {
            handleSendMessage(text)
          }}
          disabled={sendingMessage || !isConnected}
          placeholder={
            sendingMessage ? "Sending..." : "Send a message to interviewers..."
          }
          currentTheme={currentTheme}
          currentChannel={channelName}
          currentAgentId={connectionStatus?.agentId || agentName || ""}
          replyingTo={null}
          quotingMessage={null}
          onCancelReply={() => {}}
          onCancelQuote={() => {}}
          disableEmoji={true}
          disableMentions={true}
          disableFileUpload={true}
        />
      </div>
    </div>
  )
}

InterviewerHubView.displayName = "InterviewerHubView"

export default InterviewerHubView
