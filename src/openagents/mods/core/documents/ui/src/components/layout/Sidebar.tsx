import React from "react";
import { useNavigate } from "react-router-dom";
import { clearAllOpenAgentsDataForLogout } from "../../utils/cookies";
import { useThemeStore } from "../../stores/themeStore";
import SidebarContent from "./SidebarContent";
import { useAuthStore } from "../../stores/authStore";

// Header Component - cached component because content is static
const SidebarHeader: React.FC = React.memo(() => (
  <div className="flex flex-col px-4 py-2">
    <div className="flex items-center justify-center">
      <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent dark:bg-none dark:text-white">
        OpenAgents Documents
      </span>
    </div>
  </div>
));
SidebarHeader.displayName = "SidebarHeader";

// Footer Component - cached component, only re-renders when theme changes
const SidebarFooter: React.FC<{
  toggleTheme: () => void;
  theme: string;
}> = React.memo(({ toggleTheme, theme }) => {
  const navigate = useNavigate();
  const { agentName, selectedNetwork, clearNetwork, clearAgentName, clearPasswordHash } =
    useAuthStore();

  // Logout handler function
  const handleLogout = async () => {
    console.log("🚪 Logout button clicked");

    try {
      // Clear network state
      clearNetwork();
      clearAgentName();
      clearPasswordHash();
      console.log("🧹 Network state and password hash cleared");

      // Clear all OpenAgents-related data (preserve theme settings)
      clearAllOpenAgentsDataForLogout();

      // Navigate to network selection page
      console.log("🔄 Navigating to network selection");
      navigate("/", { replace: true });
    } catch (error) {
      console.error("❌ Error during logout:", error);
    }
  };

  return (
    <div className="mt-2 border-t border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between px-4 py-4">
        <div className="flex items-center">
          <div
            className={`w-3 h-3 rounded-full mr-3 shadow-sm ${
              selectedNetwork ? "bg-green-500 animate-pulse" : "bg-red-500"
            }`}
          />
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {selectedNetwork ? agentName || "Connected" : "Disconnected"}
            </span>
            {selectedNetwork && (
              <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                {selectedNetwork.host}:{selectedNetwork.port}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-1">
          {/* Theme toggle button */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-all duration-200"
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            {theme === "light" ? (
              <svg
                className="w-4 h-4 text-gray-600 group-hover:text-blue-600 dark:text-gray-300 dark:group-hover:text-blue-400 transition-colors"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
            ) : (
              <svg
                className="w-4 h-4 text-gray-600 group-hover:text-blue-600 dark:text-gray-300 dark:group-hover:text-blue-400 transition-colors"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            )}
          </button>

          {/* Logout button */}
          <button
            onClick={handleLogout}
            className="p-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-all duration-200 group"
            title="Logout and return to network selection"
          >
            <svg
              className="w-4 h-4 text-gray-600 group-hover:text-red-600 dark:text-gray-300 dark:group-hover:text-red-400 transition-colors"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
});
SidebarFooter.displayName = "SidebarFooter";

// Simplified Sidebar Props - only includes basic UI state, no business data
interface SidebarProps {
  // Basic UI state - if needed
  className?: string;
}

const Sidebar: React.FC<SidebarProps> = ({ className }) => {
  const { theme, toggleTheme } = useThemeStore();

  return (
    <div
      className={`sidebar h-full flex flex-col transition-all duration-200 bg-slate-100 dark:bg-gray-900 ${
        className || ""
      } flex flex-col overflow-hidden`}
      style={{ width: "19rem" }}
    >
      {/* Top: Header */}
      <SidebarHeader />

      {/* Middle: Dynamic Content - automatically managed by SidebarContent based on route */}
      <div className="flex-1 overflow-y-hidden">
        <SidebarContent />
      </div>

      {/* Bottom: Footer */}
      <SidebarFooter toggleTheme={toggleTheme} theme={theme} />
    </div>
  );
};

export default Sidebar;

