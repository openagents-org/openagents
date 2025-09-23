import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DocumentInfo } from "@/types";
import { ThreadState } from "@/types/thread";

interface ThreadStoreState {
  // 简化的线程状态 - 只存储当前选择
  threadState: ThreadState | null;

  // 文档相关状态
  documents: DocumentInfo[];
  selectedDocumentId: string | null;

  // 线程操作
  setThreadState: (state: ThreadState | null) => void;
  updateThreadState: (updates: Partial<ThreadState>) => void;

  // 文档操作
  setDocuments: (documents: DocumentInfo[]) => void;
  addDocument: (document: DocumentInfo) => void;
  updateDocument: (documentId: string, updates: Partial<DocumentInfo>) => void;
  removeDocument: (documentId: string) => void;
  setSelectedDocument: (documentId: string | null) => void;

  // 便捷方法
  getCurrentChannel: () => string | null;
  getCurrentDirectMessage: () => string | null;
  // 兼容方法 - 返回空数组，实际数据由hooks管理
  getChannels: () => any[];
  getAgents: () => any[];
}

export const useThreadStore = create<ThreadStoreState>()(
  persist(
    (set, get) => ({
      // 初始状态
      threadState: null,
      documents: [],
      selectedDocumentId: null,

      // 设置完整的线程状态
      setThreadState: (state: ThreadState | null) => {
        set({ threadState: state });
      },

      // 更新部分线程状态
      updateThreadState: (updates: Partial<ThreadState>) => {
        set((state) => ({
          threadState: state.threadState
            ? { ...state.threadState, ...updates }
            : {
                currentChannel: null,
                currentDirectMessage: null,
                ...updates,
              },
        }));
      },

      // 设置文档列表
      setDocuments: (documents: DocumentInfo[]) => {
        set({ documents });
      },

      // 添加文档
      addDocument: (document: DocumentInfo) => {
        set((state) => ({
          documents: [...state.documents, document],
        }));
      },

      // 更新文档
      updateDocument: (documentId: string, updates: Partial<DocumentInfo>) => {
        set((state) => ({
          documents: state.documents.map((doc) =>
            doc.document_id === documentId ? { ...doc, ...updates } : doc
          ),
        }));
      },

      // 移除文档
      removeDocument: (documentId: string) => {
        set((state) => ({
          documents: state.documents.filter(
            (doc) => doc.document_id !== documentId
          ),
          // 如果移除的是当前选中的文档，清除选择
          selectedDocumentId:
            state.selectedDocumentId === documentId
              ? null
              : state.selectedDocumentId,
        }));
      },

      // 设置选中的文档
      setSelectedDocument: (documentId: string | null) => {
        set({ selectedDocumentId: documentId });
      },

      // 便捷方法：获取当前频道
      getCurrentChannel: () => {
        return get().threadState?.currentChannel || null;
      },

      // 便捷方法：获取当前私信对象
      getCurrentDirectMessage: () => {
        return get().threadState?.currentDirectMessage || null;
      },

      // 兼容方法：获取频道列表（现在返回空数组，实际数据由hooks管理）
      getChannels: () => {
        return [];
      },

      // 兼容方法：获取代理列表（现在返回空数组，实际数据由hooks管理）
      getAgents: () => {
        return [];
      },
    }),
    {
      name: "openagents_thread", // localStorage key
      partialize: (state) => ({
        // 只持久化基本的线程状态和文档信息
        threadState: state.threadState,
        documents: state.documents,
        selectedDocumentId: state.selectedDocumentId,
      }),
    }
  )
);
