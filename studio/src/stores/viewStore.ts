import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PLUGIN_NAME_ENUM } from "@/types/plugins";

interface ViewState {
  // 当前激活的视图
  activeView: PLUGIN_NAME_ENUM;

  // 设置激活视图
  setActiveView: (view: PLUGIN_NAME_ENUM) => void;

  // 重置到默认视图
  resetView: () => void;
}

// 默认视图
const DEFAULT_VIEW = PLUGIN_NAME_ENUM.CHAT;

export const useViewStore = create<ViewState>()(
  persist(
    (set) => ({
      activeView: DEFAULT_VIEW,

      setActiveView: (view: PLUGIN_NAME_ENUM) => {
        set({ activeView: view });
      },

      resetView: () => {
        set({ activeView: DEFAULT_VIEW });
      },
    }),
    {
      name: "openagents_view", // localStorage key
      partialize: (state) => ({
        activeView: state.activeView, // 只持久化 activeView
      }),
    }
  )
);
