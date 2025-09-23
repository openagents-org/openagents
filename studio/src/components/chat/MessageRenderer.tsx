/**
 * 统一的消息渲染器 - 合并了MessageDisplay和UnifiedMessageRenderer的功能
 *
 * 功能：
 * 1. 支持多种消息类型（UnifiedMessage 和 ThreadMessage）
 * 2. 支持反应、回复、引用操作
 * 3. 支持附件显示
 * 4. 支持线程结构显示
 * 5. 支持多种渲染模式
 */

import React, { useState, useRef, useEffect } from "react";
import { UnifiedMessage } from "@/types/message";
import { ThreadMessage } from "@/types/events";
import {
  formatRelativeTimestamp,
  isMessageAuthor,
  getThreadStyleClass,
  getMessageBackgroundClass,
  buildMessageTree,
  shouldShowThreadCollapseButton,
  getValidReactions,
  MessageTreeNode,
} from "@/utils/messageDisplayUtils";
import {
  REACTION_PICKER_EMOJIS,
  MESSAGE_DISPLAY_STYLES,
  getReactionEmoji,
} from "@/constants/chatConstants";
import MarkdownContent from "./MarkdownContent";
import AttachmentDisplay from "./AttachmentDisplay";

// 支持的消息类型
type SupportedMessage = UnifiedMessage | ThreadMessage;

interface MessageRendererProps {
  messages: SupportedMessage[];
  currentUserId: string;
  onReply: (messageId: string, text: string, author: string) => void;
  onQuote: (messageId: string, text: string, author: string) => void;
  onReaction: (messageId: string, reactionType: string, action?: "add" | "remove") => void;
  // 渲染模式：flat（平铺）或 threaded（线程）
  renderMode?: 'flat' | 'threaded';
  // 最大线程深度
  maxThreadDepth?: number;
}

const MessageRenderer: React.FC<MessageRendererProps> = ({
  messages = [],
  currentUserId,
  onReply,
  onQuote,
  onReaction,
  renderMode = 'threaded',
  maxThreadDepth = 4,
}) => {
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null);
  const [hoveredMessage, setHoveredMessage] = useState<string | null>(null);
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 消息类型检测和属性获取
  const getMessageProps = (message: SupportedMessage) => {
    // 检测是否为 ThreadMessage 类型
    if ('message_id' in message) {
      const threadMsg = message as ThreadMessage;
      return {
        id: threadMsg.message_id,
        senderId: threadMsg.sender_id,
        timestamp: threadMsg.timestamp,
        content: threadMsg.content?.text || '',
        replyToId: threadMsg.reply_to_id,
        reactions: threadMsg.reactions,
        attachments: threadMsg.attachments ? threadMsg.attachments.map(att => ({
          fileId: att.file_id,
          filename: att.filename,
          size: att.size,
          fileType: att.file_type,
        })) : undefined,
        // 处理旧格式的单个附件
        legacyAttachment: threadMsg.attachment_file_id ? {
          fileId: threadMsg.attachment_file_id,
          filename: threadMsg.attachment_filename || '',
          size: typeof threadMsg.attachment_size === 'string'
            ? parseInt(threadMsg.attachment_size) || 0
            : threadMsg.attachment_size || 0,
        } : undefined,
      };
    } else {
      // UnifiedMessage 类型
      const unifiedMsg = message as UnifiedMessage;
      return {
        id: unifiedMsg.id,
        senderId: unifiedMsg.senderId,
        timestamp: unifiedMsg.timestamp,
        content: unifiedMsg.content,
        replyToId: unifiedMsg.replyToId,
        reactions: unifiedMsg.reactions,
        attachments: unifiedMsg.attachments,
        legacyAttachment: undefined,
      };
    }
  };

  // 格式化用户名
  const formatUsername = (senderId: string): string => {
    if (!senderId || typeof senderId !== 'string') {
      return 'Unknown';
    }

    // 如果包含@，取@之前的部分
    if (senderId.includes("@")) {
      const namePart = senderId.split("@")[0];
      if (namePart.includes("_")) {
        return namePart
          .split("_")
          .map(part => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ");
      }
      return namePart;
    }

    // 如果包含下划线，格式化显示
    if (senderId.includes("_")) {
      return senderId
        .split("_")
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
    }

    // 否则只是首字母大写
    return senderId.charAt(0).toUpperCase() + senderId.slice(1);
  };

  const handleReaction = (
    messageId: string,
    reactionType: string,
    event?: React.MouseEvent,
    action?: "add" | "remove"
  ) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    onReaction(messageId, reactionType, action);
    setShowReactionPicker(null);
  };

  const toggleThread = (messageId: string) => {
    const newCollapsed = new Set(collapsedThreads);
    if (newCollapsed.has(messageId)) {
      newCollapsed.delete(messageId);
    } else {
      newCollapsed.add(messageId);
    }
    setCollapsedThreads(newCollapsed);
  };

  // 为了兼容旧的 ThreadMessage 格式，需要构建线程结构
  const buildThreadStructureForThreadMessages = (threadMessages: ThreadMessage[]) => {
    const structure: { [messageId: string]: { message: ThreadMessage; children: string[]; level: number } } = {};
    const rootMessages: string[] = [];

    // 第一遍：组织消息并识别根消息
    threadMessages.forEach((message) => {
      structure[message.message_id] = {
        message,
        children: [],
        level: message.thread_level || 0,
      };

      if (!message.reply_to_id) {
        rootMessages.push(message.message_id);
      }
    });

    // 跟踪孤立的回复
    const orphanedReplies: string[] = [];

    // 第二遍：建立父子关系
    threadMessages.forEach((message) => {
      if (message.reply_to_id) {
        if (structure[message.reply_to_id]) {
          structure[message.reply_to_id].children.push(message.message_id);
        } else {
          orphanedReplies.push(message.message_id);
        }
      }
    });

    // 将孤立回复作为根消息显示
    rootMessages.push(...orphanedReplies);

    return { structure, rootMessageIds: rootMessages };
  };

  // 渲染单个消息（ThreadMessage格式）
  const renderThreadMessage = (
    messageId: string,
    structure: { [messageId: string]: { message: ThreadMessage; children: string[]; level: number } },
    level = 0
  ): React.ReactNode => {
    const item = structure[messageId];
    if (!item) return null;

    const message = item.message;
    const messageProps = getMessageProps(message);
    const isOwnMessage = messageProps.senderId === currentUserId;
    const isCollapsed = collapsedThreads.has(messageId);
    const hasChildren = item.children.length > 0;

    return (
      <div key={messageId} className="mb-1 relative">
        <div
          className={`relative rounded-xl px-4 py-3 transition-all duration-150 border ${getMessageBackgroundClass(isOwnMessage)}`}
          onMouseEnter={() => setHoveredMessage(messageId)}
          onMouseLeave={() => setHoveredMessage(null)}
        >
          {/* 消息头部 */}
          <div className="flex items-center gap-2 mb-2 text-sm">
            <span className="font-semibold text-slate-800 dark:text-slate-100">
              {isOwnMessage ? "You" : formatUsername(messageProps.senderId)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {formatRelativeTimestamp(messageProps.timestamp)}
            </span>
            {messageProps.replyToId && (
              <div className="absolute -left-2 top-1/2 transform -translate-y-1/2 w-1 h-5 bg-blue-500 rounded-sm" />
            )}
          </div>

          {/* 消息内容 */}
          <div className="message-content leading-6 break-words">
            {messageProps.content ? (
              <MarkdownContent content={messageProps.content} />
            ) : (
              <div className="text-gray-500 italic">Empty message</div>
            )}

            {/* 附件显示 */}
            {messageProps.attachments && messageProps.attachments.length > 0 ? (
              <AttachmentDisplay attachments={messageProps.attachments} />
            ) : messageProps.legacyAttachment ? (
              <AttachmentDisplay
                attachment_file_id={messageProps.legacyAttachment.fileId}
                attachment_filename={messageProps.legacyAttachment.filename}
                attachment_size={messageProps.legacyAttachment.size}
              />
            ) : null}
          </div>

          {/* 反应显示 */}
          {messageProps.reactions && Object.keys(getValidReactions(messageProps.reactions)).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {Object.entries(getValidReactions(messageProps.reactions)).map(([type, count]) => (
                <div
                  key={type}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs cursor-pointer transition-all duration-150 border bg-slate-100 border-slate-200 hover:bg-slate-200 hover:border-slate-300 dark:bg-slate-600 dark:border-slate-500 dark:text-gray-200 dark:hover:bg-slate-500 dark:hover:border-slate-400"
                  onClick={(event) => handleReaction(messageId, type, event, "add")}
                >
                  <span>{getReactionEmoji(type)}</span>
                  <span>{count}</span>
                </div>
              ))}
            </div>
          )}

          {/* 悬浮操作按钮 */}
          <div
            className={`absolute -top-2 right-4 flex gap-1 px-1 py-1 rounded-lg border z-10 transition-all duration-200 bg-white border-slate-200 shadow-lg shadow-black/10 dark:bg-slate-700 dark:border-slate-600 dark:shadow-black/30 ${
              hoveredMessage === messageId ? "opacity-100 visible" : "opacity-0 invisible"
            }`}
          >
            <button
              className="flex items-center justify-center w-8 h-8 rounded-md text-base cursor-pointer transition-all duration-200 text-slate-500 hover:bg-slate-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-slate-200"
              onClick={() => onReply(messageId, messageProps.content, messageProps.senderId)}
              title="Reply"
            >
              ↩️
            </button>
            <button
              className="flex items-center justify-center w-8 h-8 rounded-md text-base cursor-pointer transition-all duration-200 text-slate-500 hover:bg-slate-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-slate-200"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setShowReactionPicker(showReactionPicker === messageId ? null : messageId);
              }}
              title="Add reaction"
            >
              😊
            </button>
            <button
              className="flex items-center justify-center w-8 h-8 rounded-md text-base cursor-pointer transition-all duration-200 text-slate-500 hover:bg-slate-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-slate-200"
              onClick={() => onQuote(messageId, messageProps.content, messageProps.senderId)}
              title="Quote message"
            >
              💬
            </button>
          </div>

          {/* 反应选择器 */}
          {showReactionPicker === messageId && (
            <div className="absolute bottom-full left-0 flex gap-1 p-2 rounded-lg border z-10 shadow-lg bg-white border-slate-200 shadow-black/10 dark:bg-gray-800 dark:border-gray-700 dark:shadow-black/30">
              {REACTION_PICKER_EMOJIS.map(({ type, emoji }) => (
                <div
                  key={type}
                  className="p-1 rounded cursor-pointer transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={(event) => handleReaction(messageId, type, event, "add")}
                >
                  {emoji}
                </div>
              ))}
            </div>
          )}

          {/* 线程控制按钮 */}
          {hasChildren && (
            <button
              className="bg-transparent border-none cursor-pointer text-xs px-1 py-0.5 rounded mt-1 transition-colors text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-600"
              onClick={() => toggleThread(messageId)}
            >
              {isCollapsed ? `▶ Show ${item.children.length} replies` : `▼ Hide replies`}
            </button>
          )}

          {hasChildren && !isCollapsed && (
            <div className="text-xs mt-1 italic text-slate-500 dark:text-slate-400">
              {item.children.length} {item.children.length === 1 ? "reply" : "replies"}
            </div>
          )}
        </div>

        {/* 渲染子消息 */}
        {hasChildren && !isCollapsed && level < maxThreadDepth && (
          <div className={`border-l-2 mt-2 pl-4 border-slate-200 dark:border-slate-600 ${getThreadStyleClass(level)}`}>
            {item.children.map((childId) => renderThreadMessage(childId, structure, level + 1))}
          </div>
        )}
      </div>
    );
  };

  // 渲染单个消息（UnifiedMessage格式）
  const renderUnifiedMessage = (
    message: UnifiedMessage,
    level = 0,
    children?: MessageTreeNode[]
  ): React.ReactNode => {
    const isOwnMessage = isMessageAuthor(message, currentUserId);
    const isCollapsed = collapsedThreads.has(message.id);
    const hasChildren = children && children.length > 0;

    return (
      <div key={message.id} className="mb-1 relative">
        <div
          className={`relative rounded-xl px-4 py-3 transition-all duration-150 border ${getMessageBackgroundClass(isOwnMessage)}`}
          onMouseEnter={() => setHoveredMessage(message.id)}
          onMouseLeave={() => setHoveredMessage(null)}
        >
          {/* 消息头部 */}
          <div className="flex items-center gap-2 mb-2 text-sm">
            <span className="font-semibold text-slate-800 dark:text-slate-100">
              {isOwnMessage ? "You" : formatUsername(message.senderId)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {formatRelativeTimestamp(message.timestamp)}
            </span>
            {message.replyToId && (
              <div className="absolute -left-2 top-1/2 transform -translate-y-1/2 w-1 h-5 bg-blue-500 rounded-sm" />
            )}
          </div>

          {/* 消息内容 */}
          <div className="message-content leading-6 break-words">
            {message.content ? (
              <MarkdownContent content={message.content} />
            ) : (
              <div className="text-gray-500 italic">Empty message</div>
            )}

            {/* 附件显示 */}
            {message.attachments && message.attachments.length > 0 && (
              <AttachmentDisplay attachments={message.attachments} />
            )}
          </div>

          {/* 反应显示 */}
          {message.reactions && Object.keys(getValidReactions(message.reactions)).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {Object.entries(getValidReactions(message.reactions)).map(([type, count]) => (
                <div
                  key={type}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs cursor-pointer transition-all duration-150 border bg-slate-100 border-slate-200 hover:bg-slate-200 hover:border-slate-300 dark:bg-slate-600 dark:border-slate-500 dark:text-gray-200 dark:hover:bg-slate-500 dark:hover:border-slate-400"
                  onClick={(event) => handleReaction(message.id, type, event, "add")}
                >
                  <span>{getReactionEmoji(type)}</span>
                  <span>{count}</span>
                </div>
              ))}
            </div>
          )}

          {/* 悬浮操作按钮 */}
          <div
            className={`absolute -top-2 right-4 flex gap-1 px-1 py-1 rounded-lg border z-10 transition-all duration-200 bg-white border-slate-200 shadow-lg shadow-black/10 dark:bg-slate-700 dark:border-slate-600 dark:shadow-black/30 ${
              hoveredMessage === message.id ? "opacity-100 visible" : "opacity-0 invisible"
            }`}
          >
            <button
              className="flex items-center justify-center w-8 h-8 rounded-md text-base cursor-pointer transition-all duration-200 text-slate-500 hover:bg-slate-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-slate-200"
              onClick={() => onReply(message.id, message.content, message.senderId)}
              title="Reply"
            >
              ↩️
            </button>
            <button
              className="flex items-center justify-center w-8 h-8 rounded-md text-base cursor-pointer transition-all duration-200 text-slate-500 hover:bg-slate-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-slate-200"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setShowReactionPicker(showReactionPicker === message.id ? null : message.id);
              }}
              title="Add reaction"
            >
              😊
            </button>
            <button
              className="flex items-center justify-center w-8 h-8 rounded-md text-base cursor-pointer transition-all duration-200 text-slate-500 hover:bg-slate-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-slate-200"
              onClick={() => onQuote(message.id, message.content, message.senderId)}
              title="Quote message"
            >
              💬
            </button>
          </div>

          {/* 反应选择器 */}
          {showReactionPicker === message.id && (
            <div className="absolute bottom-full left-0 flex gap-1 p-2 rounded-lg border z-10 shadow-lg bg-white border-slate-200 shadow-black/10 dark:bg-gray-800 dark:border-gray-700 dark:shadow-black/30">
              {REACTION_PICKER_EMOJIS.map(({ type, emoji }) => (
                <div
                  key={type}
                  className="p-1 rounded cursor-pointer transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={(event) => handleReaction(message.id, type, event, "add")}
                >
                  {emoji}
                </div>
              ))}
            </div>
          )}

          {/* 线程控制按钮 */}
          {hasChildren && shouldShowThreadCollapseButton({ message, children: children || [], level }) && (
            <button
              className="bg-transparent border-none cursor-pointer text-xs px-1 py-0.5 rounded mt-1 transition-colors text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-600"
              onClick={() => toggleThread(message.id)}
            >
              {isCollapsed ? `▶ Show ${children?.length} replies` : `▼ Hide replies`}
            </button>
          )}

          {hasChildren && !isCollapsed && (
            <div className="text-xs mt-1 italic text-slate-500 dark:text-slate-400">
              {children?.length} {children?.length === 1 ? "reply" : "replies"}
            </div>
          )}
        </div>

        {/* 渲染子消息 */}
        {hasChildren && !isCollapsed && level < maxThreadDepth && (
          <div className={`border-l-2 mt-2 pl-4 border-slate-200 dark:border-slate-600 ${getThreadStyleClass(level)}`}>
            {children?.map((child) => renderUnifiedMessage(child.message, level + 1, child.children))}
          </div>
        )}
      </div>
    );
  };

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4 scroll-smooth bg-white dark:bg-slate-800">
        <style>{MESSAGE_DISPLAY_STYLES}</style>
        <div className="flex items-center justify-center h-48 text-center text-base text-slate-500 dark:text-slate-400">
          <div>
            <div>No messages yet</div>
            <div className="text-sm mt-2">Start a conversation!</div>
          </div>
        </div>
      </div>
    );
  }

  // 检测消息类型并相应渲染
  const isThreadMessageFormat = messages.length > 0 && 'message_id' in messages[0];

  if (isThreadMessageFormat) {
    // ThreadMessage 格式
    const threadMessages = messages as ThreadMessage[];
    const { structure, rootMessageIds } = buildThreadStructureForThreadMessages(threadMessages);

    return (
      <div className="flex-1 overflow-y-auto p-4 scroll-smooth bg-white dark:bg-slate-800">
        <style>{MESSAGE_DISPLAY_STYLES}</style>
        {rootMessageIds.map((messageId) => renderThreadMessage(messageId, structure))}
        <div ref={messagesEndRef} />
      </div>
    );
  } else {
    // UnifiedMessage 格式
    const unifiedMessages = messages as UnifiedMessage[];

    if (renderMode === 'flat') {
      // 平铺模式：简单按时间顺序显示所有消息
      return (
        <div className="flex-1 overflow-y-auto p-4 scroll-smooth bg-white dark:bg-slate-800">
          <style>{MESSAGE_DISPLAY_STYLES}</style>
          {unifiedMessages.map((message) => renderUnifiedMessage(message))}
          <div ref={messagesEndRef} />
        </div>
      );
    } else {
      // 线程模式：构建线程结构显示
      const messageTree = buildMessageTree(unifiedMessages);

      return (
        <div className="flex-1 overflow-y-auto p-4 scroll-smooth bg-white dark:bg-slate-800">
          <style>{MESSAGE_DISPLAY_STYLES}</style>
          {messageTree.map((node) => renderUnifiedMessage(node.message, 0, node.children))}
          <div ref={messagesEndRef} />
        </div>
      );
    }
  }
};

export default MessageRenderer;