/**
 * Unified message renderer - combines features of MessageDisplay and UnifiedMessageRenderer
 *
 * Features：
 * 1. Support multiple message types (UnifiedMessage and ThreadMessage)
 * 2. Support reactions, replies, quote operations
 * 3. Support attachment display
 * 4. Support thread structure display
 * 5. Support multiple rendering modes
 */

import React, { useState, useRef } from "react"
import { MessageAction, MessageEmbed, UnifiedMessage } from "@/types/message"
import { ThreadMessage } from "@/types/events"
import {
  formatRelativeTimestamp,
  isMessageAuthor,
  getThreadStyleClass,
  getMessageBackgroundClass,
  buildMessageTree,
  shouldShowThreadCollapseButton,
  getValidReactions,
  MessageTreeNode,
} from "@/utils/messageDisplayUtils"
import {
  REACTION_PICKER_EMOJIS,
  MESSAGE_DISPLAY_STYLES,
  getReactionEmoji,
} from "@/constants/chatConstants"
import MarkdownContent from "./MarkdownContent"
import { Button } from "@/components/layout/ui/button"
import AttachmentDisplay from "./AttachmentDisplay"

// Supported message types
type SupportedMessage = UnifiedMessage | ThreadMessage

interface MessageRendererProps {
  messages: SupportedMessage[]
  currentUserId: string
  // Reply callback (optional) - if not provided, reply button is not shown
  onReply?: (messageId: string, text: string, author: string) => void
  onQuote: (messageId: string, text: string, author: string) => void
  onReaction: (
    messageId: string,
    reactionType: string,
    action?: "add" | "remove"
  ) => void
  // Render mode: flat or threaded
  renderMode?: "flat" | "threaded"
  // Maximum thread depth
  maxThreadDepth?: number
  // Whether it's a direct message chat (DM)
  isDMChat?: boolean
  // Whether to disable reaction features (for project channel)
  disableReactions?: boolean
  // Whether to disable quote features (for project channel)
  disableQuotes?: boolean
  onMessageAction?: (
    message: UnifiedMessage,
    action: MessageAction,
    values: Record<string, any>
  ) => void | Promise<void>
  // Network connection details for attachment downloads
  networkHost?: string
  networkPort?: number
  agentSecret?: string | null
}

const MessageRenderer: React.FC<MessageRendererProps> = ({
  messages = [],
  currentUserId,
  onReply,
  onQuote,
  onReaction,
  renderMode = "threaded",
  maxThreadDepth = 4,
  isDMChat = false,
  disableReactions = false,
  disableQuotes = false,
  onMessageAction,
  networkHost,
  networkPort,
  agentSecret,
}) => {
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(
    null
  )
  const [hoveredMessage, setHoveredMessage] = useState<string | null>(null)
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(
    new Set()
  )
  const [pendingAction, setPendingAction] = useState<{
    message: UnifiedMessage
    action: MessageAction
  } | null>(null)
  const [actionInputValues, setActionInputValues] = useState<Record<string, any>>(
    {}
  )
  const [actionInputError, setActionInputError] = useState<string | null>(null)
  const [submittingActionKey, setSubmittingActionKey] = useState<string | null>(
    null
  )
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Remove auto-scroll logic from MessageRenderer - MessagingView handles this
  // This prevents duplicate scroll effects that conflict with each other

  // Message type detection and property extraction
  const getMessageProps = (message: SupportedMessage) => {
    // Detect if it's ThreadMessage type
    if ("message_id" in message) {
      const threadMsg = message as ThreadMessage
      // Extract files from content.files
      const attachments = threadMsg.content?.files?.map((f: any) => ({
        fileId: f.file_id,
        filename: f.filename,
        size: f.size,
        fileType: f.file_type,
        storageType: f.storage_type,
      }))
      return {
        id: threadMsg.message_id,
        senderId: threadMsg.sender_id,
        timestamp: threadMsg.timestamp,
        content: threadMsg.content?.text || "",
        embeds: threadMsg.content?.embeds || [],
        actions: threadMsg.content?.actions || [],
        replyToId: threadMsg.reply_to_id,
        reactions: threadMsg.reactions,
        attachments,
      }
    } else {
      // UnifiedMessage type
      const unifiedMsg = message as UnifiedMessage
      return {
        id: unifiedMsg.id,
        senderId: unifiedMsg.senderId,
        timestamp: unifiedMsg.timestamp,
        content: unifiedMsg.content,
        embeds: unifiedMsg.embeds || [],
        actions: unifiedMsg.actions || [],
        replyToId: unifiedMsg.replyToId,
        reactions: unifiedMsg.reactions,
        attachments: unifiedMsg.attachments,
      }
    }
  }

  // Format username
  const formatUsername = (senderId: string): string => {
    if (!senderId || typeof senderId !== "string") {
      return "Unknown"
    }

    // If contains @, take part before @
    if (senderId.includes("@")) {
      const namePart = senderId.split("@")[0]
      if (namePart.includes("_")) {
        return namePart
          .split("_")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ")
      }
      return namePart
    }

    // If contains underscore, format for display
    if (senderId.includes("_")) {
      return senderId
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    }

    // Otherwise just capitalize first letter
    return senderId.charAt(0).toUpperCase() + senderId.slice(1)
  }

  const handleReaction = (
    messageId: string,
    reactionType: string,
    messageReactions: any,
    event?: React.MouseEvent,
    action?: "add" | "remove"
  ) => {
    if (event) {
      event.preventDefault()
      event.stopPropagation()
    }

    // Check if user has already added this reaction, if so return directly
    // if (checkIfUserReacted(messageReactions, reactionType, currentUserId)) {
    //   console.log(`🚫 User ${currentUserId} already reacted with ${reactionType} to message ${messageId}`);
    //   setShowReactionPicker(null);
    //   return; // Prevent duplicate addition
    // }

    console.log(
      `✅ Adding reaction ${reactionType} for user ${currentUserId} to message ${messageId}`
    )
    onReaction(messageId, reactionType, action)
    setShowReactionPicker(null)
  }

  // Simple emoji picker toggle
  const handleReactionPickerToggle = (
    messageId: string,
    event?: React.MouseEvent
  ) => {
    if (event) {
      event.preventDefault()
      event.stopPropagation()
    }
    setShowReactionPicker(showReactionPicker === messageId ? null : messageId)
  }

  const toggleThread = (messageId: string) => {
    const newCollapsed = new Set(collapsedThreads)
    if (newCollapsed.has(messageId)) {
      newCollapsed.delete(messageId)
    } else {
      newCollapsed.add(messageId)
    }
    setCollapsedThreads(newCollapsed)
  }

  const handleMessageAction = async (
    message: UnifiedMessage,
    action: MessageAction
  ) => {
    if (action.type === "link" && action.href) {
      window.open(action.href, "_blank", "noopener,noreferrer")
      return
    }
    if (action.requires && action.requires.length > 0) {
      const initialValues = action.requires.reduce<Record<string, any>>(
        (values, requirement) => {
          values[requirement.name] = requirement.type === "boolean" ? false : ""
          return values
        },
        {}
      )
      setActionInputValues(initialValues)
      setActionInputError(null)
      setPendingAction({ message, action })
      return
    }
    if (onMessageAction) {
      const actionKey = `${message.id}:${action.id}`
      setSubmittingActionKey(actionKey)
      try {
        await onMessageAction(message, action, {})
      } finally {
        setSubmittingActionKey(null)
      }
    }
  }

  const updateActionInputValue = (name: string, value: any) => {
    setActionInputValues((current) => ({
      ...current,
      [name]: value,
    }))
    setActionInputError(null)
  }

  const submitPendingAction = async () => {
    if (!pendingAction || !onMessageAction) return

    for (const requirement of pendingAction.action.requires || []) {
      const value = actionInputValues[requirement.name]
      const isEmpty =
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "")
      if (requirement.required && isEmpty) {
        setActionInputError(`${requirement.label || requirement.name} is required.`)
        return
      }
    }

    const actionKey = `${pendingAction.message.id}:${pendingAction.action.id}`
    setSubmittingActionKey(actionKey)
    try {
      await onMessageAction(
        pendingAction.message,
        pendingAction.action,
        actionInputValues
      )
      setPendingAction(null)
      setActionInputValues({})
      setActionInputError(null)
    } finally {
      setSubmittingActionKey(null)
    }
  }

  const renderActionRequirementInput = (
    requirement: NonNullable<MessageAction["requires"]>[number]
  ) => {
    const value = actionInputValues[requirement.name]
    const label = requirement.label || requirement.name
    const id = `message-action-${pendingAction?.action.id}-${requirement.name}`

    if (requirement.type === "textarea") {
      return (
        <textarea
          id={id}
          value={value || ""}
          onChange={(event) =>
            updateActionInputValue(requirement.name, event.target.value)
          }
          className="min-h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
      )
    }

    if (requirement.type === "boolean") {
      return (
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) =>
            updateActionInputValue(requirement.name, event.target.checked)
          }
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
        />
      )
    }

    if (requirement.type === "select") {
      return (
        <select
          id={id}
          value={value || ""}
          onChange={(event) =>
            updateActionInputValue(requirement.name, event.target.value)
          }
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        >
          <option value="">Select {label}</option>
          {(requirement.options || []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )
    }

    return (
      <input
        id={id}
        type={requirement.type === "number" ? "number" : "text"}
        value={value || ""}
        onChange={(event) =>
          updateActionInputValue(
            requirement.name,
            requirement.type === "number"
              ? event.target.valueAsNumber
              : event.target.value
          )
        }
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
      />
    )
  }

  const renderActionInputDialog = () => {
    if (!pendingAction) return null

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {pendingAction.action.label}
          </div>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Provide the required details before submitting this action.
          </div>
          <div className="mt-4 space-y-3">
            {(pendingAction.action.requires || []).map((requirement) => (
              <div key={requirement.name} className="space-y-1.5">
                <label
                  htmlFor={`message-action-${pendingAction.action.id}-${requirement.name}`}
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  {requirement.label || requirement.name}
                  {requirement.required && (
                    <span className="ml-1 text-red-500">*</span>
                  )}
                </label>
                {renderActionRequirementInput(requirement)}
              </div>
            ))}
          </div>
          {actionInputError && (
            <div className="mt-3 text-sm text-red-600 dark:text-red-400">
              {actionInputError}
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setPendingAction(null)
                setActionInputValues({})
                setActionInputError(null)
              }}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={submitPendingAction}>
              {submittingActionKey ===
              `${pendingAction.message.id}:${pendingAction.action.id}`
                ? "Submitting..."
                : "Submit"}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const renderMessageEmbeds = (embeds?: MessageEmbed[]) => {
    if (!embeds || embeds.length === 0) return null
    return (
      <div className="mt-3 space-y-2">
        {embeds.map((embed, index) => (
          <div
            key={embed.id || `${embed.type}-${index}`}
            className="rounded-lg border border-slate-200 bg-white/70 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/50"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-slate-900 dark:text-slate-100">
                {embed.title || embed.type}
              </div>
              <div className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                {embed.type}
              </div>
            </div>
            {embed.body && (
              <div className="mt-2 text-slate-700 dark:text-slate-300">
                <MarkdownContent content={embed.body} />
              </div>
            )}
            {embed.fields && embed.fields.length > 0 && (
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                {embed.fields.map((field, fieldIndex) => (
                  <div key={`${field.label}-${fieldIndex}`}>
                    <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {field.label}
                    </dt>
                    <dd className="text-sm text-slate-800 dark:text-slate-200">
                      {field.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ))}
      </div>
    )
  }

  const renderMessageActions = (message: UnifiedMessage, actions?: MessageAction[]) => {
    const renderableActions = actions?.filter(
      (action) => (action.type === "link" && action.href) || onMessageAction
    )
    if (!renderableActions || renderableActions.length === 0) return null
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {renderableActions.map((action) => {
          const isDanger = action.style === "danger"
          const isPrimary = action.style === "primary"
          const actionKey = `${message.id}:${action.id}`
          const isSubmitting = submittingActionKey === actionKey
          return (
            <Button
              key={action.id}
              type="button"
              variant={isDanger ? "destructive" : isPrimary ? "primary" : "outline"}
              size="sm"
              disabled={Boolean(submittingActionKey)}
              onClick={() => handleMessageAction(message, action)}
            >
              {isSubmitting ? "Submitting..." : action.label}
            </Button>
          )
        })}
      </div>
    )
  }

  // For compatibility with old ThreadMessage format, need to build thread structure
  const buildThreadStructureForThreadMessages = (
    threadMessages: ThreadMessage[]
  ) => {
    const structure: {
      [messageId: string]: {
        message: ThreadMessage
        children: string[]
        level: number
      }
    } = {}
    const rootMessages: string[] = []

    // First pass: organize messages and identify root messages
    threadMessages.forEach((message) => {
      structure[message.message_id] = {
        message,
        children: [],
        level: message.thread_level || 0,
      }

      if (!message.reply_to_id) {
        rootMessages.push(message.message_id)
      }
    })

    // Track orphaned replies
    const orphanedReplies: string[] = []

    // Second pass: establish parent-child relationships
    threadMessages.forEach((message) => {
      if (message.reply_to_id) {
        if (structure[message.reply_to_id]) {
          structure[message.reply_to_id].children.push(message.message_id)
        } else {
          orphanedReplies.push(message.message_id)
        }
      }
    })

    // Display orphaned replies as root messages
    rootMessages.push(...orphanedReplies)

    return { structure, rootMessageIds: rootMessages }
  }

  // Render single message (ThreadMessage format)
  const renderThreadMessage = (
    messageId: string,
    structure: {
      [messageId: string]: {
        message: ThreadMessage
        children: string[]
        level: number
      }
    },
    level = 0,
    messageIndex?: number
  ): React.ReactNode => {
    const item = structure[messageId]
    if (!item) return null

    const message = item.message
    const messageProps = getMessageProps(message)
    const isOwnMessage = messageProps.senderId === currentUserId
    const isCollapsed = collapsedThreads.has(messageId)
    const hasChildren = item.children.length > 0

    return (
      <div key={messageId} className="mb-1 relative">
        <div
          className={`relative rounded-xl px-4 py-3 transition-all duration-150 border ${getMessageBackgroundClass(
            isOwnMessage
          )}`}
          onMouseEnter={() => setHoveredMessage(messageId)}
          onMouseLeave={() => setHoveredMessage(null)}
        >
          {/* Message header */}
          <div className="flex items-center gap-2 mb-2 text-sm">
            <span className="font-semibold text-slate-800 dark:text-white">
              {isOwnMessage ? "You" : formatUsername(messageProps.senderId)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {formatRelativeTimestamp(messageProps.timestamp)}
            </span>
            {level > 0 && (
              <div className="absolute -left-2 top-1/2 transform -translate-y-1/2 w-1 h-5 bg-blue-500 rounded-sm" />
            )}
          </div>

          {/* Message content */}
          <div className="message-content leading-6 break-words text-gray-900 dark:text-white">
            {messageProps.content ? (
              <MarkdownContent content={messageProps.content} />
            ) : (
              <div className="text-gray-500 italic">Empty message</div>
            )}

            {/* Attachment display */}
            {messageProps.attachments &&
              messageProps.attachments.length > 0 && (
                <AttachmentDisplay
                  attachments={messageProps.attachments}
                  networkHost={networkHost}
                  networkPort={networkPort}
                  agentId={currentUserId}
                  agentSecret={agentSecret}
                />
              )}
            {renderMessageEmbeds(messageProps.embeds)}
            {renderMessageActions(
              {
                id: messageProps.id,
                senderId: messageProps.senderId,
                timestamp: messageProps.timestamp,
                content: messageProps.content,
                embeds: messageProps.embeds,
                actions: messageProps.actions,
                replyToId: messageProps.replyToId,
                reactions: messageProps.reactions,
                attachments: messageProps.attachments,
              } as UnifiedMessage,
              messageProps.actions
            )}
          </div>

          {/* Reaction display */}
          {messageProps.reactions &&
            Object.keys(getValidReactions(messageProps.reactions)).length >
              0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {Object.entries(getValidReactions(messageProps.reactions)).map(
                  ([type, count]) => (
                    <div
                      key={type}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs cursor-pointer transition-all duration-150 border bg-slate-100 border-slate-200 hover:bg-slate-200 hover:border-slate-300 dark:bg-slate-600 dark:border-slate-500 dark:text-gray-200 dark:hover:bg-slate-500 dark:hover:border-slate-400"
                      onClick={(event) =>
                        handleReaction(
                          messageId,
                          type,
                          messageProps.reactions,
                          event,
                          "add"
                        )
                      }
                    >
                      <span>{getReactionEmoji(type)}</span>
                      <span>{count}</span>
                    </div>
                  )
                )}
              </div>
            )}

          {/* Floating action buttons */}
          <div
            className={`absolute -top-2 right-4 flex gap-1 px-1 py-1 rounded-lg border z-10 transition-all duration-200 bg-white border-slate-200 shadow-lg shadow-black/10 dark:bg-slate-700 dark:border-slate-600 dark:shadow-black/30 ${
              hoveredMessage === messageId
                ? "opacity-100 visible"
                : "opacity-0 invisible"
            }`}
          >
            {/* Reply button - not shown in DM chat */}
            {!isDMChat && onReply && (
              <Button
                variant="ghost"
                size="sm"
                className="w-8 h-8 text-slate-500 hover:bg-slate-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-slate-200"
                onClick={() =>
                  onReply(
                    messageId,
                    messageProps.content,
                    messageProps.senderId
                  )
                }
                title="Reply"
              >
                ↩️
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="w-8 h-8 text-slate-500 hover:bg-slate-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-slate-200"
              onClick={(event) => handleReactionPickerToggle(messageId, event)}
              title="Add reaction"
            >
              😊
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-8 h-8 text-slate-500 hover:bg-slate-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-slate-200"
              onClick={() =>
                onQuote(messageId, messageProps.content, messageProps.senderId)
              }
              title="Quote message"
            >
              💬
            </Button>
          </div>

          {/* Reaction picker */}
          {showReactionPicker === messageId && (
            <div
              className="absolute bottom-full left-0 flex gap-1 p-2 rounded-lg border z-10 shadow-lg bg-white border-slate-200 shadow-black/10 dark:bg-gray-800 dark:border-gray-700 dark:shadow-black/30"
              style={{
                transform:
                  level === 0 && messageIndex === 0
                    ? "translateY(50px)"
                    : "none",
              }}
            >
              {REACTION_PICKER_EMOJIS.map(({ type, emoji }) => (
                <div
                  key={type}
                  className="p-1 rounded cursor-pointer transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={(event) =>
                    handleReaction(
                      messageId,
                      type,
                      messageProps.reactions,
                      event,
                      "add"
                    )
                  }
                >
                  {emoji}
                </div>
              ))}
            </div>
          )}

          {/* Thread control button */}
          {hasChildren && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs px-1 py-0.5 h-auto mt-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-600"
              onClick={() => toggleThread(messageId)}
            >
              {isCollapsed
                ? `▶ Show ${item.children.length} replies`
                : `▼ Hide replies`}
            </Button>
          )}

          {hasChildren && !isCollapsed && (
            <div className="text-xs mt-1 italic text-slate-500 dark:text-slate-400">
              {item.children.length}{" "}
              {item.children.length === 1 ? "reply" : "replies"}
            </div>
          )}
        </div>

        {/* Render child messages */}
        {hasChildren && !isCollapsed && level < maxThreadDepth && (
          <div
            className={`border-l-2 mt-2 pl-4 border-slate-200 dark:border-slate-600 ${getThreadStyleClass(
              level
            )}`}
          >
            {item.children.map((childId) =>
              renderThreadMessage(childId, structure, level + 1, undefined)
            )}
          </div>
        )}
      </div>
    )
  }

  // Render single message (UnifiedMessage format)
  const renderUnifiedMessage = (
    message: UnifiedMessage,
    level = 0,
    children?: MessageTreeNode[],
    messageIndex?: number
  ): React.ReactNode => {
    const isOwnMessage = isMessageAuthor(message, currentUserId)
    const isCollapsed = collapsedThreads.has(message.id)
    const hasChildren = children && children.length > 0

    return (
      <div key={message.id} className="mb-1 relative">
        <div
          className={`relative rounded-xl px-4 py-3 transition-all duration-150 border ${getMessageBackgroundClass(
            isOwnMessage
          )}`}
          onMouseEnter={() => setHoveredMessage(message.id)}
          onMouseLeave={() => setHoveredMessage(null)}
        >
          {/* Message header */}
          <div className="flex items-center gap-2 mb-2 text-sm">
            <span className="font-semibold text-slate-800 dark:text-white">
              {isOwnMessage ? "You" : formatUsername(message.senderId)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {formatRelativeTimestamp(message.timestamp)}
            </span>
            {level > 0 && (
              <div className="absolute -left-2 top-1/2 transform -translate-y-1/2 w-1 h-5 bg-blue-500 rounded-sm" />
            )}
          </div>

          {/* Message content */}
          <div className="message-content leading-6 break-words text-gray-900 dark:text-white">
            {message.content ? (
              <MarkdownContent content={message.content} />
            ) : (
              <div className="text-gray-500 italic">Empty message</div>
            )}

            {/* Attachment display */}
            {message.attachments && message.attachments.length > 0 && (
              <AttachmentDisplay
                attachments={message.attachments}
                networkHost={networkHost}
                networkPort={networkPort}
                agentId={currentUserId}
                agentSecret={agentSecret}
              />
            )}
            {renderMessageEmbeds(message.embeds)}
            {renderMessageActions(message, message.actions)}
          </div>

          {/* Reaction display */}
          {message.reactions &&
            Object.keys(getValidReactions(message.reactions)).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {Object.entries(getValidReactions(message.reactions)).map(
                  ([type, count]) => (
                    <div
                      key={type}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs cursor-pointer transition-all duration-150 border bg-slate-100 border-slate-200 hover:bg-slate-200 hover:border-slate-300 dark:bg-slate-600 dark:border-slate-500 dark:text-gray-200 dark:hover:bg-slate-500 dark:hover:border-slate-400"
                      onClick={(event) =>
                        handleReaction(
                          message.id,
                          type,
                          message.reactions,
                          event,
                          "add"
                        )
                      }
                    >
                      <span>{getReactionEmoji(type)}</span>
                      <span>{count}</span>
                    </div>
                  )
                )}
              </div>
            )}

          {/* Floating action buttons */}
          <div
            className={`absolute -top-2 right-4 flex gap-1 px-1 py-1 rounded-lg border z-10 transition-all duration-200 bg-white border-slate-200 shadow-lg shadow-black/10 dark:bg-slate-700 dark:border-slate-600 dark:shadow-black/30 ${
              hoveredMessage === message.id
                ? "opacity-100 visible"
                : "opacity-0 invisible"
            }`}
          >
            {/* Reply button - not shown in DM chat */}
            {!isDMChat && onReply && (
              <Button
                variant="ghost"
                size="sm"
                className="w-8 h-8 text-slate-500 hover:bg-slate-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-slate-200"
                onClick={() =>
                  onReply(message.id, message.content, message.senderId)
                }
                title="Reply"
              >
                ↩️
              </Button>
            )}
            {/* Reaction button - disabled in project channel */}
            {!disableReactions && (
              <Button
                variant="ghost"
                size="sm"
                className="w-8 h-8 text-slate-500 hover:bg-slate-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-slate-200"
                onClick={(event) =>
                  handleReactionPickerToggle(message.id, event)
                }
                title="Add reaction"
              >
                😊
              </Button>
            )}
            {/* Quote button - disabled in project channel */}
            {!disableQuotes && (
              <Button
                variant="ghost"
                size="sm"
                className="w-8 h-8 text-slate-500 hover:bg-slate-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-slate-200"
                onClick={() =>
                  onQuote(message.id, message.content, message.senderId)
                }
                title="Quote message"
              >
                💬
              </Button>
            )}
          </div>

          {/* Reaction picker */}
          {showReactionPicker === message.id && (
            <div
              className="absolute bottom-full left-0 flex gap-1 p-2 rounded-lg border z-10 shadow-lg bg-white border-slate-200 shadow-black/10 dark:bg-gray-800 dark:border-gray-700 dark:shadow-black/30"
              style={{
                transform:
                  level === 0 && messageIndex === 0
                    ? "translateY(50px)"
                    : "none",
              }}
            >
              {REACTION_PICKER_EMOJIS.map(({ type, emoji }) => (
                <div
                  key={type}
                  className="p-1 rounded cursor-pointer transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={(event) =>
                    handleReaction(
                      message.id,
                      type,
                      message.reactions,
                      event,
                      "add"
                    )
                  }
                >
                  {emoji}
                </div>
              ))}
            </div>
          )}

          {/* Thread control button */}
          {hasChildren &&
            shouldShowThreadCollapseButton({
              message,
              children: children || [],
              level,
            }) && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs px-1 py-0.5 h-auto mt-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-600"
                onClick={() => toggleThread(message.id)}
              >
                {isCollapsed
                  ? `▶ Show ${children?.length} replies`
                  : `▼ Hide replies`}
              </Button>
            )}

          {hasChildren && !isCollapsed && (
            <div className="text-xs mt-1 italic text-slate-500 dark:text-slate-400">
              {children?.length} {children?.length === 1 ? "reply" : "replies"}
            </div>
          )}
        </div>

        {/* Render child messages */}
        {hasChildren && !isCollapsed && level < maxThreadDepth && (
          <div
            className={`border-l-2 mt-2 pl-4 border-slate-200 dark:border-slate-600 ${getThreadStyleClass(
              level
            )}`}
          >
            {children?.map((child) =>
              renderUnifiedMessage(
                child.message,
                level + 1,
                child.children,
                undefined
              )
            )}
          </div>
        )}
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4 scroll-smooth bg-white dark:bg-zinc-950">
        <style>{MESSAGE_DISPLAY_STYLES}</style>
        <div className="flex items-center justify-center h-48 text-center text-base text-slate-500 dark:text-slate-400">
          <div>
            <div>No messages yet</div>
            <div className="text-sm mt-2">Start a conversation!</div>
          </div>
        </div>
      </div>
    )
  }

  // Detect message type and render accordingly
  const isThreadMessageFormat =
    messages.length > 0 && "message_id" in messages[0]

  if (isThreadMessageFormat) {
    // ThreadMessage format
    const threadMessages = messages as ThreadMessage[]
    const { structure, rootMessageIds } =
      buildThreadStructureForThreadMessages(threadMessages)

    return (
      <div className="flex-1 overflow-y-auto p-4 scroll-smooth bg-white dark:bg-zinc-950">
        <style>{MESSAGE_DISPLAY_STYLES}</style>
        {rootMessageIds.map((messageId, index) =>
          renderThreadMessage(messageId, structure, 0, index)
        )}
        {renderActionInputDialog()}
        <div ref={messagesEndRef} />
      </div>
    )
  } else {
    // UnifiedMessage format
    const unifiedMessages = messages as UnifiedMessage[]

    if (renderMode === "flat") {
      // Flat mode: simply display all messages in chronological order
      return (
        <div className="flex-1 overflow-y-auto p-4 scroll-smooth bg-white dark:bg-zinc-950">
          <style>{MESSAGE_DISPLAY_STYLES}</style>
          {unifiedMessages.map((message, index) =>
            renderUnifiedMessage(message, 0, undefined, index)
          )}
          {renderActionInputDialog()}
          <div ref={messagesEndRef} />
        </div>
      )
    } else {
      // Threaded mode: build and display thread structure
      const messageTree = buildMessageTree(unifiedMessages)

      return (
        <div className="flex-1 overflow-y-auto p-4 scroll-smooth bg-white dark:bg-zinc-950">
          <style>{MESSAGE_DISPLAY_STYLES}</style>
          {messageTree.map((node, index) =>
            renderUnifiedMessage(node.message, 0, node.children, index)
          )}
          {renderActionInputDialog()}
          <div ref={messagesEndRef} />
        </div>
      )
    }
  }
}

export default MessageRenderer
