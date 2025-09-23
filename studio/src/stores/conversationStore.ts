import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuidv4 } from "uuid";
import { Conversation } from "@/types";

interface ConversationState {
  // 状态
  activeConversationId: string;
  conversations: Conversation[];
  isLoading: boolean;

  // 操作
  createNewConversation: () => void;
  handleConversationChange: (conversationId: string) => void;
  deleteConversation: (conversationId: string) => void;
  updateConversationTitle: (conversationId: string, newTitle: string) => void;
  setIsLoading: (loading: boolean) => void;

  // 批量操作
  setConversations: (conversations: Conversation[]) => void;
  clearAllConversations: () => void;
}

// 创建初始对话
const createInitialConversation = (): { conversation: Conversation; id: string } => {
  const id = `conv_${uuidv4()}`;
  const conversation: Conversation = {
    id,
    title: 'New conversation',
    isActive: true
  };
  return { conversation, id };
};

export const useConversationStore = create<ConversationState>()(
  persist(
    (set, get) => {
      // 初始化时创建一个默认对话
      const { conversation: initialConversation, id: initialId } = createInitialConversation();

      return {
        // 初始状态
        activeConversationId: initialId,
        conversations: [initialConversation],
        isLoading: false,

        // 创建新对话
        createNewConversation: () => {
          const { conversation: newConversation, id: newId } = createInitialConversation();

          set((state) => ({
            conversations: [
              ...state.conversations.map(c => ({ ...c, isActive: false })),
              newConversation
            ],
            activeConversationId: newId
          }));

          console.log(`Created new conversation: ${newId}`);
        },

        // 切换对话
        handleConversationChange: (conversationId: string) => {
          set((state) => ({
            conversations: state.conversations.map(c => ({
              ...c,
              isActive: c.id === conversationId
            })),
            activeConversationId: conversationId
          }));

          console.log(`Switched to conversation: ${conversationId}`);
        },

        // 删除对话
        deleteConversation: (conversationId: string) => {
          const state = get();
          const filteredConversations = state.conversations.filter(c => c.id !== conversationId);

          // 如果删除的是当前活跃对话且还有其他对话，激活第一个
          let newActiveId = state.activeConversationId;
          if (conversationId === state.activeConversationId) {
            if (filteredConversations.length > 0) {
              newActiveId = filteredConversations[0].id;
              filteredConversations[0].isActive = true;
            } else {
              // 如果没有其他对话，创建一个新的
              const { conversation: newConversation, id: newId } = createInitialConversation();
              filteredConversations.push(newConversation);
              newActiveId = newId;
            }
          }

          set({
            conversations: filteredConversations,
            activeConversationId: newActiveId
          });

          console.log(`Deleted conversation: ${conversationId}`);
        },

        // 更新对话标题
        updateConversationTitle: (conversationId: string, newTitle: string) => {
          set((state) => ({
            conversations: state.conversations.map(c =>
              c.id === conversationId
                ? { ...c, title: newTitle }
                : c
            )
          }));

          console.log(`Updated conversation title: ${conversationId} -> ${newTitle}`);
        },

        // 设置加载状态
        setIsLoading: (loading: boolean) => {
          set({ isLoading: loading });
        },

        // 批量设置对话
        setConversations: (conversations: Conversation[]) => {
          set({ conversations });
        },

        // 清空所有对话
        clearAllConversations: () => {
          const { conversation: newConversation, id: newId } = createInitialConversation();
          set({
            conversations: [newConversation],
            activeConversationId: newId
          });
        }
      };
    },
    {
      name: "openagents_conversations", // localStorage key
      partialize: (state) => ({
        activeConversationId: state.activeConversationId,
        conversations: state.conversations,
      }), // 只持久化对话数据，不持久化加载状态
    }
  )
);