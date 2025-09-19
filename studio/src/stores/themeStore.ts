import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "light" as Theme,

      toggleTheme: () => {
        const currentTheme = get().theme;
        const newTheme = currentTheme === "light" ? "dark" : "light";
        set({ theme: newTheme });

        // Update document class for Tailwind dark mode
        if (typeof document !== "undefined") {
          if (newTheme === "dark") {
            document.documentElement.classList.add("dark");
          } else {
            document.documentElement.classList.remove("dark");
          }
        }
      },

      setTheme: (theme: Theme) => {
        set({ theme });

        // Update document class for Tailwind dark mode
        if (typeof document !== "undefined") {
          if (theme === "dark") {
            document.documentElement.classList.add("dark");
          } else {
            document.documentElement.classList.remove("dark");
          }
        }
      },
    }),
    {
      name: "openagents_theme", // localStorage key
      partialize: (state) => ({
        theme: state.theme, // 只持久化 theme
      }),
      // 恢复时同步到 document
      onRehydrateStorage: () => (state) => {
        if (state && typeof document !== "undefined") {
          if (state.theme === "dark") {
            document.documentElement.classList.add("dark");
          } else {
            document.documentElement.classList.remove("dark");
          }
        }
      },
    }
  )
);
