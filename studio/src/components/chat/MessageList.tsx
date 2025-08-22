import React, { useRef, useEffect, useState } from 'react';
import MessageBubble from './MessageBubble';
import { Message, ToolSectionsMap } from '../../types';

interface MessageListProps {
  messages: Message[];
  streamingMessageId?: string | null;
  toolSections?: ToolSectionsMap;
  forceRender?: number;
  isAutoScrollingDisabled?: boolean;
  onUserScroll?: (hasScrolled: boolean) => void;
}

const MessageList: React.FC<MessageListProps> = ({ 
  messages, 
  streamingMessageId, 
  toolSections,
  isAutoScrollingDisabled = false,
  onUserScroll
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevMessagesLengthRef = useRef<number>(0);
  const prevMessagesIdRef = useRef<string | null>(null);
  
  // Track if this is a new conversation to force scroll
  const [isNewConversation, setIsNewConversation] = useState(false);
  
  // 添加用户滚动状态跟踪
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const isProgrammaticScrollRef = useRef<boolean>(false);
  
  // Track if we're currently in a conversation change
  useEffect(() => {
    if (messages.length > 0) {
      const firstMsgId = messages[0]?.id;
      // Check if we've switched to a different conversation
      if (prevMessagesIdRef.current && firstMsgId && prevMessagesIdRef.current !== firstMsgId) {
        console.log('Detected conversation change, will force scroll to bottom');
        setIsNewConversation(true);
        // 在会话切换时重置用户滚动状态
        setUserHasScrolled(false);
      }
      // Update the reference
      prevMessagesIdRef.current = firstMsgId;
    }
  }, [messages]);

  // 如果ChatView传入了isAutoScrollingDisabled，则同步本地状态
  useEffect(() => {
    if (isAutoScrollingDisabled) {
      setUserHasScrolled(true);
    }
  }, [isAutoScrollingDisabled]);

  // 添加滚动监听器来检测用户滚动
  useEffect(() => {
    const messageContainer = containerRef.current;
    if (!messageContainer) return;
    
    const handleScroll = () => {
      // 如果不是程序触发的滚动事件
      if (!isProgrammaticScrollRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = messageContainer;
        const scrollBottom = scrollTop + clientHeight;
        
        // 如果用户向上滚动超过100px，则标记为用户已滚动
        if (scrollHeight - scrollBottom > 100) {
          setUserHasScrolled(true);
          // 通知父组件用户已滚动
          onUserScroll?.(true);
        } 
        // 如果用户滚动到接近底部，则重置状态
        else if (scrollHeight - scrollBottom < 30) {
          setUserHasScrolled(false);
          // 通知父组件用户已滚动到底部
          onUserScroll?.(false);
        }
      }
    };
    
    messageContainer.addEventListener('scroll', handleScroll);
    return () => messageContainer.removeEventListener('scroll', handleScroll);
  }, [onUserScroll]);

  // 增强滚动逻辑：检测是否有新消息、对话变更或正在流式接收
  useEffect(() => {
    const prevLength = prevMessagesLengthRef.current || 0;
    
    // 使用本地userHasScrolled状态和从ChatView传入的isAutoScrollingDisabled
    const isScrollDisabled = userHasScrolled || isAutoScrollingDisabled;
    
    // 只有在以下情况才滚动到底部：
    // 1. 新对话
    // 2. 有新消息添加（非流式更新）且滚动未禁用
    // 3. 流式接收中，但滚动未禁用
    const shouldScroll = isNewConversation || 
                        (messages.length > prevLength && !isScrollDisabled) || 
                        (!!streamingMessageId && !isScrollDisabled);
    
    if (shouldScroll) {
      console.log(`Scrolling messages to bottom: new=${isNewConversation}, prev=${prevLength}, curr=${messages.length}, streaming=${!!streamingMessageId}, userScrolled=${userHasScrolled}, disabled=${isAutoScrollingDisabled}`);
      scrollToBottom();
      
      // Reset the new conversation flag
      if (isNewConversation) {
        setIsNewConversation(false);
      }
    }
    
    // 更新前一次的消息长度引用
    prevMessagesLengthRef.current = messages.length;
  }, [messages, streamingMessageId, isNewConversation, userHasScrolled, isAutoScrollingDisabled]);

  const scrollToBottom = (): void => {
    if (!containerRef.current) return;
    
    // 标记为程序触发的滚动，避免触发用户滚动检测
    isProgrammaticScrollRef.current = true;
    
    // 立即滚动到底部，使用100ms延迟确保布局已完成
    setTimeout(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
      
      // 重置滚动标志
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 50);
    }, 100);
  };

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className="messages-container flex-1 overflow-y-auto h-full py-4 px-6"
    >
      <div className="flex flex-col items-start space-y-4">
        {messages.map((message) => {
          const messageId = message.id;
          const isStreaming = streamingMessageId === messageId;
          
          // 获取消息的工具部分（如果有）
          const messageToolSections = toolSections && toolSections[messageId] ? toolSections[messageId] : [];
          
          return (
            <MessageBubble
              key={messageId}
              message={message}
              isStreaming={isStreaming}
              toolSections={messageToolSections}
            />
          );
        })}
      </div>
      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageList; 