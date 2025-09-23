import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Message, ConversationMessages, ToolSectionsMap } from "@/types";

// 消息存储配置，基于现有ChatView的逻辑
const MESSAGE_CONFIG = {
  // 每个对话最多保留的消息数量
  MAX_MESSAGES_PER_CONVERSATION: 1000,
  // 持久化的最大对话数量
  MAX_PERSISTED_CONVERSATIONS: 10,
  // 自动清理阈值（总消息数）
  AUTO_CLEANUP_THRESHOLD: 5000,
};

interface ChatMessageState {
  // 核心状态 - 与ChatView保持一致
  messages: ConversationMessages; // { [conversationId: string]: Message[] }
  toolSections: ToolSectionsMap; // { [messageId: string]: ToolSection[] }

  // 流式消息状态
  streamingMessageId: string | null;

  // 会话加载状态
  isSessionLoading: boolean;
  sessionError: string | null;

  // 消息操作
  addMessage: (conversationId: string, message: Message) => void;
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void;
  deleteMessage: (conversationId: string, messageId: string) => void;
  setMessages: (conversationId: string, messages: Message[]) => void;
  clearConversationMessages: (conversationId: string) => void;

  // 流式消息处理
  setStreamingMessage: (messageId: string | null) => void;

  // 工具相关操作
  updateToolSections: (messageId: string, sections: any[]) => void;
  getToolSections: (messageId: string) => any[] | undefined;

  // 会话状态管理
  setSessionLoading: (loading: boolean) => void;
  setSessionError: (error: string | null) => void;

  // 批量操作和优化
  saveMessagesToBackend: (conversationId: string) => Promise<void>;
  loadMessagesFromBackend: (conversationId: string) => Promise<void>;
  cleanupOldMessages: () => void;
  getMessageCount: () => number;

  // 获取消息
  getMessagesForConversation: (conversationId: string) => Message[];
}

export const useChatMessageStore = create<ChatMessageState>()(
  persist(
    (set, get) => ({
      // 初始状态
      messages: {},
      toolSections: {},
      streamingMessageId: null,
      isSessionLoading: false,
      sessionError: null,

      // 添加消息 - 基于ChatView的addMessage逻辑
      addMessage: (conversationId: string, message: Message) => {
        set((state) => {
          const currentMessages = state.messages[conversationId] || [];
          const newMessages = [...currentMessages, message];

          // 如果超过限制，移除最旧的消息
          const trimmedMessages = newMessages.length > MESSAGE_CONFIG.MAX_MESSAGES_PER_CONVERSATION
            ? newMessages.slice(-MESSAGE_CONFIG.MAX_MESSAGES_PER_CONVERSATION)
            : newMessages;

          return {
            messages: {
              ...state.messages,
              [conversationId]: trimmedMessages
            }
          };
        });

        // 检查是否需要自动清理
        const totalMessages = get().getMessageCount();
        if (totalMessages > MESSAGE_CONFIG.AUTO_CLEANUP_THRESHOLD) {
          get().cleanupOldMessages();
        }
      },

      // 更新消息
      updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => {
        set((state) => {
          const currentMessages = state.messages[conversationId] || [];
          const updatedMessages = currentMessages.map(msg =>
            msg.id === messageId ? { ...msg, ...updates } : msg
          );

          return {
            messages: {
              ...state.messages,
              [conversationId]: updatedMessages
            }
          };
        });
      },

      // 删除消息
      deleteMessage: (conversationId: string, messageId: string) => {
        set((state) => {
          const currentMessages = state.messages[conversationId] || [];
          const filteredMessages = currentMessages.filter(msg => msg.id !== messageId);

          // 同时清理相关的工具部分
          const newToolSections = { ...state.toolSections };
          delete newToolSections[messageId];

          return {
            messages: {
              ...state.messages,
              [conversationId]: filteredMessages
            },
            toolSections: newToolSections
          };
        });
      },

      // 设置消息（替换整个对话的消息）
      setMessages: (conversationId: string, messages: Message[]) => {
        set((state) => ({
          messages: {
            ...state.messages,
            [conversationId]: messages
          }
        }));
      },

      // 清空对话消息
      clearConversationMessages: (conversationId: string) => {
        set((state) => {
          const newMessages = { ...state.messages };
          delete newMessages[conversationId];

          // 清理相关的工具部分
          const conversationMessages = state.messages[conversationId] || [];
          const newToolSections = { ...state.toolSections };
          conversationMessages.forEach(msg => {
            delete newToolSections[msg.id];
          });

          return {
            messages: newMessages,
            toolSections: newToolSections
          };
        });
      },

      // 设置流式消息ID
      setStreamingMessage: (messageId: string | null) => {
        set({ streamingMessageId: messageId });
      },

      // 更新工具部分
      updateToolSections: (messageId: string, sections: any[]) => {
        set((state) => ({
          toolSections: {
            ...state.toolSections,
            [messageId]: sections
          }
        }));
      },

      // 获取工具部分
      getToolSections: (messageId: string) => {
        return get().toolSections[messageId];
      },

      // 设置会话加载状态
      setSessionLoading: (loading: boolean) => {
        set({ isSessionLoading: loading });
      },

      // 设置会话错误
      setSessionError: (error: string | null) => {
        set({ sessionError: error });
      },

      // 保存消息到后端 - 基于ChatView的saveMessages逻辑
      saveMessagesToBackend: async (conversationId: string) => {
        const state = get();
        if (!conversationId || conversationId.startsWith("__tmp")) return;

        const currentConversationMessages = state.messages[conversationId] || [];
        console.log(
          `Saving ${currentConversationMessages.length} messages for conversation ${conversationId}`
        );

        try {
          const firstUserMessage = currentConversationMessages.find(
            (msg) => msg.sender === "user"
          );
          let title = conversationId;
          if (firstUserMessage) {
            title = firstUserMessage.text.substring(0, 30).trim();
            if (firstUserMessage.text.length > 30) title += "...";
          }
          if (!title) title = "New Chat";

          const sessionData = {
            id: conversationId,
            title: title,
            messages: currentConversationMessages,
          };

          const response = await fetch(`/api/user/session/${conversationId}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(sessionData),
          });

          if (response.ok) {
            console.log(`Successfully saved conversation ${conversationId}`);
          } else {
            const errorText = await response.text();
            console.error(
              `Error saving session ${conversationId}: ${response.status} ${response.statusText}`,
              errorText
            );
          }
        } catch (error: any) {
          console.error(`Network error saving session ${conversationId}:`, error);
        }
      },

      // 从后端加载消息 - 基于ChatView的loadSession逻辑
      loadMessagesFromBackend: async (conversationId: string) => {
        if (!conversationId || conversationId.startsWith("__tmp")) {
          console.log("Invalid or temporary conversationId, skipping load.");
          return;
        }

        console.log(`Loading messages for conversation: ${conversationId}`);
        get().setSessionLoading(true);
        get().setSessionError(null);

        try {
          // 暂时跳过后端加载，仅初始化空消息
          get().setMessages(conversationId, []);
          return;

          // 实际的API调用逻辑（暂时注释）
          /*
          const response = await fetch(`/api/user/session/${conversationId}`, {
            headers: {
              "Content-Type": "application/json",
            },
          });

          if (response.ok) {
            const sessionData = await response.json();
            let messagesArray = sessionData.messages || [];

            if (!Array.isArray(messagesArray)) {
              console.warn(
                `Invalid messages format for ${conversationId}, expected array but got:`,
                typeof messagesArray
              );
              messagesArray = [];
            }

            const validMessages = messagesArray.filter(
              (msg: any) =>
                msg &&
                msg.id &&
                typeof msg.text === "string" &&
                msg.sender &&
                msg.timestamp
            );

            // 恢复工具部分信息
            const recoveredToolSections: ToolSectionsMap = {};
            validMessages.forEach((msg: Message) => {
              if (msg.toolMetadata && Array.isArray(msg.toolMetadata.sections)) {
                recoveredToolSections[msg.id] = msg.toolMetadata.sections;
              }
            });

            // 更新状态
            get().setMessages(conversationId, validMessages);
            Object.keys(recoveredToolSections).forEach(messageId => {
              get().updateToolSections(messageId, recoveredToolSections[messageId]);
            });

            get().setSessionError(null);
          } else {
            if (response.status === 404) {
              console.log(
                `Session ${conversationId} not found, treating as new conversation`
              );
              get().setMessages(conversationId, []);
            } else {
              const errorText = await response.text();
              console.error(
                `Failed to load conversation: ${response.status} ${response.statusText} - ${errorText}`
              );
              get().setSessionError(
                `Failed to load conversation: ${
                  response.statusText || response.status
                }`
              );
              get().setMessages(conversationId, []);
            }
          }
          */
        } catch (networkError: any) {
          console.error(
            `Network error loading session ${conversationId}:`,
            networkError
          );
          get().setSessionError(
            `Network error: ${networkError.message || "Failed to connect"}`
          );
          get().setMessages(conversationId, []);
        } finally {
          get().setSessionLoading(false);
        }
      },

      // 清理旧消息
      cleanupOldMessages: () => {
        set((state) => {
          const conversations = Object.keys(state.messages);

          // 如果对话数量超过限制，保留最近使用的
          if (conversations.length > MESSAGE_CONFIG.MAX_PERSISTED_CONVERSATIONS) {
            const sortedConversations = conversations
              .map(id => ({
                id,
                messageCount: state.messages[id].length,
                lastMessageTime: state.messages[id][state.messages[id].length - 1]?.timestamp || '0'
              }))
              .sort((a, b) => parseInt(b.lastMessageTime) - parseInt(a.lastMessageTime))
              .slice(0, MESSAGE_CONFIG.MAX_PERSISTED_CONVERSATIONS);

            const newMessages: ConversationMessages = {};
            const newToolSections: ToolSectionsMap = {};

            sortedConversations.forEach(({ id }) => {
              newMessages[id] = state.messages[id];
              // 保留相关的工具部分
              state.messages[id].forEach(msg => {
                if (state.toolSections[msg.id]) {
                  newToolSections[msg.id] = state.toolSections[msg.id];
                }
              });
            });

            return {
              messages: newMessages,
              toolSections: newToolSections
            };
          }

          return state;
        });
      },

      // 获取消息总数
      getMessageCount: () => {
        const state = get();
        return Object.values(state.messages).reduce((total, msgs) => total + msgs.length, 0);
      },

      // 获取特定对话的消息
      getMessagesForConversation: (conversationId: string) => {
        const state = get();
        return state.messages[conversationId] || [];
      }
    }),
    {
      name: "openagents_chat_messages", // localStorage key
      partialize: (state) => ({
        messages: state.messages,
        toolSections: state.toolSections,
        // 不持久化临时状态
      }),
      // 恢复时进行清理检查
      onRehydrateStorage: () => (state) => {
        if (state) {
          // 启动时检查是否需要清理
          const totalMessages = state.getMessageCount();
          if (totalMessages > MESSAGE_CONFIG.AUTO_CLEANUP_THRESHOLD) {
            setTimeout(() => state.cleanupOldMessages(), 100);
          }
        }
      },
    }
  )
);