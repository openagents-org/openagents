import React, { useRef, useEffect } from 'react';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';

interface MessageInputProps {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => Promise<void>;
  onStopGeneration?: () => Promise<void>;
  isLoading: boolean;
  onDeleteConversation?: () => void;
  currentTheme: 'light' | 'dark';
}

const MessageInput: React.FC<MessageInputProps> = ({
  value,
  onChange,
  onKeyDown,
  onSend,
  onStopGeneration,
  isLoading,
  onDeleteConversation,
  currentTheme
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const { confirm } = useConfirm();

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const maxHeight = 200;
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`;
    }
  }, [value]);

  // Handle KeyDown events, supporting Shift+Enter for new line
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading && value.trim()) {
        // 立即清空输入框，然后发送消息
        const currentValue = value;
        handleClearInput();
        void onSend();
      }
    }
    
    // Call external onKeyDown if provided
    if (onKeyDown) {
      onKeyDown(e);
    }
  };

  // Handle conversation delete with confirmation
  const handleDeleteConversation = async () => {
    const confirmed = await confirm(
      'Delete Conversation',
      'Are you sure you want to delete this conversation? This action cannot be undone.',
      { 
        confirmText: 'Delete', 
        cancelText: 'Cancel',
        type: 'danger'
      }
    );
    
    if (confirmed && onDeleteConversation) {
      onDeleteConversation();
    }
  };

  // Clear input field
  const handleClearInput = () => {
    const newEvent = {
      target: { value: '' }
    } as React.ChangeEvent<HTMLTextAreaElement>;
    onChange(newEvent);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  // Handle text file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Only accept text files
    if (!file.type.includes('text')) {
      toast.warning('Please upload a text file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        const fileContent = event.target.result as string;
        const newEvent = {
          target: { value: value + (value ? '\n\n' : '') + fileContent }
        } as React.ChangeEvent<HTMLTextAreaElement>;
        onChange(newEvent);
        toast.success('File uploaded successfully');
      }
    };
    reader.readAsText(file);
    
    // Reset file input
    e.target.value = '';
  };

  // Handle image upload
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Only accept images
    if (!file.type.includes('image')) {
      toast.warning('Please upload an image file');
      return;
    }

    // For now, just add a placeholder text since we don't have image upload API integrated
    const newEvent = {
      target: { value: value + (value ? '\n\n' : '') + `[Uploading image: ${file.name}]` }
    } as React.ChangeEvent<HTMLTextAreaElement>;
    onChange(newEvent);
    toast.info(`Image ${file.name} selected`);
    
    // Reset file input
    e.target.value = '';
  };

  return (
    <div className="relative">
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-600 transition-all duration-200 focus-within:border-blue-500 dark:focus-within:border-blue-400">
        {/* 输入区 */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={onChange}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          rows={1}
          className="w-full resize-none overflow-y-auto px-4 py-3 max-h-40 border-0 bg-transparent text-base text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-0 focus:outline-none font-normal leading-relaxed rounded-xl"
          disabled={isLoading}
          aria-label="Message input"
          style={{ minHeight: 44 }}
        />
        
        {/* 工具栏 */}
        <div className="flex items-center justify-between px-3 pb-3">
          <div className="flex items-center gap-1">
            {/* 清除输入 */}
            {value && !isLoading && (
              <button 
                onClick={handleClearInput}
                className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200"
                title="清除输入"
                type="button"
                aria-label="Clear input"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            )}
            {/* 删除对话 */}
            {onDeleteConversation && (
              <button 
                onClick={handleDeleteConversation}
                className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-200"
                title="删除对话"
                type="button"
                aria-label="Delete conversation"
                disabled={isLoading}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            )}
            {/* 上传文本文件 */}
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all duration-200"
              title="上传文本文件"
              type="button"
              aria-label="Upload text file"
              disabled={isLoading}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".txt,.md,.js,.py,.html,.css,.json,.csv"
              className="hidden"
              aria-hidden="true"
            />
            {/* 上传图片 */}
            <button 
              onClick={() => imageInputRef.current?.click()}
              className="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-green-500 dark:hover:text-green-400 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 transition-all duration-200"
              title="上传图片"
              type="button"
              aria-label="Upload image"
              disabled={isLoading}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            </button>
            <input
              type="file"
              ref={imageInputRef}
              onChange={handleImageUpload}
              accept="image/*"
              className="hidden"
              aria-hidden="true"
            />
          </div>
          
          {/* 发送/停止按钮 */}
          <button
            onClick={() => {
              if (isLoading && onStopGeneration) {
                void onStopGeneration();
              } else if (!isLoading && value.trim()) {
                // 立即清空输入框
                const currentValue = value;
                handleClearInput();
                // 然后发送消息
                void onSend();
              }
            }}
            disabled={!isLoading && !value.trim()}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 ${
              isLoading 
                ? 'bg-red-500 hover:bg-red-600 text-white shadow-md hover:shadow-lg' 
                : value.trim()
                ? 'bg-blue-500 hover:bg-blue-600 text-white shadow-md hover:shadow-lg hover:scale-105'
                : 'bg-gray-200 dark:bg-gray-600 text-gray-400 cursor-not-allowed'
            }`}
            aria-label={isLoading ? "停止生成" : "发送消息"}
            type="button"
          >
            {isLoading ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MessageInput; 