import React, { useState, useRef } from 'react';

interface AgentInfo {
  agent_id: string;
  display_name?: string;
  status?: string;
}

interface ThreadMessageInputProps {
  onSendMessage: (text: string, replyTo?: string, quotedMessageId?: string) => void;
  currentTheme: 'light' | 'dark';
  placeholder?: string;
  disabled?: boolean;
  agents?: AgentInfo[];
  replyingTo?: {
    messageId: string;
    text: string;
    author: string;
  } | null;
  quotingMessage?: {
    messageId: string;
    text: string;
    author: string;
  } | null;
  onCancelReply?: () => void;
  onCancelQuote?: () => void;
}

const styles = `
  .thread-input-container {
    background: #ffffff;
    border-top: 1px solid #e2e8f0;
    padding: 16px;
  }
  
  .thread-input-container.dark {
    background: #1e293b;
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
    position: relative;
  }
  
  .message-textarea {
    width: 100%;
    min-height: 44px;
    max-height: 200px;
    padding: 12px 60px 12px 16px;
    border: 1px solid #d1d5db;
    border-radius: 24px;
    resize: none;
    font-family: inherit;
    font-size: 15px;
    line-height: 1.4;
    background: #ffffff;
    color: #374151;
    transition: all 0.15s ease;
  }
  
  .message-textarea:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }
  
  .message-textarea.dark {
    background: #374151;
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
  }
  
  .mention-name.dark {
    color: #f3f4f6;
  }
`;

const MAX_MESSAGE_LENGTH = 2000;

const ThreadMessageInput: React.FC<ThreadMessageInputProps> = ({
  onSendMessage,
  currentTheme,
  placeholder = 'Type a message...',
  disabled = false,
  agents = [],
  replyingTo,
  quotingMessage,
  onCancelReply,
  onCancelQuote
}) => {
  const [message, setMessage] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !disabled) {
      onSendMessage(
        message.trim(),
        replyingTo?.messageId,
        quotingMessage?.messageId
      );
      setMessage('');
      adjustTextareaHeight();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle mention navigation
    if (showMentions && filteredAgents.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedMentionIndex(prev => 
          prev < filteredAgents.length - 1 ? prev + 1 : 0
        );
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedMentionIndex(prev => 
          prev > 0 ? prev - 1 : filteredAgents.length - 1
        );
        return;
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (filteredAgents[selectedMentionIndex]) {
          insertMention(filteredAgents[selectedMentionIndex]);
        }
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentions(false);
        setMentionFilter('');
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    } else if (e.key === 'Escape') {
      if (quotingMessage && onCancelQuote) {
        onCancelQuote();
      } else if (replyingTo && onCancelReply) {
        onCancelReply();
      }
    }
  };

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    if (newValue.length <= MAX_MESSAGE_LENGTH) {
      setMessage(newValue);
      adjustTextareaHeight();
      
      // Check for mentions
      const lastWord = newValue.split(' ').pop() || '';
      if (lastWord.startsWith('@')) {
        const filter = lastWord.substring(1); // Remove the @ symbol
        setMentionFilter(filter);
        setShowMentions(true);
        setSelectedMentionIndex(0);
      } else {
        setShowMentions(false);
        setMentionFilter('');
      }
    }
  };

  // Filter agents based on mention input
  const filteredAgents = agents.filter(agent => {
    if (!mentionFilter) return true;
    const displayName = agent.display_name || agent.agent_id;
    return displayName.toLowerCase().includes(mentionFilter.toLowerCase()) ||
           agent.agent_id.toLowerCase().includes(mentionFilter.toLowerCase());
  });

  const handleFileUpload = () => {
    fileInputRef.current?.click();
  };

  const insertMention = (agent: AgentInfo) => {
    const displayName = agent.display_name || agent.agent_id;
    const words = message.split(' ');
    words[words.length - 1] = `@${displayName} `;
    const newMessage = words.join(' ');
    setMessage(newMessage);
    setShowMentions(false);
    setMentionFilter('');
    
    // Focus back on textarea
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  };

  const handleMentionClick = (agent: AgentInfo) => {
    insertMention(agent);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // File upload logic would go here
      console.log('File selected:', file.name);
      // For now, just add file name to message
      setMessage(prev => prev + ` [File: ${file.name}]`);
    }
  };

  const getCharacterCountClass = () => {
    const length = message.length;
    if (length > MAX_MESSAGE_LENGTH * 0.9) return 'error';
    if (length > MAX_MESSAGE_LENGTH * 0.8) return 'warning';
    return '';
  };

  return (
    <div className={`thread-input-container ${currentTheme}`}>
      <style>{styles}</style>
      
      {replyingTo && (
        <div className={`reply-preview ${currentTheme}`}>
          <div className="reply-header">
            <div className={`reply-label ${currentTheme}`}>
              ↪️ Replying to {replyingTo.author}
            </div>
            {onCancelReply && (
              <button
                className={`cancel-reply ${currentTheme}`}
                onClick={onCancelReply}
                title="Cancel reply"
              >
                ✕
              </button>
            )}
          </div>
          <div className={`reply-text ${currentTheme}`}>
            {replyingTo.text.length > 100 
              ? `${replyingTo.text.substring(0, 100)}...` 
              : replyingTo.text
            }
          </div>
        </div>
      )}
      
      {quotingMessage && (
        <div className={`quote-preview ${currentTheme}`}>
          <div className="quote-header">
            <div className={`quote-label ${currentTheme}`}>
              💬 Quoting {quotingMessage.author}
            </div>
            {onCancelQuote && (
              <button
                className={`cancel-quote ${currentTheme}`}
                onClick={onCancelQuote}
                title="Cancel quote"
              >
                ✕
              </button>
            )}
          </div>
          <div className={`reply-text ${currentTheme}`}>
            {quotingMessage.text.length > 100 
              ? `${quotingMessage.text.substring(0, 100)}...` 
              : quotingMessage.text
            }
          </div>
        </div>
      )}
      
      <form onSubmit={handleSubmit}>
        <div className="input-area">
          {showMentions && filteredAgents.length > 0 && (
            <div className={`mention-suggestions ${currentTheme}`}>
              {filteredAgents.map((agent, index) => {
                const displayName = agent.display_name || agent.agent_id;
                const avatar = displayName.charAt(0).toUpperCase();
                const isSelected = index === selectedMentionIndex;
                
                return (
                  <div 
                    key={agent.agent_id}
                    className={`mention-item ${currentTheme} ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleMentionClick(agent)}
                  >
                    <div className={`mention-avatar ${currentTheme}`}>{avatar}</div>
                    <div className={`mention-name ${currentTheme}`}>{displayName}</div>
                  </div>
                );
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
            <button
              type="button"
              className={`action-button ${currentTheme}`}
              onClick={handleFileUpload}
              disabled={disabled}
              title="Upload file"
            >
              📎
            </button>
            
            <button
              type="button"
              className={`action-button ${currentTheme}`}
              disabled={disabled}
              title="Add emoji"
            >
              😊
            </button>
            
            <button
              type="submit"
              className="send-button"
              disabled={!message.trim() || disabled}
              title="Send message"
            >
              ↗
            </button>
          </div>
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
  );
};

export default ThreadMessageInput;




