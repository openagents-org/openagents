import React, { useState, useRef, useEffect } from 'react';
import { ThreadMessage } from '../../services/openagentsService';

interface MessageDisplayProps {
  messages: ThreadMessage[];
  currentUserId: string;
  onReply: (messageId: string, text: string, author: string) => void;
  onQuote: (messageId: string, text: string, author: string) => void;
  onReaction: (messageId: string, reactionType: string) => void;
  currentTheme: 'light' | 'dark';
}

interface ThreadStructure {
  [messageId: string]: {
    message: ThreadMessage;
    children: string[];
    level: number;
  };
}

const REACTION_EMOJIS = {
  '+1': '👍',
  '-1': '👎', 
  'like': '❤️',
  'heart': '💗',
  'laugh': '😂',
  'wow': '😮',
  'sad': '😢',
  'angry': '😠',
  'thumbs_up': '👍',
  'thumbs_down': '👎',
  'smile': '😊',
  'ok': '👌',
  'done': '✅',
  'fire': '🔥',
  'party': '🎉',
  'clap': '👏',
  'check': '✅',
  'cross': '❌',
  'eyes': '👀',
  'thinking': '🤔'
};

const styles = `
  .message-display {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    background: #ffffff;
    scroll-behavior: smooth;
  }
  
  .message-display.dark {
    background: #1e293b;
  }
  
  .message-item {
    margin-bottom: 16px;
    position: relative;
  }
  
  .message-thread {
    border-left: 2px solid #e2e8f0;
    margin-left: 24px;
    padding-left: 16px;
    margin-top: 8px;
  }
  
  .message-thread.dark {
    border-left-color: #334155;
  }
  
  .message-thread.level-1 { margin-left: 32px; }
  .message-thread.level-2 { margin-left: 40px; }
  .message-thread.level-3 { margin-left: 48px; }
  .message-thread.level-4 { margin-left: 56px; }
  
  .message-thread.level-1 { border-left-color: #3b82f6; }
  .message-thread.level-2 { border-left-color: #10b981; }
  .message-thread.level-3 { border-left-color: #f59e0b; }
  .message-thread.level-4 { border-left-color: #ef4444; }
  
  .message-bubble {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 12px 16px;
    position: relative;
    transition: all 0.15s ease;
  }
  
  .message-bubble:hover {
    background: #f1f5f9;
    border-color: #cbd5e1;
  }
  
  .message-bubble.dark {
    background: #0f172a;
    border-color: #334155;
  }
  
  .message-bubble.dark:hover {
    background: #1e293b;
    border-color: #475569;
  }
  
  .message-bubble.own-message {
    background: #dbeafe;
    border-color: #bfdbfe;
  }
  
  .message-bubble.own-message.dark {
    background: #1e3a8a;
    border-color: #3b82f6;
  }
  
  .message-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 14px;
  }
  
  .message-author {
    font-weight: 600;
    color: #1e293b;
  }
  
  .message-author.dark {
    color: #f1f5f9;
  }
  
  .message-timestamp {
    color: #64748b;
    font-size: 12px;
  }
  
  .message-timestamp.dark {
    color: #94a3b8;
  }
  
  .message-content {
    color: #374151;
    line-height: 1.5;
    word-wrap: break-word;
    white-space: pre-wrap;
  }
  
  .message-content.dark {
    color: #e5e7eb;
  }
  
  .quoted-message {
    background: #f1f5f9;
    border-left: 3px solid #94a3b8;
    padding: 8px 12px;
    margin: 8px 0;
    border-radius: 6px;
    font-size: 14px;
    color: #64748b;
  }
  
  .quoted-message.dark {
    background: #334155;
    border-left-color: #64748b;
    color: #94a3b8;
  }
  
  .quote-author {
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 4px;
    color: #374151;
  }
  
  .quote-author:before {
    content: "📝 ";
    opacity: 0.7;
  }
  
  .quoted-message.dark .quote-author {
    color: #cbd5e1;
  }
  
  .quote-text {
    font-style: italic;
    line-height: 1.4;
  }
  
  .message-actions {
    position: absolute;
    top: -8px;
    right: 16px;
    display: flex;
    gap: 4px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    opacity: 0;
    visibility: hidden;
    transition: all 0.2s ease;
    z-index: 10;
  }
  
  .message-actions.dark {
    background: #1e293b;
    border-color: #334155;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }
  
  .message-actions.visible {
    opacity: 1;
    visibility: visible;
  }
  
  .action-button {
    background: transparent;
    border: none;
    border-radius: 6px;
    padding: 6px;
    font-size: 16px;
    color: #64748b;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    position: relative;
  }
  
  .action-button:hover {
    background: #f1f5f9;
    color: #374151;
  }
  
  .action-button.dark {
    color: #94a3b8;
  }
  
  .action-button.dark:hover {
    background: #334155;
    color: #e2e8f0;
  }
  
  .reactions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;
  }
  
  .reaction-item {
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    padding: 2px 8px;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .reaction-item:hover {
    background: #e2e8f0;
    border-color: #cbd5e1;
  }
  
  .reaction-item.dark {
    background: #334155;
    border-color: #475569;
    color: #e5e7eb;
  }
  
  .reaction-item.dark:hover {
    background: #475569;
    border-color: #64748b;
  }
  
  .reaction-picker {
    position: absolute;
    bottom: 100%;
    left: 0;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 8px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    display: flex;
    gap: 4px;
    z-index: 10;
  }
  
  .reaction-picker.dark {
    background: #1f2937;
    border-color: #374151;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
  }
  
  .reaction-emoji {
    padding: 4px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  
  .reaction-emoji:hover {
    background: #f3f4f6;
  }
  
  .reaction-emoji.dark:hover {
    background: #374151;
  }
  
  .reply-indicator {
    position: absolute;
    left: -8px;
    top: 50%;
    transform: translateY(-50%);
    width: 4px;
    height: 20px;
    background: #3b82f6;
    border-radius: 2px;
  }
  
  .thread-toggle {
    background: none;
    border: none;
    color: #64748b;
    cursor: pointer;
    font-size: 12px;
    padding: 2px 4px;
    border-radius: 4px;
    margin-top: 4px;
  }
  
  .thread-toggle:hover {
    background: #f1f5f9;
  }
  
  .thread-toggle.dark {
    color: #94a3b8;
  }
  
  .thread-toggle.dark:hover {
    background: #334155;
  }
  
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
    color: #64748b;
    font-size: 16px;
    text-align: center;
  }
  
  .empty-state.dark {
    color: #94a3b8;
  }
  
  .loading-messages {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
    color: #64748b;
  }
  
  .loading-messages.dark {
    color: #94a3b8;
  }
  
  .thread-summary {
    font-size: 12px;
    color: #64748b;
    margin-top: 4px;
    font-style: italic;
  }
  
  .thread-summary.dark {
    color: #94a3b8;
  }
`;

const MessageDisplay: React.FC<MessageDisplayProps> = ({
  messages = [],
  currentUserId,
  onReply,
  onQuote,
  onReaction,
  currentTheme
}) => {
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null);
  const [hoveredMessage, setHoveredMessage] = useState<string | null>(null);
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Build thread structure
  const buildThreadStructure = (): ThreadStructure => {
    const structure: ThreadStructure = {};
    const rootMessages: string[] = [];

    // First pass: organize messages and identify roots
    messages.forEach(message => {
      structure[message.message_id] = {
        message,
        children: [],
        level: message.thread_level || 0
      };

      if (!message.reply_to_id) {
        rootMessages.push(message.message_id);
      }
    });

    // Second pass: build parent-child relationships
    messages.forEach(message => {
      if (message.reply_to_id && structure[message.reply_to_id]) {
        structure[message.reply_to_id].children.push(message.message_id);
      }
    });

    return structure;
  };

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  };

  const handleReaction = (messageId: string, reactionType: string, event?: React.MouseEvent) => {
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

  const renderMessage = (messageId: string, structure: ThreadStructure, level = 0): React.ReactNode => {
    const item = structure[messageId];
    if (!item) return null;

    const message = item.message;
    const isOwnMessage = message.sender_id === currentUserId;
    const isCollapsed = collapsedThreads.has(messageId);
    const hasChildren = item.children.length > 0;

    return (
      <div key={messageId} className="message-item">
        <div 
          className={`message-bubble ${currentTheme} ${isOwnMessage ? 'own-message' : ''}`}
          onMouseEnter={() => setHoveredMessage(messageId)}
          onMouseLeave={() => setHoveredMessage(null)}
        >
          <div className="message-header">
            <span className={`message-author ${currentTheme}`}>
              {isOwnMessage ? 'You' : message.sender_id}
            </span>
            <span className={`message-timestamp ${currentTheme}`}>
              {formatTimestamp(message.timestamp)}
            </span>
            {message.reply_to_id && <div className="reply-indicator" />}
          </div>

          {message.quoted_text && (
            <div className={`quoted-message ${currentTheme}`}>
              {(() => {
                // Parse "Author: message text" format
                const colonIndex = message.quoted_text.indexOf(': ');
                if (colonIndex > 0 && colonIndex < message.quoted_text.length - 2) {
                  const author = message.quoted_text.substring(0, colonIndex);
                  const text = message.quoted_text.substring(colonIndex + 2);
                  return (
                    <>
                      <div className="quote-author">{author}</div>
                      <div className="quote-text">"{text}"</div>
                    </>
                  );
                } else {
                  // Fallback for messages that don't have the author format
                  return `"${message.quoted_text}"`;
                }
              })()}
            </div>
          )}

          <div className={`message-content ${currentTheme}`}>
            {message.content.text}
          </div>

          {message.reactions && Object.keys(message.reactions).length > 0 && (
            <div className="reactions">
              {Object.entries(message.reactions).map(([type, count]) => (
                count > 0 && (
                  <div
                    key={type}
                    className={`reaction-item ${currentTheme}`}
                    onClick={(event) => handleReaction(messageId, type, event)}
                  >
                    <span>{REACTION_EMOJIS[type as keyof typeof REACTION_EMOJIS] || type}</span>
                    <span>{count}</span>
                  </div>
                )
              ))}
            </div>
          )}

          <div className={`message-actions ${currentTheme} ${hoveredMessage === messageId ? 'visible' : ''}`}>
            <button
              className={`action-button ${currentTheme}`}
              onClick={() => onReply(messageId, message.content.text, message.sender_id)}
              title="Reply"
            >
              ↩️
            </button>
            <button
              className={`action-button ${currentTheme}`}
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
              className={`action-button ${currentTheme}`}
              onClick={() => onQuote(messageId, message.content.text, message.sender_id)}
              title="Quote message"
            >
              💬
            </button>
          </div>

          {showReactionPicker === messageId && (
            <div className={`reaction-picker ${currentTheme}`}>
              {Object.entries(REACTION_EMOJIS).slice(0, 8).map(([type, emoji]) => (
                <div
                  key={type}
                  className={`reaction-emoji ${currentTheme}`}
                  onClick={(event) => handleReaction(messageId, type, event)}
                >
                  {emoji}
                </div>
              ))}
            </div>
          )}

          {hasChildren && (
            <button
              className={`thread-toggle ${currentTheme}`}
              onClick={() => toggleThread(messageId)}
            >
              {isCollapsed ? `▶ Show ${item.children.length} replies` : `▼ Hide replies`}
            </button>
          )}

          {hasChildren && !isCollapsed && (
            <div className={`thread-summary ${currentTheme}`}>
              {item.children.length} {item.children.length === 1 ? 'reply' : 'replies'}
            </div>
          )}
        </div>

        {/* Render child messages */}
        {hasChildren && !isCollapsed && level < 4 && (
          <div className={`message-thread ${currentTheme} level-${level + 1}`}>
            {item.children.map(childId => 
              renderMessage(childId, structure, level + 1)
            )}
          </div>
        )}


      </div>
    );
  };

  if (messages.length === 0) {
    return (
      <div className={`message-display ${currentTheme}`}>
        <style>{styles}</style>
        <div className={`empty-state ${currentTheme}`}>
          <div>
            <div>No messages yet</div>
            <div style={{ fontSize: '14px', marginTop: '8px' }}>
              Start a conversation!
            </div>
          </div>
        </div>
      </div>
    );
  }

  const threadStructure = buildThreadStructure();
  const rootMessages = messages
    .filter(m => !m.reply_to_id)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return (
    <div className={`message-display ${currentTheme}`}>
      <style>{styles}</style>
      
      {rootMessages.map(message => 
        renderMessage(message.message_id, threadStructure)
      )}
      
      <div ref={messagesEndRef} />
    </div>
  );
};



export default MessageDisplay;
