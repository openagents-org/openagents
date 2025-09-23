import React, { useState, useRef, useEffect } from "react";
import { ThreadMessage } from "../../types/events";
import MarkdownContent from "./MarkdownContent";
import AttachmentDisplay from "./AttachmentDisplay";
import { formatRelativeTimestamp } from "@/utils/utils";

interface MessageDisplayProps {
  messages: ThreadMessage[];
  currentUserId: string;
  onReply: (messageId: string, text: string, author: string) => void;
  onQuote: (messageId: string, text: string, author: string) => void;
  onReaction: (messageId: string, reactionType: string) => void;
}

interface ThreadStructure {
  [messageId: string]: {
    message: ThreadMessage;
    children: string[];
    level: number;
  };
}

const REACTION_EMOJIS = {
  "+1": "👍",
  "-1": "👎",
  like: "❤️",
  heart: "💗",
  laugh: "😂",
  wow: "😮",
  sad: "😢",
  angry: "😠",
  thumbs_up: "👍",
  thumbs_down: "👎",
  smile: "😊",
  ok: "👌",
  done: "✅",
  fire: "🔥",
  party: "🎉",
  clap: "👏",
  check: "✅",
  cross: "❌",
  eyes: "👀",
  thinking: "🤔",
};

// Custom styles for complex behaviors that Tailwind can't handle easily
const customStyles = `
  .quote-author:before {
    content: "📝 ";
    opacity: 0.7;
  }
  
  .message-content * {
    margin: 0;
  }
  
  .message-content *:not(:last-child) {
    margin-bottom: 0.5rem;
  }
  
  .message-content p:last-child {
    margin-bottom: 0;
  }
`;

const MessageDisplay: React.FC<MessageDisplayProps> = ({
  messages = [],
  currentUserId,
  onReply,
  onQuote,
  onReaction,
}) => {
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(
    null
  );
  const [hoveredMessage, setHoveredMessage] = useState<string | null>(null);
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(
    new Set()
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Build thread structure and return both structure and root message IDs
  const buildThreadStructure = (): { structure: ThreadStructure; rootMessageIds: string[] } => {
    const structure: ThreadStructure = {};
    const rootMessages: string[] = [];

    // First pass: organize messages and identify roots
    messages.forEach((message) => {
      structure[message.message_id] = {
        message,
        children: [],
        level: message.thread_level || 0,
      };

      // Only messages with reply_to_id are considered replies (not quotes)
      // Messages with only quoted_message_id are independent messages that quote others
      if (!message.reply_to_id) {
        rootMessages.push(message.message_id);
      }
    });

    // Track orphaned replies (replies whose parents are not in current message set)
    const orphanedReplies: string[] = [];

    // Second pass: build parent-child relationships
    // Only for actual replies, not quotes
    messages.forEach((message) => {
      if (message.reply_to_id) {
        if (structure[message.reply_to_id]) {
          structure[message.reply_to_id].children.push(message.message_id);
        } else {
          // Parent not found - treat as orphaned reply
          orphanedReplies.push(message.message_id);
        }
      }
    });

    // Add orphaned replies as root messages so they still display
    rootMessages.push(...orphanedReplies);
    
    

    return { structure, rootMessageIds: rootMessages };
  };

  const handleReaction = (
    messageId: string,
    reactionType: string,
    event?: React.MouseEvent
  ) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    onReaction(messageId, reactionType);
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

  const renderMessage = (
    messageId: string,
    structure: ThreadStructure,
    level = 0
  ): React.ReactNode => {
    const item = structure[messageId];
    if (!item) return null;

    const message = item.message;
    const isOwnMessage = message.sender_id === currentUserId;
    const isCollapsed = collapsedThreads.has(messageId);
    const hasChildren = item.children.length > 0;

    return (
      <div key={messageId} className="mb-1 relative">
        <div
          className={`relative rounded-xl px-4 py-3 transition-all duration-150 border ${
            isOwnMessage
              ? "bg-blue-50 border-blue-200 hover:bg-slate-100 hover:border-slate-300 dark:bg-blue-900 dark:border-blue-500 dark:hover:bg-slate-700 dark:hover:border-slate-600"
              : "bg-slate-50 border-slate-200 hover:bg-slate-100 hover:border-slate-300 dark:bg-slate-900 dark:border-slate-600 dark:hover:bg-slate-700 dark:hover:border-slate-500"
          }`}
          onMouseEnter={() => setHoveredMessage(messageId)}
          onMouseLeave={() => setHoveredMessage(null)}
        >
          <div className="flex items-center gap-2 mb-2 text-sm">
            <span className="font-semibold text-slate-800 dark:text-slate-100">
              {(() => {
                if (isOwnMessage) {
                  return "You";
                }

                // Extract a more readable name from sender_id
                const senderId = message.sender_id;

                // If sender_id contains '@', take the part before it
                if (senderId.includes("@")) {
                  const namePart = senderId.split("@")[0];
                  // If it looks like a test name (contains 'test' or 'work'), try to make it more readable
                  if (namePart.includes("_")) {
                    return namePart
                      .split("_")
                      .map(
                        (part) => part.charAt(0).toUpperCase() + part.slice(1)
                      )
                      .join(" ");
                  }
                  return namePart;
                }

                // If sender_id contains underscores, format it nicely
                if (senderId.includes("_")) {
                  return senderId
                    .split("_")
                    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                    .join(" ");
                }

                // Otherwise just capitalize first letter
                return senderId.charAt(0).toUpperCase() + senderId.slice(1);
              })()}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {formatRelativeTimestamp(message.timestamp)}
            </span>
            {message.reply_to_id && (
              <div className="absolute -left-2 top-1/2 transform -translate-y-1/2 w-1 h-5 bg-blue-500 rounded-sm" />
            )}
          </div>

          {/* 2025/09/25 no need this */}
          {/* {message.quoted_text && (
            <div className="border-l-3 px-3 py-2 my-2 rounded-md text-sm bg-slate-100 border-slate-400 text-slate-600 dark:bg-slate-600 dark:border-slate-500 dark:text-slate-300">
              {(() => {
                // Parse "Author: message text" format
                const colonIndex = message.quoted_text.indexOf(": ");
                if (
                  colonIndex > 0 &&
                  colonIndex < message.quoted_text.length - 2
                ) {
                  const author = message.quoted_text.substring(0, colonIndex);
                  const text = message.quoted_text.substring(colonIndex + 2);
                  return (
                    <>
                      <div className="quote-author font-semibold text-xs mb-1 text-gray-700 dark:text-slate-300">
                        {author}
                      </div>
                      <div className="italic leading-snug">"{text}"</div>
                    </>
                  );
                } else {
                  // Fallback for messages that don't have the author format
                  return `"${message.quoted_text}"`;
                }
              })()}
            </div>
          )} */}

          <div className="message-content leading-6 break-words">
            {message.content?.text ? (
              <MarkdownContent content={message.content.text} />
            ) : (
              <div className="text-gray-500 italic">
                {message.content ? "Empty message" : "No content"}
              </div>
            )}

            {/* Attachment display */}
            <AttachmentDisplay
              attachment_file_id={message.attachment_file_id}
              attachment_filename={message.attachment_filename}
              attachment_size={message.attachment_size}
              attachments={message.attachments}
            />
          </div>

          {message.reactions && Object.keys(message.reactions).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {Object.entries(message.reactions).map(([type, count]) => {
                const numCount = Number(count);
                return (
                  numCount > 0 && (
                    <div
                      key={type}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs cursor-pointer transition-all duration-150 border bg-slate-100 border-slate-200 hover:bg-slate-200 hover:border-slate-300 dark:bg-slate-600 dark:border-slate-500 dark:text-gray-200 dark:hover:bg-slate-500 dark:hover:border-slate-400"
                      onClick={(event) =>
                        handleReaction(messageId, type, event)
                      }
                    >
                      <span>
                        {REACTION_EMOJIS[
                          type as keyof typeof REACTION_EMOJIS
                        ] || type}
                      </span>
                      <span>{numCount}</span>
                    </div>
                  )
                );
              })}
            </div>
          )}

          <div
            className={`absolute -top-2 right-4 flex gap-1 px-1 py-1 rounded-lg border z-10 transition-all duration-200 bg-white border-slate-200 shadow-lg shadow-black/10 dark:bg-slate-700 dark:border-slate-600 dark:shadow-black/30 ${
              hoveredMessage === messageId
                ? "opacity-100 visible"
                : "opacity-0 invisible"
            }`}
          >
            <button
              className="flex items-center justify-center w-8 h-8 rounded-md text-base cursor-pointer transition-all duration-200 text-slate-500 hover:bg-slate-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-slate-200"
              onClick={() =>
                onReply(messageId, message.content.text, message.sender_id)
              }
              title="Reply"
            >
              ↩️
            </button>
            <button
              className="flex items-center justify-center w-8 h-8 rounded-md text-base cursor-pointer transition-all duration-200 text-slate-500 hover:bg-slate-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-slate-200"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setShowReactionPicker(
                  showReactionPicker === messageId ? null : messageId
                );
              }}
              title="Add reaction"
            >
              😊
            </button>
            <button
              className="flex items-center justify-center w-8 h-8 rounded-md text-base cursor-pointer transition-all duration-200 text-slate-500 hover:bg-slate-100 hover:text-gray-700 dark:text-slate-400 dark:hover:bg-slate-600 dark:hover:text-slate-200"
              onClick={() =>
                onQuote(messageId, message.content.text, message.sender_id)
              }
              title="Quote message"
            >
              💬
            </button>
          </div>

          {showReactionPicker === messageId && (
            <div className="absolute bottom-full left-0 flex gap-1 p-2 rounded-lg border z-10 shadow-lg bg-white border-slate-200 shadow-black/10 dark:bg-gray-800 dark:border-gray-700 dark:shadow-black/30">
              {Object.entries(REACTION_EMOJIS)
                .slice(0, 8)
                .map(([type, emoji]) => (
                  <div
                    key={type}
                    className="p-1 rounded cursor-pointer transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-700"
                    onClick={(event) => handleReaction(messageId, type, event)}
                  >
                    {emoji}
                  </div>
                ))}
            </div>
          )}

          {hasChildren && (
            <button
              className="bg-transparent border-none cursor-pointer text-xs px-1 py-0.5 rounded mt-1 transition-colors text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-600"
              onClick={() => toggleThread(messageId)}
            >
              {isCollapsed
                ? `▶ Show ${item.children.length} replies`
                : `▼ Hide replies`}
            </button>
          )}

          {hasChildren && !isCollapsed && (
            <div className="text-xs mt-1 italic text-slate-500 dark:text-slate-400">
              {item.children.length}{" "}
              {item.children.length === 1 ? "reply" : "replies"}
            </div>
          )}
        </div>

        {/* Render child messages */}
        {hasChildren && !isCollapsed && level < 4 && (
          <div
            className={`border-l-2 mt-2 pl-4 border-slate-200 dark:border-slate-600 ${
              level === 0
                ? "ml-8 border-l-blue-500"
                : level === 1
                ? "ml-10 border-l-emerald-500"
                : level === 2
                ? "ml-12 border-l-amber-500"
                : "ml-14 border-l-red-500"
            }`}
          >
            {item.children.map((childId) =>
              renderMessage(childId, structure, level + 1)
            )}
          </div>
        )}
      </div>
    );
  };

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4 scroll-smooth bg-white dark:bg-slate-800">
        <style>{customStyles}</style>
        <div className="flex items-center justify-center h-48 text-center text-base text-slate-500 dark:text-slate-400">
          <div>
            <div>No messages yet</div>
            <div className="text-sm mt-2">Start a conversation!</div>
          </div>
        </div>
      </div>
    );
  }

  const { structure: threadStructure, rootMessageIds } = buildThreadStructure();
  
  // Get actual message objects for root message IDs in the correct order
  const rootMessages = rootMessageIds
    .map(id => messages.find(m => m.message_id === id))
    .filter(Boolean) as ThreadMessage[];

  return (
    <div className="flex-1 overflow-y-auto p-4 scroll-smooth bg-white dark:bg-slate-800">
      <style>{customStyles}</style>

      {rootMessages.map((message) =>
        renderMessage(message.message_id, threadStructure)
      )}

      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageDisplay;
