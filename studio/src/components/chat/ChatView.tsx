import React, { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import { sendChatMessage, abortChatMessage } from '../../utils/api';
import { Message, ConversationMessages, ChatViewProps, ToolSectionsMap, ToolSection } from '../../types';
// Remove Firebase import

// 现代化简洁设计的CSS样式
const styles = `
  .chat-view-container {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #fafafa;
  }
  
  .chat-view-container.dark {
    background: #1a1a1a;
  }
  
  .messages-container {
    flex: 1;
    height: 100%;
    overflow-y: auto;
    scroll-behavior: smooth;
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE and Edge */
  }
  
  .messages-container::-webkit-scrollbar {
    display: none; /* Chrome, Safari, Opera */
  }
  
  .scroll-button {
    position: absolute;
    bottom: 90px;
    right: 16px;
    width: 40px;
    height: 40px;
    background: #ffffff;
    color: #6366f1;
    border-radius: 20px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    transition: all 0.2s ease;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
  }
  
  .scroll-button:hover {
    background: #f8fafc;
    transform: translateY(-1px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  }
  
  .dark .scroll-button {
    background: #374151;
    color: #a855f7;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }
  
  .dark .scroll-button:hover {
    background: #4b5563;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }
  
  .loading-indicator {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 24px;
    color: #6b7280;
    font-size: 14px;
    font-weight: 500;
  }
  
  .dark .loading-indicator {
    color: #9ca3af;
  }
  
  .error-message {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #dc2626;
    padding: 16px;
    margin: 16px;
    border-radius: 12px;
    font-size: 14px;
    line-height: 1.5;
  }
  
  .dark .error-message {
    background: #1f2937;
    border: 1px solid #374151;
    color: #f87171;
  }

  .chat-input-area {
    background: #ffffff;
    border-top: 1px solid #e5e7eb;
    padding: 16px;
    margin: 0;
  }
  
  .dark .chat-input-area {
    background: #1f2937;
    border-top: 1px solid #374151;
  }
  
  .loading-spinner {
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  .fade-in {
    animation: fadeIn 0.3s ease-in-out;
  }
  
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;

const ChatView: React.FC<ChatViewProps> = ({ 
  conversationId, 
  onMessagesUpdate,
  onDeleteConversation,
  currentTheme
}) => {
  const [messages, setMessages] = useState<ConversationMessages>({});
  const [currentMessage, setCurrentMessage] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [isSessionLoading, setIsSessionLoading] = useState<boolean>(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [toolSections, setToolSections] = useState<ToolSectionsMap>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // 滚动相关状态和refs
  const isProgrammaticScrollRef = useRef<boolean>(false);
  const isAutoScrollingRef = useRef<boolean>(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  
  // 当前显示的会话ID - 简化为普通状态
  const [displayedConversationId, setDisplayedConversationId] = useState<string | null>(null);

  // 字符缓存池相关状态
  const charPoolRef = useRef<string>('');
  const displayIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentTextRef = useRef<string>('');
  const isStreamingRef = useRef<boolean>(false);
  const assistantMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    console.log(`theme:${currentTheme} ChatView`);
  }, [currentTheme]);

  // 处理流式字符显示的函数
  const processCharPool = useCallback(() => {
    if (!isStreamingRef.current || !assistantMessageIdRef.current) {
      if (displayIntervalRef.current) {
        clearInterval(displayIntervalRef.current);
        displayIntervalRef.current = null;
      }
      return;
    }

    if (charPoolRef.current && charPoolRef.current.length > 0) {
      // 随机确定每次要显示的字符数量，使打字看起来更自然
      // 大部分时间显示1个字符，有时候显示2-3个字符，偶尔暂停一下
      const randomFactor = Math.random();
      let charsToShow = 1;
      
      if (randomFactor > 0.85) { // 15%的情况显示2-3个字符
        charsToShow = randomFactor > 0.95 ? 3 : 2; // 10%显示2个，5%显示3个
      } else if (randomFactor < 0.05) { // 5%的情况暂停一下，不显示字符
        charsToShow = 0;
      }
      
      // 确保不超过可用字符数
      charsToShow = Math.min(charsToShow, charPoolRef.current.length);
      
      if (charsToShow > 0) {
        // 提取要显示的字符
        const nextChars = charPoolRef.current.substring(0, charsToShow);
        
        // 更新缓存池，移除已显示的字符
        charPoolRef.current = charPoolRef.current.substring(charsToShow);
        
        // 更新当前显示的文本
        if (currentTextRef.current !== null) {
          currentTextRef.current += nextChars;
        }
        
        // 更新UI上的消息文本
        setMessages(prevMessages => {
          const currentMessages = [...(prevMessages[conversationId] || [])];
          const msgId = assistantMessageIdRef.current || '';
          const assistantMsgIndex = currentMessages.findIndex(m => m.id === msgId);
          
          if (assistantMsgIndex >= 0 && currentTextRef.current !== null) {
            currentMessages[assistantMsgIndex] = {
              ...currentMessages[assistantMsgIndex],
              text: currentTextRef.current
            };
          }
          
          return {
            ...prevMessages,
            [conversationId]: currentMessages
          };
        });
        
        // 如果自动滚动启用，滚动到底部
        if (isAutoScrollingRef.current) {
          scrollToBottom(false);
        }
      }
    }
  }, [conversationId]);

  // 开始字符池处理
  const startCharPoolProcessing = useCallback((messageId: string) => {
    // 清空当前文本
    currentTextRef.current = '';
    
    // 设置流式状态
    isStreamingRef.current = true;
    assistantMessageIdRef.current = messageId;
    
    // 清除可能存在的定时器
    if (displayIntervalRef.current) {
      clearInterval(displayIntervalRef.current);
    }
    
    // 创建新的定时器，每18-20ms处理一次字符池（稍微随机化时间间隔）
    // 这会让打字看起来更自然，不是机械的节奏
    const interval = 18 + Math.floor(Math.random() * 3);
    displayIntervalRef.current = setInterval(processCharPool, interval);
  }, [processCharPool]);

  // 停止字符池处理
  const stopCharPoolProcessing = useCallback(() => {
    isStreamingRef.current = false;
    assistantMessageIdRef.current = null;
    
    // 强制显示剩余字符
    if (charPoolRef.current && charPoolRef.current.length > 0 && currentTextRef.current !== null) {
      currentTextRef.current += charPoolRef.current;
      charPoolRef.current = '';
      
      setMessages(prevMessages => {
        const currentMessages = [...(prevMessages[conversationId] || [])];
        const msgId = streamingMessageId || '';
        const assistantMsgIndex = currentMessages.findIndex(m => m.id === msgId);
        
        if (assistantMsgIndex >= 0 && currentTextRef.current !== null) {
          currentMessages[assistantMsgIndex] = {
            ...currentMessages[assistantMsgIndex],
            text: currentTextRef.current
          };
        }
        
        return {
          ...prevMessages,
          [conversationId]: currentMessages
        };
      });
    }
    
    // 清除定时器
    if (displayIntervalRef.current) {
      clearInterval(displayIntervalRef.current);
      displayIntervalRef.current = null;
    }
  }, [conversationId, streamingMessageId]);

  // 在组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (displayIntervalRef.current) {
        clearInterval(displayIntervalRef.current);
      }
    };
  }, []);

  // 处理会话切换 - 简化后不再使用动画效果
  useEffect(() => {
    if (!conversationId) return;
    
    // 如果与当前显示的会话相同，不需要任何操作
    if (displayedConversationId === conversationId) return;
    
    // 会话ID变化，直接加载新会话
    const switchSession = async () => {
      console.log(`Switching session from ${displayedConversationId} to ${conversationId}`);
      await loadSession(conversationId);
      setDisplayedConversationId(conversationId);
      
      // Always ensure we scroll to bottom after switching sessions
      setTimeout(() => {
        scrollToBottom(true);
      }, 200);
    };
    
    switchSession();
  }, [conversationId]);

  // 分离会话加载逻辑以便重用 - 修改以恢复工具部分信息
  const loadSession = async (sessionId: string) => {
    if (!sessionId || sessionId.startsWith('__tmp')) {
      console.log("Invalid or temporary sessionId, skipping load.");
      return;
    }
    
    console.log(`Loading messages for session: ${sessionId}`);
    setIsSessionLoading(true);
    setSessionError(null);
    
    try {
      // Load session without authentication for now
      console.log(`Loading session: ${conversationId}`);
      
      // For now, initialize with empty messages - this would be replaced with OpenAgents network API calls
      setMessages(prev => ({
        ...prev,
        [conversationId]: []
      }));
      
      return; // Skip backend loading for now
      
      // This would be the actual API call to OpenAgents network
      const response = await fetch(`/api/user/session/${sessionId}`, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const sessionData = await response.json();
        
        // 处理消息数组
        let messagesArray = sessionData.messages || [];
        
        if (!Array.isArray(messagesArray)) {
          console.warn(`Invalid messages format for ${sessionId}, expected array but got:`, typeof messagesArray);
          messagesArray = [];
        }
        
        console.log(`Loaded ${messagesArray.length} messages for session ${sessionId}`);
        
        const validMessages = messagesArray.filter((msg: any) => 
          msg && msg.id && typeof msg.text === 'string' && msg.sender && msg.timestamp
        );
        
        if (validMessages.length !== messagesArray.length) {
          console.warn(`Filtered out ${messagesArray.length - validMessages.length} invalid messages`);
        }
        
        // 恢复工具部分信息
        const recoveredToolSections: ToolSectionsMap = {};
        
        validMessages.forEach((msg: Message) => {
          if (msg.toolMetadata && Array.isArray(msg.toolMetadata.sections)) {
            recoveredToolSections[msg.id] = msg.toolMetadata.sections;
          }
        });
        
        // 更新工具部分状态
        if (Object.keys(recoveredToolSections).length > 0) {
          console.log('Recovered tool sections:', recoveredToolSections);
          setToolSections(prev => ({
            ...prev,
            ...recoveredToolSections
          }));
        }
        
        // 更新状态，保留其他会话的消息
        setMessages(prevMessages => {
          const newMessages = { ...prevMessages, [sessionId]: validMessages };
          
          if (onMessagesUpdate) {
            setTimeout(() => onMessagesUpdate(newMessages), 0);
          }
          
          return newMessages;
        });
        
        setSessionError(null);
      } else {
        if (response.status === 404) {
          console.log(`Session ${sessionId} not found, treating as new conversation`);
          setMessages(prevMessages => ({ ...prevMessages, [sessionId]: [] }));
        } else {
          const errorText = await response.text();
          console.error(`Failed to load conversation: ${response.status} ${response.statusText} - ${errorText}`);
          setSessionError(`Failed to load conversation: ${response.statusText || response.status}`);
          setMessages(prevMessages => ({ ...prevMessages, [sessionId]: [] }));
        }
      }
    } catch (networkError: any) {
      console.error(`Network error loading session ${sessionId}:`, networkError);
      setSessionError(`Network error: ${networkError.message || "Failed to connect"}`);
      setMessages(prevMessages => ({ ...prevMessages, [sessionId]: [] }));
    } finally {
      setIsSessionLoading(false);
      
      // 会话加载完成后，确保滚动到底部
      setTimeout(() => {
        scrollToBottom(true);
      }, 150);
    }
  };

  // Save messages to backend - 保持不变
  const saveMessages = useCallback(async (messagesData: ConversationMessages) => {
    if (!conversationId || conversationId.startsWith('__tmp')) return;
    
    const currentConversationMessages = messagesData[conversationId] || [];
    console.log(`Attempting to save ${currentConversationMessages.length} messages for conversation ${conversationId}`);

    try {
      // Save messages without authentication for now
      console.log(`Saving messages for conversation: ${conversationId}`);
        
      const firstUserMessage = currentConversationMessages.find(msg => msg.sender === 'user');
      let title = conversationId;
      if (firstUserMessage) {
        title = firstUserMessage.text.substring(0, 30).trim();
        if (firstUserMessage.text.length > 30) title += '...';
      }
      if (!title) title = "New Chat";
        
      const sessionData = {
        id: conversationId,
        title: title,
        messages: currentConversationMessages,
      };

      const response = await fetch(`/api/user/session/${conversationId}`, {
        method: 'POST',
                  headers: {
            'Content-Type': 'application/json'
          },
        body: JSON.stringify(sessionData)
      });
      
      if (response.ok) {
        console.log(`Successfully saved conversation ${conversationId}`);
      } else {
        const errorText = await response.text();
        console.error(`Error saving session ${conversationId}: ${response.status} ${response.statusText}`, errorText);
      }
    } catch (error: any) {
      console.error(`Network error saving session ${conversationId}:`, error);
    }
  }, [conversationId]);

  // 滚动逻辑保持不变
  const scrollToBottom = (force = false) => {
    const messagesContainer = messagesEndRef.current?.parentElement;
    if (!messagesContainer) return;

    // Only auto-scroll if enabled or forced
    if (!isAutoScrollingRef.current && !force) return;

    // Skip auto-scrolling during streaming if user has manually scrolled
    if (streamingMessageId && !force && !isAutoScrollingRef.current) return;

    // Set flag to indicate this is a programmatic scroll
    isProgrammaticScrollRef.current = true;

    // Scroll immediately with no animation
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    // Reset the flag after scroll would have completed
    setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 100);
  };

  // Update the scroll handler to ignore events during programmatic scrolling
  useEffect(() => {
    const messagesContainer = messagesEndRef.current?.parentElement;
    if (!messagesContainer) return;
    
    const handleScroll = () => {
      // Skip processing if this was triggered by our own programmatic scroll
      if (isProgrammaticScrollRef.current) {
        return;
      }
      
      const { scrollTop, scrollHeight, clientHeight } = messagesContainer;
      const scrollBottom = scrollTop + clientHeight;
      const isNearBottom = scrollHeight - scrollBottom < 100;
      
      // If we're near the bottom (within 100px), enable auto-scrolling
      if (isNearBottom) {
        isAutoScrollingRef.current = true;
        setShowScrollButton(false);
      } 
      // For any other scroll position, disable auto-scrolling
      else {
        isAutoScrollingRef.current = false;
        setShowScrollButton(true);
        
        // Ensure this value persists during streaming
        if (streamingMessageId) {
          console.log('User scrolled during streaming - disabling auto-scroll');
        }
      }
    };
    
    messagesContainer.addEventListener('scroll', handleScroll);
    return () => messagesContainer.removeEventListener('scroll', handleScroll);
  }, [streamingMessageId]);

  // Track streaming state changes
  useEffect(() => {
    // When streaming starts, we want to reset the auto-scrolling state
    if (streamingMessageId) {
      console.log('Streaming started for message:', streamingMessageId);
    } else {
      console.log('Streaming ended');
    }
  }, [streamingMessageId]);

  // 仅在切换会话时滚动到底部
  useEffect(() => {
    if (!isSessionLoading && conversationId) {
      // 延迟执行滚动，确保DOM更新后再滚动
      setTimeout(() => {
        scrollToBottom(true);
      }, 150);
    }
  }, [conversationId, isSessionLoading]);

  // 处理发送消息事件
  const sendMessage = async (): Promise<void> => {
    if (!currentMessage.trim() || isSending) return;
    
    try {
      setIsSending(true);
      
      // Generate a unique ID for the message
      const userMessageId = uuidv4();
      const assistantMessageId = uuidv4();
      
      // 添加用户消息，使用函数式更新
      setMessages(prevMessages => {
        const currentSessionMessages = prevMessages[conversationId] || [];
        
        const userMessage: Message = {
          id: userMessageId,
          text: currentMessage,
          sender: 'user',
          timestamp: new Date().toISOString()
        };
        
        return {
          ...prevMessages,
          [conversationId]: [...currentSessionMessages, userMessage]
        };
      });
      
      // 添加用户消息后强制滚动到底部
      setTimeout(() => scrollToBottom(true), 50);
      
      // 添加助手消息，使用setTimeout分离状态更新
      setTimeout(() => {
        setMessages(prevMessages => {
          const currentSessionMessages = prevMessages[conversationId] || [];
          
          const assistantMessage: Message = {
            id: assistantMessageId,
            text: '',
            sender: 'assistant',
            timestamp: new Date().toISOString()
          };
          
          return {
            ...prevMessages,
            [conversationId]: [...currentSessionMessages, assistantMessage]
          };
        });
        
        setStreamingMessageId(assistantMessageId);
        
        // 开始字符池处理
        charPoolRef.current = ''; // 清空字符池
        startCharPoolProcessing(assistantMessageId);
        
        // 助手消息添加后也滚动到底部
        setTimeout(() => scrollToBottom(true), 50);
        
        // 重置自动滚动标志，以便在用户发送新消息时开始响应
        isAutoScrollingRef.current = true;
        setShowScrollButton(false);
      }, 100);

      try {
        // Send request without authentication for now
        console.log("Sending chat message to OpenAgents network");
        
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: currentMessage,
            conversationId: conversationId,
            messageId: assistantMessageId,
            streamOutput: true
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Server error: ${response.status} ${errorText}`);
        }
        
        const reader = response.body?.getReader();
        
        if (!reader) {
          throw new Error('Stream response not available');
        }
        
        let accumulatedText = '';
        let partialLine = '';
        let messageToolSections: ToolSection[] = [];

        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            break;
          }
          
          const text = new TextDecoder().decode(value);
          const lines = (partialLine + text).split('\n');
          
          // 可能存在不完整的行，保留最后一行直到下一批数据到达
          partialLine = lines.pop() || '';
          
          for (const line of lines) {
            if (!line.trim()) continue; // 跳过空行
            
            try {
              const data = JSON.parse(line);
              
              if (data.type === 'start') {
                // 开始事件
                console.log('Stream started for message:', assistantMessageId);
              }
              else if (data.type === 'chunk') {
                const messageText = data.chunk || '';
                
                // 检查是否为工具相关的消息
                const isToolMessage = data.metadata && data.metadata.type && 
                  (data.metadata.type.startsWith('tool_') || data.metadata.type === 'tool_notice');
                
                // 只有非工具相关的消息才添加到主文本中
                if (!isToolMessage) {
                  // 将收到的文本添加到字符池而不是直接更新文本
                  if (charPoolRef.current !== null) {
                    charPoolRef.current += messageText;
                  }
                  accumulatedText += messageText;
                }
                
                // 如果有工具元数据，处理它
                if (data.metadata && data.metadata.type && data.metadata.type.startsWith('tool_')) {
                  console.log('Tool metadata received:', data.metadata);
                  
                  // 创建或更新工具部分
                  const toolType = data.metadata.type;
                  const toolId = data.metadata.tool?.id || `tool_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                  const toolName = data.metadata.tool?.name || 'Unknown Tool';
                  
                  setToolSections(prev => {
                    const messageSections = prev[assistantMessageId] || [];
                    let updatedSections = [...messageSections];
                    
                    // 检查是否已有此工具的部分
                    const existingToolIndex = messageSections.findIndex(
                      section => section.name === toolName
                    );
                    
                    // 创建工具部分
                    let newSection: ToolSection;
                    
                    if (existingToolIndex >= 0) {
                      // 更新现有工具部分
                      newSection = {
                        ...updatedSections[existingToolIndex],
                        type: toolType,
                        content: updatedSections[existingToolIndex].content + (data.chunk || ''),
                        input: data.metadata.tool?.input || updatedSections[existingToolIndex].input,
                        result: data.metadata.tool?.result || updatedSections[existingToolIndex].result,
                        error: data.metadata.error || updatedSections[existingToolIndex].error
                      };
                      updatedSections[existingToolIndex] = newSection;
                    } else {
                      // 创建新工具部分
                      newSection = {
                        id: toolId,
                        type: toolType,
                        name: toolName,
                        content: data.chunk || '',
                        input: data.metadata.tool?.input,
                        result: data.metadata.tool?.result,
                        error: data.metadata.error,
                        isCollapsed: true
                      };
                      updatedSections.push(newSection);
                    }
                    
                    // 更新工具部分列表，用于最终保存
                    messageToolSections = updatedSections;
                    
                    // 打印出来调试
                    console.log(`Updated tool sections for message ${assistantMessageId}:`, updatedSections);
                    
                    return {
                      ...prev,
                      [assistantMessageId]: updatedSections
                    };
                  });
                }
              }
              else if (data.type === 'error') {
                console.error('Stream error:', data.error);
                throw new Error(data.error || 'Unknown stream error');
              } 
              else if (data.type === 'end') {
                console.log('Stream ended with message:', data.message);
                setStreamingMessageId(null);
                
                // 停止字符池处理并显示剩余字符
                stopCharPoolProcessing();
                
                // 更新最终消息，并包含工具部分信息
                setMessages(prevMessages => {
                  const currentMessages = [...(prevMessages[conversationId] || [])];
                  const assistantMsgIndex = currentMessages.findIndex(m => m.id === assistantMessageId);
                  
                  if (assistantMsgIndex >= 0) {
                    // 使用已累积的文本，而不是从end事件获取的消息
                    // 这样可以避免重复内容
                    currentMessages[assistantMsgIndex] = {
                      ...currentMessages[assistantMsgIndex],
                      text: accumulatedText,
                      // 添加工具元数据到消息，确保页面刷新后仍然可以恢复
                      toolMetadata: messageToolSections.length > 0 ? {
                        sections: messageToolSections
                      } : undefined
                    };
                  }
                  
                  const updatedMessages = {
                    ...prevMessages,
                    [conversationId]: currentMessages
                  };
                  
                  // 保存消息
                  saveMessages(updatedMessages);
                  
                  return updatedMessages;
                });
                
                // Only auto-scroll to bottom if user hasn't manually scrolled up
                if (isAutoScrollingRef.current) {
                  setTimeout(() => scrollToBottom(false), 100);
                }
                
                break;
              }
            } catch (parseError) {
              console.error('Error parsing stream data:', parseError, line);
            }
          }
        }
      } catch (streamError: any) {
        console.error('Error in message streaming:', streamError);
        
        // 停止字符池处理
        stopCharPoolProcessing();
        
        // 添加错误消息
        const errorMessage: Message = {
          id: uuidv4(),
          text: `Error: ${streamError.message || 'Failed to get response'}`,
          sender: 'system',
          timestamp: new Date().toISOString()
        };
        
        setMessages(currentMessages => {
          const currentConversationMessages = currentMessages[conversationId] || [];
          return {
            ...currentMessages,
            [conversationId]: [
              ...currentConversationMessages.filter(msg => msg.id !== assistantMessageId),
              errorMessage
            ]
          };
        });
      }
      
    } catch (error: any) {
      console.error('Error sending message:', error);
      
      // 停止字符池处理
      stopCharPoolProcessing();
      
      // Add error message to conversation
      const errorMessage: Message = {
        id: uuidv4(),
        text: `Error: ${error.message || 'Failed to send message'}`,
        sender: 'system',
        timestamp: new Date().toISOString()
      };
      
      setMessages(currentMessages => {
        const currentConversationMessages = currentMessages[conversationId] || [];
        return {
          ...currentMessages,
          [conversationId]: [
            ...currentConversationMessages,
            errorMessage
          ]
        };
      });
      
      setIsSending(false);
      setStreamingMessageId(null);
    } finally {
      setIsSending(false);
    }
  };

  const handleStopGeneration = async (): Promise<void> => {
    if (!isSending || !streamingMessageId) return;
    
    console.log('Stop generation requested for conversation:', conversationId);
    
    try {
      await abortChatMessage(conversationId);
      
      // 停止字符池处理
      stopCharPoolProcessing();
      
      // Update UI state
      setIsSending(false);
      setStreamingMessageId(null);
      
      // Save what we have so far
      setTimeout(() => {
        saveMessages(messages).catch(err => {
          console.error('Error saving messages after abort:', err);
        });
      }, 500);
    } catch (error) {
      console.error('Error during abort:', error);
    }
  };

  // 简化的界面，不使用动画效果
  return (
    <div className={`chat-view-container ${currentTheme} h-full flex flex-col`}>
      <style>{styles}</style>
      
      {isSessionLoading && (
        <div className="loading-indicator fade-in">
          <svg className="loading-spinner h-5 w-5 mr-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>连接中...</span>
        </div>
      )}
      
      {sessionError && (
        <div className="error-message fade-in">
          <div className="flex items-start">
            <svg className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="font-medium">连接失败</p>
              <p className="mt-1 text-sm opacity-80">{sessionError}</p>
            </div>
          </div>
        </div>
      )}
      
      <div className="flex-1 flex flex-col overflow-hidden h-full relative min-h-0">
        <MessageList 
          messages={messages[conversationId] || []} 
          streamingMessageId={streamingMessageId}
          toolSections={toolSections}
          isAutoScrollingDisabled={!isAutoScrollingRef.current}
          onUserScroll={(hasScrolled) => {
            // 当用户滚动时，更新全局滚动状态
            isAutoScrollingRef.current = !hasScrolled;
            setShowScrollButton(hasScrolled);
            
            if (hasScrolled && streamingMessageId) {
              console.log("User scrolled during streaming - updating ChatView scroll state");
            }
          }}
        />
        <div ref={messagesEndRef} />
        
        {showScrollButton && (
          <button 
            className="scroll-button fade-in"
            onClick={() => {
              isAutoScrollingRef.current = true;
              scrollToBottom(true);
              setShowScrollButton(false);
            }}
            aria-label="滚动到底部"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        )}
      </div>
      
      <div className="chat-input-area flex-shrink-0">
        <MessageInput 
          value={currentMessage}
          onChange={(e) => setCurrentMessage(e.target.value)}
          onSend={sendMessage}
          isLoading={isSending}
          onStopGeneration={handleStopGeneration}
          onDeleteConversation={onDeleteConversation}
          currentTheme={currentTheme}
        />
      </div>
    </div>
  );
};

export default ChatView; 