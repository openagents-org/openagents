/**
 * Project Private Chat Room Component
 *
 * A dedicated chat room component for project messaging that maintains
 * the same style and functionality as the regular chat room.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useParams, useLocation, useNavigate } from "react-router-dom"
import { useOpenAgents } from "../../context/OpenAgentsProvider"
import MessageRenderer from "./MessageRenderer"
import MessageInput from "./MessageInput"
import { useThemeStore } from "../../stores/themeStore"
import { CONNECTED_STATUS_COLOR } from "../../constants/chatConstants"
import { useAuthStore } from "../../stores/authStore"
import { toast } from "sonner"
import { UnifiedMessage } from "../../types/message"
import { ProjectTemplate } from "../../utils/projectUtils"

interface ProjectChatRoomProps {
  channelName?: string
  projectId?: string
}

const ProjectChatRoom: React.FC<ProjectChatRoomProps> = ({
  channelName: propChannelName,
  projectId: propProjectId,
}) => {
  const { agentName } = useAuthStore()
  const { theme: currentTheme } = useThemeStore()

  // 使用新的 OpenAgents context
  const { connector, connectionStatus, isConnected } = useOpenAgents()

  // Router hooks for pending project support
  const location = useLocation()
  const navigate = useNavigate()

  // 从路由参数中获取 projectId（优先使用路由参数）
  const { projectId: routeProjectId } = useParams<{ projectId: string }>()

  // 优先使用路由参数，如果没有则使用 props
  const routeOrPropProjectId = routeProjectId || propProjectId

  // Check if this is a pending project (waiting for first message to start)
  const pendingTemplate = (location.state as any)?.pendingTemplate as
    | ProjectTemplate
    | undefined
  const isPendingProject =
    routeOrPropProjectId === "new" && pendingTemplate !== undefined

  // Actual projectId - null if pending
  const projectId = isPendingProject ? null : routeOrPropProjectId

  // 如果没有提供 channelName，根据 projectId 生成（需要从后端获取完整信息）
  // 但为了保持独立，我们先尝试从 project.get 获取信息
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

  // 如果没有提供 channelName，尝试从项目信息获取
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

  // 项目私密聊天室独立维护消息列表，不依赖messaging服务
  const [messages, setMessages] = useState<UnifiedMessage[]>([])
  const [sendingMessage, setSendingMessage] = useState<boolean>(false)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [isStartingProject, setIsStartingProject] = useState<boolean>(false)

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const prevMessagesLength = useRef<number>(0)
  const prevScrollHeight = useRef<number>(0)

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
      }
    }

    // Load project info when projectId changes or connection is established
    if (projectId) {
      loadProjectInfo()
    }
  }, [
    projectId,
    connector,
    isConnected,
    connectionStatus.agentId,
    propChannelName,
  ])

  // 监听项目消息通知 - 项目私密聊天室通过project mod的事件接收消息
  useEffect(() => {
    if (!isConnected || !connector) return

    const handleProjectMessage = (event: any) => {
      // 监听 project.notification.message_received 事件
      if (event.event_name === "project.notification.message_received") {
        const messageData = event.payload || {}
        const eventProjectId = messageData.project_id

        if (eventProjectId === projectId) {
          console.log(
            `📨 Received project message for ${projectId}:`,
            messageData
          )

          // 将项目消息转换为UnifiedMessage格式
          const messageId =
            messageData.message_id || `project-msg-${Date.now()}`
          let messageContent = messageData.content?.text || ""

          // 添加附件信息到消息内容中（如果有附件）
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

          // 检查是否有临时的乐观消息需要替换，或是否已存在该消息
          setMessages((prev) => {
            // 检查消息是否已存在（避免重复）
            const messageExists = prev.some(
              (msg) => msg.id === unifiedMessage.id
            )
            if (messageExists) {
              return prev // 消息已存在，不重复添加
            }

            // 移除临时消息（如果有相同内容的临时消息）
            const filtered = prev.filter((msg) => {
              // 如果消息ID是临时的，且发送者和内容匹配，则移除
              if (
                msg.id.startsWith("temp-") &&
                msg.senderId === unifiedMessage.senderId &&
                msg.content === unifiedMessage.content
              ) {
                return false
              }
              return true
            })

            // 添加真实消息
            return [...filtered, unifiedMessage]
          })
        }
      }
    }

    // 注册事件监听器
    connector.on("rawEvent", handleProjectMessage)

    return () => {
      connector.off("rawEvent", handleProjectMessage)
    }
  }, [isConnected, connector, projectId, channelName, connectionStatus.agentId])

  // 智能自动滚动：只有当用户已经在底部附近时才滚动到底部
  useEffect(() => {
    const container = messagesContainerRef.current
    const messagesEnd = messagesEndRef.current

    if (!container || !messagesEnd) return

    // 检查是否有新消息被添加
    const isNewMessage = messages.length > (prevMessagesLength.current ?? 0)
    const currentScrollHeight = container.scrollHeight
    const previousScrollHeight = prevScrollHeight.current || 0

    prevMessagesLength.current = messages.length
    prevScrollHeight.current = currentScrollHeight

    if (isNewMessage) {
      // 对于新消息，需要检查用户在新内容添加之前是否在底部附近
      const { scrollTop, clientHeight } = container
      const originalDistanceFromBottom =
        previousScrollHeight - scrollTop - clientHeight
      const isNearBottom = originalDistanceFromBottom < 100

      if (isNearBottom) {
        // 用户之前就在底部附近，自动滚动到新消息
        messagesEnd.scrollIntoView({ behavior: "smooth" })
      }
    } else {
      // 不是新消息（例如初始加载、频道切换），总是滚动到底部
      messagesEnd.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages])

  // 项目私密聊天室不加载历史消息，只显示实时接收的消息
  // 如果需要历史消息，可以通过project.get接口获取

  // 监听项目完成通知
  useEffect(() => {
    if (!isConnected || !connector) return

    const handleProjectCompletion = (event: any) => {
      // 监听 project.notification.completed 事件
      if (event.event_name === "project.notification.completed") {
        const projectData = event.payload || {}
        const eventProjectId = projectData.project_id
        const summary = projectData.summary || "Project completed"
        const completedTimestamp = projectData.completed_timestamp || Date.now()

        if (eventProjectId === projectId) {
          console.log(`🎉 Project ${projectId} completed: ${summary}`)
          toast.success(`Project completed`, {
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

      // 监听 project.notification.stopped 事件
      if (event.event_name === "project.notification.stopped") {
        const projectData = event.payload || {}
        const eventProjectId = projectData.project_id
        const reason = projectData.reason || "Project stopped"
        const stoppedTimestamp = projectData.stopped_timestamp || Date.now()

        if (eventProjectId === projectId) {
          console.log(`⏹️ Project ${projectId} stopped: ${reason}`)
          toast.info(`Project stopped`, {
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

    // 注册事件监听器
    connector.on("rawEvent", handleProjectCompletion)

    return () => {
      connector.off("rawEvent", handleProjectCompletion)
    }
  }, [isConnected, connector, projectId, channelName])

  // 发送消息处理
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

          toast.success("Project started successfully!")

          // Navigate to the actual project chat room
          navigate(`/project/${newProjectId}`, { replace: true })
        } catch (error: any) {
          console.error("Failed to start project:", error)
          toast.error(
            `Failed to start project: ${error.message || "Unknown error"}`
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

        // 构建 payload
        const payload: any = {
          project_id: projectId,
          content: {
            text: content.trim() || "",
          },
        }

        // 添加附件（如果有）
        if (attachmentData) {
          payload.attachments = [
            {
              file_id: attachmentData.file_id,
              filename: attachmentData.filename,
              size: attachmentData.size,
            },
          ]
        }

        // 使用 project.message.send 发送消息
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

          // 立即添加乐观消息到列表（实时反馈）
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

          // 消息会通过project.notification.message_received事件自动更新
        } else {
          throw new Error(
            messageResponse.message || "Failed to send project message"
          )
        }
      } catch (error: any) {
        console.error("Failed to send project message:", error)
        toast.error(
          `Failed to send message: ${error.message || "Unknown error"}`
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
    ]
  )

  // 获取连接状态颜色
  const getConnectionStatusColor = useMemo(() => {
    return (
      CONNECTED_STATUS_COLOR[connectionStatus.state] ||
      CONNECTED_STATUS_COLOR["default"]
    )
  }, [connectionStatus.state])

  // 清除错误的函数
  const clearError = useCallback(() => {
    setMessagesError(null)
  }, [])

  // 按时间戳排序消息
  const sortedMessages = useMemo(() => {
    return [...messages].sort((a, b) => {
      const parseTimestamp = (timestamp: string | number): number => {
        if (!timestamp) return 0

        const timestampStr = String(timestamp)

        // 处理 ISO 字符串格式 (例如 '2025-09-22T20:20:09.000Z')
        if (timestampStr.includes("T") || timestampStr.includes("-")) {
          const time = new Date(timestampStr).getTime()
          return isNaN(time) ? 0 : time
        }

        // 处理 Unix 时间戳（秒或毫秒）
        const num = parseInt(timestampStr)
        if (isNaN(num)) return 0

        // 如果时间戳看起来是秒（典型范围：10位数字）
        // 转换为毫秒。否则假设它已经是毫秒
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
      <div className="project-chat-room h-full flex items-center justify-center bg-white dark:bg-gray-900">
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
          <p className="text-lg mb-2">Select a Project</p>
          <p className="text-sm">
            Choose a project from the left sidebar to view its private chat room
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="project-chat-room h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="thread-header flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center space-x-3">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: getConnectionStatusColor }}
            title={`Connection: ${connectionStatus.state}`}
          />
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {isPendingProject
                ? `New Project: ${pendingTemplate?.name || "Pending"}`
                : channelName
                  ? `#${
                      channelName.startsWith("#")
                        ? channelName.slice(1)
                        : channelName
                    }`
                  : `Project ${projectId?.slice(0, 8)}...`}
            </span>
            <span
              className={`px-2 py-1 text-xs font-medium rounded-full ${
                isPendingProject
                  ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                  : isProjectCompleted
                    ? projectInfo?.status === "completed"
                      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                      : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                    : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
              }`}
            >
              {isPendingProject
                ? "Waiting for Goal"
                : isProjectCompleted
                  ? projectInfo?.status === "completed"
                    ? "✓ Completed"
                    : projectInfo?.status === "stopped"
                      ? "⏹️ Stopped"
                      : "Closed"
                  : "Project Chat Room"}
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
          {sortedMessages.length === 0 ? (
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
                    Ready to Start Project
                  </p>
                  <p className="text-sm mb-4">
                    Template: <strong>{pendingTemplate?.name}</strong>
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    Type your first message below to define the project goal and
                    start the project.
                  </p>
                  <p className="text-xs mt-2 text-gray-400">
                    Your message will be used as the project goal.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-lg mb-2">Welcome to Project Chat Room</p>
                  <p className="text-sm">Send your first message!</p>
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
                  toast.error("Quote is not supported in project chat room")
                }}
                onReaction={() => {
                  // Reactions are not supported in project chat room
                  toast.error(
                    "Reactions are not supported in project chat room"
                  )
                }}
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
            replyingTo={null}
            quotingMessage={null}
            onCancelReply={() => {}}
            onCancelQuote={() => {}}
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

