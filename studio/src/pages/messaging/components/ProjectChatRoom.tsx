/**
 * Project Private Chat Room Component
 *
 * A dedicated chat room component for project messaging that maintains
 * the same style and functionality as the regular chat room.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useParams, useLocation, useNavigate } from "react-router-dom"
import { useOpenAgents } from "@/context/OpenAgentsProvider"
import MessageRenderer from "./MessageRenderer"
import MessageInput from "./MessageInput"
import { useThemeStore } from "@/stores/themeStore"
import { CONNECTED_STATUS_COLOR } from "@/constants/chatConstants"
import { useAuthStore } from "@/stores/authStore"
import { toast } from "sonner"
import { UnifiedMessage } from "@/types/message"
import { ProjectTemplate } from "@/utils/projectUtils"

interface ProjectChatRoomProps {
  channelName?: string
  projectId?: string
}

const ProjectChatRoom: React.FC<ProjectChatRoomProps> = ({
  channelName: propChannelName,
  projectId: propProjectId,
}) => {
  const { t } = useTranslation('project')
  const { agentName } = useAuthStore()
  const { theme: currentTheme } = useThemeStore()

  // Use the new OpenAgents context
  const { connector, connectionStatus, isConnected } = useOpenAgents()

  // Router hooks for pending project support
  const location = useLocation()
  const navigate = useNavigate()

  // Get projectId from route params (route params take priority)
  const { projectId: routeProjectId } = useParams<{ projectId: string }>()

  // Prefer route params, fallback to props
  const routeOrPropProjectId = routeProjectId || propProjectId

  // Check if this is a pending project (waiting for first message to start)
  const pendingTemplate = (location.state as any)?.pendingTemplate as
    | ProjectTemplate
    | undefined
  const isPendingProject =
    routeOrPropProjectId === "new" && pendingTemplate !== undefined

  // Actual projectId - null if pending
  const projectId = isPendingProject ? null : routeOrPropProjectId

  // If no channelName provided, generate from projectId (need to get full info from backend)
  // But to keep it independent, we first try to get info from project.get
  const [projectInfo, setProjectInfo] = useState<{
    channelName?: string
    name?: string
    goal?: string
    initiator_agent_id?: string
    created_timestamp?: number
    status?: string
    summary?: string
    completed_timestamp?: number
  } | null>(null)

  // If no channelName provided, try to get from project info
  const channelName =
    propChannelName ||
    projectInfo?.channelName ||
    (projectId ? `project-${projectId}` : null) ||
    (isPendingProject ? `pending-${pendingTemplate?.template_id}` : null)

  // Track if project is completed
  const isProjectCompleted =
    projectInfo?.status === "completed" ||
    projectInfo?.status === "stopped" ||
    projectInfo?.status === "failed"

  // Project private chat room maintains its own message list, independent of messaging service
  const [messages, setMessages] = useState<UnifiedMessage[]>([])
  const [sendingMessage, setSendingMessage] = useState<boolean>(false)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [isStartingProject, setIsStartingProject] = useState<boolean>(false)
  const [isLoadingProject, setIsLoadingProject] = useState<boolean>(false)

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const prevMessagesLength = useRef<number>(0)
  const prevScrollHeight = useRef<number>(0)

  // Reset messages and project info when route projectId changes (including "new")
  // Listen to routeProjectId, propProjectId, and location to catch all navigation scenarios
  useEffect(() => {
    // Clear messages immediately when switching projects or creating new project
    // This handles both switching between projects and clicking "new project"
    // location.key ensures we catch navigation even when pathname stays the same (e.g., selecting different template)
    
    // Set loading state for existing projects (not for pending/new projects)
    if (routeProjectId && routeProjectId !== 'new') {
      setIsLoadingProject(true)
    }
    
    setMessages([])
    setProjectInfo(null)
  }, [routeProjectId, propProjectId, location.pathname, location.key])

  // Load project info and message history from backend
  useEffect(() => {
    const loadProjectInfo = async () => {
      if (!projectId || !connector || !isConnected) return

      try {
        const agentId = connectionStatus.agentId || connector.getAgentId()
        const response = await connector.sendEvent({
          event_name: "project.get",
          source_id: agentId,
          destination_id: "mod:openagents.mods.workspace.project",
          payload: {
            project_id: projectId,
          },
        })

        if (response.success && response.data?.project) {
          const project = response.data.project
          const projectChannelName =
            project.channel_name ||
            `project-${project.template_id || "unknown"}-${projectId}`

          setProjectInfo({
            channelName: projectChannelName,
            name: project.name,
            goal: project.goal,
            initiator_agent_id: project.initiator_agent_id,
            created_timestamp: project.created_timestamp,
            status: project.status,
            summary: project.summary,
            completed_timestamp: project.completed_timestamp,
          })

          // Build messages list starting with the goal as the first message
          const allMessages: UnifiedMessage[] = []

          // Add goal as the first message
          if (project.goal) {
            const goalMessage: UnifiedMessage = {
              id: `goal-${projectId}`,
              senderId: project.initiator_agent_id || "",
              content: project.goal,
              timestamp: String(
                project.started_timestamp ||
                project.created_timestamp ||
                Date.now()
              ),
              type: "channel_message",
              channel: projectChannelName,
            }
            allMessages.push(goalMessage)
          }

          // Load message history
          if (project.messages && Array.isArray(project.messages)) {
            console.log(
              `📜 Loading ${project.messages.length} messages from project history`
            )

            const historyMessages = project.messages.map((msg: any) => {
              let messageContent = msg.content?.text || ""

              // Add attachment info to message content (if any)
              if (
                msg.attachments &&
                Array.isArray(msg.attachments) &&
                msg.attachments.length > 0
              ) {
                const attachmentNames = msg.attachments
                  .map((att: any) => att.filename || att.file_id)
                  .join(", ")
                messageContent += messageContent
                  ? ` 📎 ${attachmentNames}`
                  : `📎 ${attachmentNames}`
              }

              return {
                id: msg.message_id,
                senderId: msg.sender_id || "",
                content: messageContent,
                timestamp: String(msg.timestamp || Date.now()),
                type: "channel_message",
                channel: projectChannelName,
              } as UnifiedMessage
            })

            allMessages.push(...historyMessages)
          }

          // Add summary as the last message if project is completed
          if (
            project.summary &&
            (project.status === "completed" ||
              project.status === "stopped" ||
              project.status === "failed")
          ) {
            const summaryMessage: UnifiedMessage = {
              id: `summary-${projectId}`,
              senderId: "system",
              content: `📋 **Project ${project.status === "completed" ? "Completed" : project.status === "stopped" ? "Stopped" : "Failed"}**\n\n${project.summary}`,
              timestamp: String(project.completed_timestamp || Date.now()),
              type: "channel_message",
              channel: projectChannelName,
            }
            allMessages.push(summaryMessage)
          }

          setMessages(allMessages)
        }
      } catch (error) {
        console.error("Failed to load project info:", error)
        // Even if loading fails, use default channelName
        if (!propChannelName) {
          setProjectInfo({
            channelName: `project-${projectId}`,
          })
        }
      } finally {
        // Clear loading state after project info is loaded (or fails)
        setIsLoadingProject(false)
      }
    }

    // Load project info when projectId changes or connection is established
    if (projectId) {
      loadProjectInfo()
    } else {
      // If no projectId (e.g., pending project), clear loading state
      setIsLoadingProject(false)
    }
  }, [
    projectId,
    connector,
    isConnected,
    connectionStatus.agentId,
    propChannelName,
  ])

  // Listen for project message notifications - project private chat room receives messages through project mod events
  useEffect(() => {
    if (!isConnected || !connector) return

    const handleProjectMessage = (event: any) => {
      // Listen for project.notification.message_received events
      if (event.event_name === "project.notification.message_received") {
        const messageData = event.payload || {}
        const eventProjectId = messageData.project_id

        if (eventProjectId === projectId) {
          console.log(
            `📨 Received project message for ${projectId}:`,
            messageData
          )

          // Convert project message to UnifiedMessage format
          const messageId =
            messageData.message_id || `project-msg-${Date.now()}`
          let messageContent = messageData.content?.text || ""

          // Add attachment info to message content (if any)
          if (
            messageData.attachments &&
            Array.isArray(messageData.attachments) &&
            messageData.attachments.length > 0
          ) {
            const attachmentNames = messageData.attachments
              .map((att: any) => att.filename || att.file_id)
              .join(", ")
            messageContent += messageContent
              ? ` 📎 ${attachmentNames}`
              : `📎 ${attachmentNames}`
          }

          const unifiedMessage: UnifiedMessage = {
            id: messageId,
            senderId: messageData.sender_id || "",
            content: messageContent,
            timestamp: String(messageData.timestamp || Date.now()),
            type: "channel_message",
            channel: channelName,
          }

          // Check if there is a temporary optimistic message to replace, or if this message already exists
          setMessages((prev) => {
            // Check if message already exists (avoid duplicates)
            const messageExists = prev.some(
              (msg) => msg.id === unifiedMessage.id
            )
            if (messageExists) {
              return prev // Message already exists, don't add duplicate
            }

            // Remove temporary message (if there is a matching temporary message with same content)
            const filtered = prev.filter((msg) => {
              // If message ID is temporary and sender and content match, remove it
              if (
                msg.id.startsWith("temp-") &&
                msg.senderId === unifiedMessage.senderId &&
                msg.content === unifiedMessage.content
              ) {
                return false
              }
              return true
            })

            // Add real message
            return [...filtered, unifiedMessage]
          })
        }
      }
    }

    // Register event listener
    connector.on("rawEvent", handleProjectMessage)

    return () => {
      connector.off("rawEvent", handleProjectMessage)
    }
  }, [isConnected, connector, projectId, channelName, connectionStatus.agentId, t])

  // Smart auto-scroll: only scroll to bottom when user is already near bottom
  useEffect(() => {
    const container = messagesContainerRef.current
    const messagesEnd = messagesEndRef.current

    if (!container || !messagesEnd) return

    // Check if new messages were added
    const isNewMessage = messages.length > (prevMessagesLength.current ?? 0)
    const currentScrollHeight = container.scrollHeight
    const previousScrollHeight = prevScrollHeight.current || 0

    prevMessagesLength.current = messages.length
    prevScrollHeight.current = currentScrollHeight

    if (isNewMessage) {
      // For new messages, check if user was near bottom before new content was added
      const { scrollTop, clientHeight } = container
      const originalDistanceFromBottom =
        previousScrollHeight - scrollTop - clientHeight
      const isNearBottom = originalDistanceFromBottom < 100

      if (isNearBottom) {
        // User was already near bottom, auto-scroll to new message
        messagesEnd.scrollIntoView({ behavior: "smooth" })
      }
    } else {
      // Not new messages (e.g., initial load, channel switch), always scroll to bottom
      messagesEnd.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages])

  // Project private chat room doesn't load history messages, only shows real-time received messages
  // If history messages are needed, they can be fetched via project.get API

  // Listen for project completion notifications
  useEffect(() => {
    if (!isConnected || !connector) return

    const handleProjectCompletion = (event: any) => {
      // Listen for project.notification.completed events
      if (event.event_name === "project.notification.completed") {
        const projectData = event.payload || {}
        const eventProjectId = projectData.project_id
        const summary = projectData.summary || "Project completed"
        const completedTimestamp = projectData.completed_timestamp || Date.now()

        if (eventProjectId === projectId) {
          console.log(`🎉 Project ${projectId} completed: ${summary}`)
          toast.success(t('chat.messages.projectCompleted'), {
            description: summary,
            duration: 10000,
          })

          // Update project status
          setProjectInfo((prev) =>
            prev
              ? {
                ...prev,
                status: "completed",
                summary: summary,
                completed_timestamp: completedTimestamp,
              }
              : prev
          )

          // Add summary as the last message
          const summaryMessage: UnifiedMessage = {
            id: `summary-${projectId}`,
            senderId: "system",
            content: `📋 **Project Completed**\n\n${summary}`,
            timestamp: String(completedTimestamp),
            type: "channel_message",
            channel: channelName || "",
          }

          setMessages((prev) => {
            // Check if summary message already exists
            const summaryExists = prev.some(
              (msg) => msg.id === `summary-${projectId}`
            )
            if (summaryExists) {
              return prev
            }
            return [...prev, summaryMessage]
          })
        }
      }

      // Listen for project.notification.stopped events
      if (event.event_name === "project.notification.stopped") {
        const projectData = event.payload || {}
        const eventProjectId = projectData.project_id
        const reason = projectData.reason || "Project stopped"
        const stoppedTimestamp = projectData.stopped_timestamp || Date.now()

        if (eventProjectId === projectId) {
          console.log(`⏹️ Project ${projectId} stopped: ${reason}`)
          toast.info(t('chat.messages.projectStopped'), {
            description: reason,
            duration: 10000,
          })

          // Update project status
          setProjectInfo((prev) =>
            prev
              ? {
                ...prev,
                status: "stopped",
                summary: reason,
                completed_timestamp: stoppedTimestamp,
              }
              : prev
          )

          // Add stopped message
          const stoppedMessage: UnifiedMessage = {
            id: `summary-${projectId}`,
            senderId: "system",
            content: `⏹️ **Project Stopped**\n\n${reason}`,
            timestamp: String(stoppedTimestamp),
            type: "channel_message",
            channel: channelName || "",
          }

          setMessages((prev) => {
            const summaryExists = prev.some(
              (msg) => msg.id === `summary-${projectId}`
            )
            if (summaryExists) {
              return prev
            }
            return [...prev, stoppedMessage]
          })
        }
      }
    }

    // Register event listener
    connector.on("rawEvent", handleProjectCompletion)

    return () => {
      connector.off("rawEvent", handleProjectCompletion)
    }
  }, [isConnected, connector, projectId, channelName, t])

  // Handle sending messages
  const handleSendMessage = useCallback(
    async (
      content: string,
      attachmentData?: {
        file_id: string
        filename: string
        size: number
      }
    ) => {
      if ((!content.trim() && !attachmentData) || sendingMessage || !connector)
        return

      // Handle pending project - first message starts the project
      if (isPendingProject && pendingTemplate) {
        console.log("🚀 Starting project with first message as goal:", content)
        setIsStartingProject(true)
        setSendingMessage(true)

        try {
          const agentId = connectionStatus.agentId || connector.getAgentId()

          // Send project.start with the first message as the goal
          const startResponse = await connector.sendEvent({
            event_name: "project.start",
            source_id: agentId,
            destination_id: "mod:openagents.mods.workspace.project",
            payload: {
              template_id: pendingTemplate.template_id,
              goal: content.trim(),
              name: pendingTemplate.name,
              collaborators: [],
            },
          })

          if (!startResponse.success || !startResponse.data?.project_id) {
            throw new Error(startResponse.message || "Failed to start project")
          }

          const newProjectId = startResponse.data.project_id
          console.log("✅ Project started:", newProjectId)

          toast.success(t('chat.messages.startSuccess'))

          // Navigate to the actual project chat room
          navigate(`/project/${newProjectId}`, { replace: true })
        } catch (error: any) {
          console.error("Failed to start project:", error)
          toast.error(
            t('chat.messages.startError', { error: error.message || "Unknown error" })
          )
        } finally {
          setIsStartingProject(false)
          setSendingMessage(false)
        }
        return
      }

      console.log("📤 Sending project message:", {
        content,
        projectId,
        channelName,
        attachment: attachmentData,
      })
      setSendingMessage(true)

      try {
        const agentId = connectionStatus.agentId || connector.getAgentId()

        // Build payload
        const payload: any = {
          project_id: projectId,
          content: {
            text: content.trim() || "",
          },
        }

        // Add attachment (if any)
        if (attachmentData) {
          payload.attachments = [
            {
              file_id: attachmentData.file_id,
              filename: attachmentData.filename,
              size: attachmentData.size,
            },
          ]
        }

        // Use project.message.send to send message
        const messageResponse = await connector.sendEvent({
          event_name: "project.message.send",
          source_id: agentId,
          destination_id: "mod:openagents.mods.workspace.project",
          payload,
        })

        if (messageResponse.success) {
          console.log("✅ Project message sent", {
            projectId,
            messageId: messageResponse.data?.message_id,
          })

          // Immediately add optimistic message to list (real-time feedback)
          const agentId = connectionStatus.agentId || connector.getAgentId()
          let messageContent = content.trim()
          if (attachmentData) {
            messageContent += messageContent
              ? ` 📎 ${attachmentData.filename}`
              : `📎 ${attachmentData.filename}`
          }
          const optimisticMessage: UnifiedMessage = {
            id: `temp-${Date.now()}`,
            senderId: agentId,
            content: messageContent,
            timestamp: String(Date.now()),
            type: "channel_message",
            channel: channelName,
          }

          setMessages((prev) => [...prev, optimisticMessage])

          // Message will be automatically updated via project.notification.message_received event
        } else {
          throw new Error(
            messageResponse.message || "Failed to send project message"
          )
        }
      } catch (error: any) {
        console.error("Failed to send project message:", error)
        toast.error(
          t('chat.messages.sendError', { error: error.message || "Unknown error" })
        )
      } finally {
        setSendingMessage(false)
      }
    },
    [
      sendingMessage,
      connector,
      projectId,
      channelName,
      connectionStatus.agentId,
      isPendingProject,
      pendingTemplate,
      navigate,
      t,
    ]
  )

  // Get connection status color
  const getConnectionStatusColor = useMemo(() => {
    return (
      CONNECTED_STATUS_COLOR[connectionStatus.state] ||
      CONNECTED_STATUS_COLOR["default"]
    )
  }, [connectionStatus.state])

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

        // Handle ISO string format (e.g., '2025-09-22T20:20:09.000Z')
        if (timestampStr.includes("T") || timestampStr.includes("-")) {
          const time = new Date(timestampStr).getTime()
          return isNaN(time) ? 0 : time
        }

        // Handle Unix timestamp (seconds or milliseconds)
        const num = parseInt(timestampStr)
        if (isNaN(num)) return 0

        // If timestamp looks like seconds (typical range: 10 digits)
        // Convert to milliseconds. Otherwise assume it's already in milliseconds
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

  // If no projectId and not a pending project, show selection prompt
  if (!projectId && !isPendingProject) {
    return (
      <div className="project-chat-room h-full flex items-center justify-center bg-white dark:bg-gray-800">
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
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
            />
          </svg>
          <p className="text-lg mb-2">{t('chat.select.title')}</p>
          <p className="text-sm">
            {t('chat.select.subtitle')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="project-chat-room h-full flex flex-col bg-white dark:bg-gray-800">
      {/* Header */}
      <div className="thread-header flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 min-h-[60px]">
        <div className="flex items-center space-x-3 min-w-0 flex-1">
          <div
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: getConnectionStatusColor }}
            title={t('chat.header.connection', { status: connectionStatus.state })}
          />
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate min-w-0" title={
              isPendingProject
                ? pendingTemplate?.name || t('chat.header.pending')
                : channelName || projectId || ""
            }>
              {isPendingProject
                ? t('chat.header.newProject', { name: pendingTemplate?.name || t('chat.header.pending') })
                : channelName
                  ? `#${channelName.startsWith("#")
                    ? channelName.slice(1)
                    : channelName
                  }`
                  : t('chat.header.projectPrefix', { id: projectId?.slice(0, 8) })}
            </span>
            <span
              className={`px-2 py-1 text-xs font-medium rounded-full flex-shrink-0 whitespace-nowrap ${isPendingProject
                ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                : isProjectCompleted
                  ? projectInfo?.status === "completed"
                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                    : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                  : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                }`}
            >
              {isPendingProject
                ? t('chat.pending.status')
                : isProjectCompleted
                  ? projectInfo?.status === "completed"
                    ? `✓ ${t('chat.status.completed')}`
                    : projectInfo?.status === "stopped"
                      ? `⏹️ ${t('chat.status.stopped')}`
                      : t('chat.status.closed')
                  : t('chat.status.room')}
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
          {isLoadingProject ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
              <p className="text-sm">Loading messages...</p>
            </div>
          ) : sortedMessages.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              {isPendingProject ? (
                <>
                  <svg
                    className="w-16 h-16 mx-auto mb-4 text-yellow-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  <p className="text-lg mb-2 font-semibold">
                    {t('chat.pending.title')}
                  </p>
                  <p className="text-sm mb-4">
                    {t('chat.pending.template')} <strong>{pendingTemplate?.name}</strong>
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {t('chat.pending.instruction')}
                  </p>
                  <p className="text-xs mt-2 text-gray-400">
                    {t('chat.pending.note')}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-lg mb-2">{t('chat.welcome.title')}</p>
                  <p className="text-sm">{t('chat.welcome.subtitle')}</p>
                </>
              )}
            </div>
          ) : (
            <>
              <MessageRenderer
                messages={sortedMessages}
                currentUserId={connectionStatus.agentId || agentName || ""}
                isDMChat={false}
                disableReactions={true}
                disableQuotes={true}
                renderMode="flat"
                onQuote={() => {
                  // Quote is not supported in project chat room
                  toast.error(t('chat.messages.quoteNotSupported'))
                }}
                onReaction={() => {
                  // Reactions are not supported in project chat room
                  toast.error(
                    t('chat.messages.reactionNotSupported')
                  )
                }}
                networkHost={connector?.getHost()}
                networkPort={connector?.getPort()}
                agentSecret={connector?.getSecret()}
              />
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Message Input */}
        {isProjectCompleted ? (
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">
            <div className="text-center text-gray-500 dark:text-gray-400 py-2">
              <span className="inline-flex items-center gap-2">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
                This project has been{" "}
                {projectInfo?.status === "completed"
                  ? "completed"
                  : projectInfo?.status === "stopped"
                    ? "stopped"
                    : "closed"}
                . No further messages can be sent.
              </span>
            </div>
          </div>
        ) : (
          <MessageInput
            agents={[]}
            onSendMessage={(
              text: string,
              _replyTo?: string,
              _quotedMessageId?: string,
              attachmentData?: {
                file_id: string
                filename: string
                size: number
              }
            ) => {
              // Reply and quote are not supported in project chat room, send message directly
              handleSendMessage(text, attachmentData)
            }}
            disabled={sendingMessage || isStartingProject || !isConnected}
            placeholder={
              isStartingProject
                ? "Starting project..."
                : sendingMessage
                  ? "Sending..."
                  : isPendingProject
                    ? "Type your project goal to start the project..."
                    : `Send a message in project chat room...`
            }
            currentTheme={currentTheme}
            currentChannel={channelName}
            currentAgentId={connectionStatus.agentId || agentName || ""}
            currentAgentSecret={connector?.getSecret() || null}
            networkBaseUrl={connector?.getBaseUrl()}
            replyingTo={null}
            quotingMessage={null}
            onCancelReply={() => { }}
            onCancelQuote={() => { }}
            disableEmoji={true}
            disableMentions={true}
            disableFileUpload={isPendingProject ? true : false}
          />
        )}
      </div>
    </div>
  )
}

ProjectChatRoom.displayName = "ProjectChatRoom"

export default ProjectChatRoom
