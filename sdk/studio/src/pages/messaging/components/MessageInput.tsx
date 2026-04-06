import React, { useState, useRef, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/layout/ui/button"

interface AgentInfo {
  agent_id: string
  display_name?: string
  status?: string
}

interface MessageInputProps {
  onSendMessage: (
    text: string,
    replyTo?: string,
    quotedMessageId?: string,
    attachmentData?: {
      file_id: string
      filename: string
      size: number
    }
  ) => void
  currentTheme: "light" | "dark"
  placeholder?: string
  disabled?: boolean
  agents?: AgentInfo[]
  replyingTo?: {
    messageId: string
    text: string
    author: string
  } | null
  quotingMessage?: {
    messageId: string
    text: string
    author: string
  } | null
  onCancelReply?: () => void
  currentChannel?: string
  currentDirectMessage?: string
  currentAgentId?: string
  currentAgentSecret?: string | null
  networkBaseUrl?: string
  onCancelQuote?: () => void
  // Disable features for simple chat rooms (like project chat rooms)
  disableEmoji?: boolean
  disableMentions?: boolean
  disableFileUpload?: boolean
}

const styles = `
  .thread-input-container {
    background: #ffffff;
    border-top: 1px solid #e2e8f0;
    padding: 16px;
  }
  
  .thread-input-container.dark {
    background: var(--background);
    border-top: 1px solid #334155;
  }
  
  .reply-preview {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 12px;
    position: relative;
  }
  
  .reply-preview.dark {
    background: #0f172a;
    border-color: #334155;
  }
  
  .quote-preview {
    background: #fef3c7;
    border: 1px solid #f59e0b;
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 12px;
    position: relative;
  }
  
  .quote-preview.dark {
    background: #451a03;
    border-color: #f59e0b;
  }
  
  .reply-header, .quote-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  
  .reply-label {
    font-size: 14px;
    font-weight: 600;
    color: #3b82f6;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  
  .reply-label.dark {
    color: #60a5fa;
  }
  
  .quote-label {
    font-size: 14px;
    font-weight: 600;
    color: #f59e0b;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  
  .quote-label.dark {
    color: #fbbf24;
  }
  
  .cancel-reply, .cancel-quote {
    background: none;
    border: none;
    color: #64748b;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    font-size: 16px;
    line-height: 1;
    transition: all 0.15s ease;
  }
  
  .cancel-reply:hover {
    background: #f1f5f9;
    color: #374151;
  }
  
  .cancel-reply.dark {
    color: #94a3b8;
  }
  
  .cancel-reply.dark:hover {
    background: #334155;
    color: #e5e7eb;
  }
  
  .reply-text {
    font-size: 14px;
    color: #64748b;
    max-height: 60px;
    overflow-y: auto;
    line-height: 1.4;
  }
  
  .reply-text.dark {
    color: #94a3b8;
  }
  
  .input-area {
    margin-bottom: 6px;
    position: relative;
    font-size: 0;
  }
  
  .message-textarea {
    width: 100%;
    min-height: 44px;
    max-height: 200px;
    padding: 12px 110px 12px 16px;
    border: 1px solid #d1d5db;
    border-radius: 24px;
    resize: none;
    font-family: inherit;
    font-size: 15px;
    line-height: 1.4;
    background: #ffffff;
    color: #374151;
    transition: all 0.15s ease;
    overflow-y: hidden;
  }
  
  .message-textarea:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }
  
  .message-textarea.dark {
    background: var(--background);
    border-color: #4b5563;
    color: #f9fafb;
  }
  
  .message-textarea.dark:focus {
    border-color: #60a5fa;
    box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.1);
  }
  
  .message-textarea::placeholder {
    color: #9ca3af;
  }
  
  .message-textarea.dark::placeholder {
    color: #6b7280;
  }
  
  .message-textarea:disabled {
    background: #f9fafb;
    color: #9ca3af;
    cursor: not-allowed;
  }
  
  .message-textarea.dark:disabled {
    background: #1f2937;
    color: #6b7280;
  }
  
  .input-actions {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  
  .action-button {
    background: none;
    border: none;
    color: #6b7280;
    cursor: pointer;
    padding: 6px;
    border-radius: 6px;
    font-size: 16px;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .action-button:hover {
    background: #f3f4f6;
    color: #374151;
  }
  
  .action-button.dark {
    color: #9ca3af;
  }
  
  .action-button.dark:hover {
    background: #4b5563;
    color: #f3f4f6;
  }

  .emoji-picker {
    position: absolute;
    bottom: 100%;
    right: 0;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 16px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    z-index: 1000;
    width: 280px;
    max-height: 300px;
    overflow-y: auto;
  }

  .emoji-picker.dark {
    background: #1e293b;
    border-color: #334155;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
  }

  .emoji-grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 8px;
  }

  .emoji-item {
    padding: 8px;
    border-radius: 6px;
    cursor: pointer;
    text-align: center;
    font-size: 20px;
    transition: background 0.15s ease;
    border: none;
    background: none;
  }

  .emoji-item:hover {
    background: #f1f5f9;
  }

  .emoji-item.dark:hover {
    background: #334155;
  }

  .emoji-category {
    font-size: 12px;
    font-weight: 600;
    color: #64748b;
    margin: 12px 0 8px 0;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .emoji-category.dark {
    color: #94a3b8;
  }

  .emoji-category:first-child {
    margin-top: 0;
  }
  
  .action-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .send-button {
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 50%;
    width: 32px;
    height: 32px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    font-size: 14px;
  }
  
  .send-button:hover {
    background: #2563eb;
    transform: scale(1.05);
  }
  
  .send-button:disabled {
    background: #d1d5db;
    cursor: not-allowed;
    transform: none;
  }
  
  .send-button.dark:disabled {
    background: #4b5563;
  }
  
  .file-input {
    display: none;
  }
  
  .input-hint {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
    font-size: 12px;
    color: #6b7280;
  }
  
  .input-hint.dark {
    color: #9ca3af;
  }
  
  .hint-shortcuts {
    display: flex;
    gap: 12px;
  }
  
  .shortcut {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  
  .shortcut-key {
    background: #f3f4f6;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 10px;
  }
  
  .shortcut-key.dark {
    background: #4b5563;
  }
  
  .character-count {
    color: #9ca3af;
    font-size: 11px;
  }
  
  .character-count.warning {
    color: #f59e0b;
  }
  
  .character-count.error {
    color: #ef4444;
  }
  
  .mention-suggestions {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    max-height: 200px;
    overflow-y: auto;
    z-index: 10;
  }
  
  .mention-suggestions.dark {
    background: #374151;
    border-color: #4b5563;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
  }
  
  .mention-item {
    padding: 8px 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: background 0.15s ease;
  }
  
  .mention-item:hover,
  .mention-item.selected {
    background: #f3f4f6;
  }
  
  .mention-item.dark:hover,
  .mention-item.dark.selected {
    background: #4b5563;
  }
  
  .mention-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #e5e7eb;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 600;
    color: #6b7280;
  }
  
  .mention-avatar.dark {
    background: #6b7280;
    color: #e5e7eb;
  }
  
  .mention-name {
    font-weight: 500;
    color: #374151;
    font-size: 14px;
  }
  
  .mention-name.dark {
    color: #f3f4f6;
  }
  
  .pending-attachment {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 8px 12px;
    margin-bottom: 8px;
  }
  
  .pending-attachment.dark {
    background: #0f172a;
    border-color: #334155;
  }
  
  .attachment-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .attachment-icon {
    font-size: 16px;
  }
  
  .attachment-name {
    font-size: 14px;
    color: #374151;
    flex: 1;
  }
  
  .attachment-name.dark {
    color: #f3f4f6;
  }
  
  .remove-attachment {
    background: none;
    border: none;
    color: #6b7280;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;
    font-size: 14px;
    line-height: 1;
    transition: all 0.15s ease;
  }
  
  .remove-attachment:hover {
    background: #f3f4f6;
    color: #374151;
  }
  
  .remove-attachment.dark {
    color: #9ca3af;
  }
  
  .remove-attachment.dark:hover {
    background: #374151;
    color: #f3f4f6;
  }
`

const MAX_MESSAGE_LENGTH = 2000

const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  currentTheme,
  placeholder = "Type a message...",
  disabled = false,
  agents = [],
  replyingTo,
  quotingMessage,
  onCancelReply,
  currentChannel,
  currentDirectMessage,
  currentAgentId,
  currentAgentSecret,
  networkBaseUrl,
  onCancelQuote,
  disableEmoji = false,
  disableMentions = false,
  disableFileUpload = false,
}) => {
  const { t } = useTranslation("messaging")
  const [message, setMessage] = useState("")
  const [pendingAttachment, setPendingAttachment] = useState<{
    file_id: string
    filename: string
    size: number
  } | null>(null)
  const [showMentions, setShowMentions] = useState(false)
  const [mentionFilter, setMentionFilter] = useState("")
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Clear input content when switching between channels or direct messages
  useEffect(() => {
    console.log("🧹 MessageInput: Channel/DM changed, clearing input content")
    setMessage("")
    setPendingAttachment(null)
    setShowMentions(false)
    setMentionFilter("")
    setSelectedMentionIndex(0)
    setShowEmojiPicker(false)

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }, [currentChannel, currentDirectMessage])

  // Common emojis organized by category
  const emojiCategories = {
    Smileys: [
      "😀",
      "😃",
      "😄",
      "😁",
      "😆",
      "😅",
      "😂",
      "🤣",
      "😊",
      "😇",
      "🙂",
      "🙃",
      "😉",
      "😌",
      "😍",
      "🥰",
    ],
    Gestures: [
      "👍",
      "👎",
      "👌",
      "✌️",
      "🤞",
      "🤟",
      "🤘",
      "🤙",
      "👈",
      "👉",
      "👆",
      "👇",
      "☝️",
      "✋",
      "🤚",
      "🖐️",
    ],
    Hearts: [
      "❤️",
      "🧡",
      "💛",
      "💚",
      "💙",
      "💜",
      "🖤",
      "🤍",
      "🤎",
      "💔",
      "❣️",
      "💕",
      "💞",
      "💓",
      "💗",
      "💖",
    ],
    Objects: [
      "🎉",
      "🎊",
      "🎈",
      "🎁",
      "🏆",
      "🥇",
      "🥈",
      "🥉",
      "⭐",
      "🌟",
      "💫",
      "✨",
      "🔥",
      "💯",
      "✅",
      "❌",
    ],
  }

  const handleEmojiSelect = (emoji: string) => {
    if (textareaRef.current) {
      const textarea = textareaRef.current
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newMessage = message.slice(0, start) + emoji + message.slice(end)
      setMessage(newMessage)

      // Set cursor position after emoji
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.setSelectionRange(
            start + emoji.length,
            start + emoji.length
          )
        }
      }, 0)
    }
    setShowEmojiPicker(false)
  }

  // Close emoji picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        showEmojiPicker &&
        textareaRef.current &&
        !textareaRef.current
          .closest(".thread-input-container")
          ?.contains(event.target as Node)
      ) {
        setShowEmojiPicker(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [showEmojiPicker])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (message.trim() && !disabled) {
      onSendMessage(
        message.trim(),
        replyingTo?.messageId,
        quotingMessage?.messageId,
        pendingAttachment || undefined
      )
      setMessage("")
      setPendingAttachment(null)
      adjustTextareaHeight()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle mention navigation
    if (showMentions && filteredAgents.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedMentionIndex((prev) =>
          prev < filteredAgents.length - 1 ? prev + 1 : 0
        )
        return
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedMentionIndex((prev) =>
          prev > 0 ? prev - 1 : filteredAgents.length - 1
        )
        return
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        if (filteredAgents[selectedMentionIndex]) {
          insertMention(filteredAgents[selectedMentionIndex])
        }
        return
      } else if (e.key === "Escape") {
        e.preventDefault()
        setShowMentions(false)
        setMentionFilter("")
        return
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    } else if (e.key === "Escape") {
      if (quotingMessage && onCancelQuote) {
        onCancelQuote()
      } else if (replyingTo && onCancelReply) {
        onCancelReply()
      }
    }
  }

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    }
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    if (newValue.length <= MAX_MESSAGE_LENGTH) {
      setMessage(newValue)
      adjustTextareaHeight()

      // Check for mentions (only if mentions are enabled)
      if (!disableMentions) {
        const lastWord = newValue.split(" ").pop() || ""
        if (lastWord.startsWith("@")) {
          const filter = lastWord.substring(1) // Remove the @ symbol
          setMentionFilter(filter)
          setShowMentions(true)
          setSelectedMentionIndex(0)
        } else {
          setShowMentions(false)
          setMentionFilter("")
        }
      } else {
        // If mentions are disabled, ensure they're not shown
        setShowMentions(false)
        setMentionFilter("")
      }
    }
  }

  // Filter agents based on mention input
  const filteredAgents = agents.filter((agent) => {
    if (!mentionFilter) return true
    const displayName = agent.display_name || agent.agent_id
    return (
      displayName.toLowerCase().includes(mentionFilter.toLowerCase()) ||
      agent.agent_id.toLowerCase().includes(mentionFilter.toLowerCase())
    )
  })

  const handleFileUpload = () => {
    fileInputRef.current?.click()
  }

  const insertMention = (agent: AgentInfo) => {
    const displayName = agent.display_name || agent.agent_id
    const words = message.split(" ")
    words[words.length - 1] = `@${displayName} `
    const newMessage = words.join(" ")
    setMessage(newMessage)
    setShowMentions(false)
    setMentionFilter("")

    // Focus back on textarea
    setTimeout(() => {
      textareaRef.current?.focus()
    }, 0)
  }

  const handleMentionClick = (agent: AgentInfo) => {
    insertMention(agent)
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!currentAgentId) {
      console.error("Missing agent ID for file upload")
      return
    }

    try {
      // Upload file using HTTP API to shared cache
      const formData = new FormData()
      formData.append("file", file)
      formData.append("agent_id", currentAgentId)
      // Include secret for authentication
      if (currentAgentSecret) {
        formData.append("secret", currentAgentSecret)
      }
      // Empty allowed_agent_groups means all agents can access
      formData.append("allowed_agent_groups", "")

      // Build the upload URL - use network base URL if available, otherwise use relative path
      const uploadUrl = networkBaseUrl
        ? `${networkBaseUrl}/cache/upload`
        : `/api/cache/upload`

      const response = await fetch(uploadUrl, {
        method: "POST",
        body: formData,
      })

      if (response.ok) {
        const result = await response.json()
        if (result.success) {
          // Store attachment data for later sending
          // Use cache_id as file_id for compatibility
          const attachmentData = {
            file_id: result.cache_id,
            filename: result.filename,
            size: result.file_size,
          }

          setPendingAttachment(attachmentData)

          // Show a visual indicator in the message input
          if (!message.trim()) {
            setMessage(`📎 ${result.filename} - `)
          }
        } else {
          console.error("File upload failed:", result.error || result)
        }
      } else {
        console.error("HTTP error during file upload:", response.status)
      }
    } catch (error) {
      console.error("Error uploading file:", error)
    }

    // Reset file input
    if (e.target) {
      e.target.value = ""
    }
  }

  const getCharacterCountClass = () => {
    const length = message.length
    if (length > MAX_MESSAGE_LENGTH * 0.9) return "error"
    if (length > MAX_MESSAGE_LENGTH * 0.8) return "warning"
    return ""
  }

  return (
    <div className={`thread-input-container ${currentTheme}`}>
      <style>{styles}</style>

      {replyingTo && (
        <div className={`reply-preview ${currentTheme}`}>
          <div className="reply-header">
            <div className={`reply-label ${currentTheme}`}>
              ↪️ {t("input.replyingTo", { user: replyingTo.author })}
            </div>
            {onCancelReply && (
              <Button
                variant="ghost"
                size="sm"
                className={`cancel-reply ${
                  currentTheme === "dark" ? "dark" : ""
                }`}
                onClick={onCancelReply}
                aria-label={t("input.cancel")}
              >
                ✕
              </Button>
            )}
          </div>
          <div className={`reply-text ${currentTheme}`}>
            {replyingTo.text.length > 100
              ? `${replyingTo.text.substring(0, 100)}...`
              : replyingTo.text}
          </div>
        </div>
      )}

      {quotingMessage && (
        <div className={`quote-preview ${currentTheme}`}>
          <div className="quote-header">
            <div className={`quote-label ${currentTheme}`}>
              📝 {t("input.quotingFrom", { user: quotingMessage.author })}
            </div>
            {onCancelQuote && (
              <Button
                variant="ghost"
                size="sm"
                className={`cancel-quote ${
                  currentTheme === "dark" ? "dark" : ""
                }`}
                onClick={onCancelQuote}
                aria-label={t("input.cancel")}
              >
                ✕
              </Button>
            )}
          </div>
          <div className={`reply-text ${currentTheme}`}>
            {quotingMessage.text.length > 100
              ? `${quotingMessage.text.substring(0, 100)}...`
              : quotingMessage.text}
          </div>
        </div>
      )}

      {/* Pending attachment indicator */}
      {pendingAttachment && (
        <div className={`pending-attachment ${currentTheme}`}>
          <div className="attachment-info">
            <span className="attachment-icon">📎</span>
            <span className="attachment-name">
              {pendingAttachment.filename}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPendingAttachment(null)}
              className={`remove-attachment ${currentTheme}`}
              title="Remove attachment"
            >
              ✕
            </Button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="input-area">
          {!disableMentions && showMentions && filteredAgents.length > 0 && (
            <div className={`mention-suggestions ${currentTheme}`}>
              {filteredAgents.map((agent, index) => {
                const displayName = agent.display_name || agent.agent_id
                const avatar = displayName.charAt(0).toUpperCase()
                const isSelected = index === selectedMentionIndex

                return (
                  <div
                    key={agent.agent_id}
                    className={`mention-item ${currentTheme} ${
                      isSelected ? "selected" : ""
                    }`}
                    onClick={() => handleMentionClick(agent)}
                  >
                    <div className={`mention-avatar ${currentTheme}`}>
                      {avatar}
                    </div>
                    <div className={`mention-name ${currentTheme}`}>
                      {displayName}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className={`message-textarea ${currentTheme}`}
            rows={1}
          />

          <div className="input-actions">
            {!disableFileUpload && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`action-button ${currentTheme}`}
                onClick={handleFileUpload}
                disabled={disabled}
                title="Upload file"
              >
                📎
              </Button>
            )}

            {!disableEmoji && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`action-button ${currentTheme}`}
                disabled={disabled}
                title="Add emoji"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              >
                😊
              </Button>
            )}

            <Button
              type="submit"
              variant="primary"
              size="sm"
              className="send-button"
              disabled={!message.trim() || disabled}
              title="Send message"
            >
              ↗
            </Button>
          </div>

          {/* Emoji Picker */}
          {!disableEmoji && showEmojiPicker && (
            <div className={`emoji-picker ${currentTheme}`}>
              {Object.entries(emojiCategories).map(([category, emojis]) => (
                <div key={category}>
                  <div className={`emoji-category ${currentTheme}`}>
                    {category}
                  </div>
                  <div className="emoji-grid">
                    {emojis.map((emoji, index) => (
                      <Button
                        key={`${category}-${index}`}
                        type="button"
                        variant="ghost"
                        className={`emoji-item ${currentTheme}`}
                        onClick={() => handleEmojiSelect(emoji)}
                        title={emoji}
                      >
                        {emoji}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          className="file-input"
          onChange={handleFileSelect}
          accept="*/*"
        />
      </form>

      <div className={`input-hint ${currentTheme}`}>
        <div className="hint-shortcuts">
          <div className="shortcut">
            <span className={`shortcut-key ${currentTheme}`}>Enter</span>
            <span>Send</span>
          </div>
          <div className="shortcut">
            <span className={`shortcut-key ${currentTheme}`}>Shift+Enter</span>
            <span>New line</span>
          </div>
          {replyingTo && (
            <div className="shortcut">
              <span className={`shortcut-key ${currentTheme}`}>Esc</span>
              <span>Cancel reply</span>
            </div>
          )}
        </div>

        <div className={`character-count ${getCharacterCountClass()}`}>
          {message.length}/{MAX_MESSAGE_LENGTH}
        </div>
      </div>
    </div>
  )
}

export default MessageInput
