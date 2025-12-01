import React, { useState, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useProfileStore } from "@/stores/profileStore";
import { isProjectModeEnabled } from "@/utils/projectUtils";
import ProjectTemplateDialog from "@/components/project/ProjectTemplateDialog";

const ProfileSidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, isLoading } = useIsAdmin();
  const healthData = useProfileStore((state) => state.healthData);
  const [showProjectDialog, setShowProjectDialog] = useState(false);

  // Check if project mode is enabled
  const projectModeEnabled = useMemo(
    () => isProjectModeEnabled(healthData),
    [healthData]
  );

  const isActive = (path: string) => {
    const currentPath = location.pathname;
    
    // 精确匹配
    if (currentPath === path) {
      return true;
    }
    
    // 对于 /profile 路径，只在精确匹配时高亮（不包括子路由）
    if (path === "/profile") {
      return false; // 已经在上面处理了精确匹配
    }
    
    // 对于其他路径，支持以该路径开头的匹配（用于嵌套路由）
    return currentPath.startsWith(path + "/");
  };

  const navItems = [
    {
      id: "profile",
      label: "Network Status",
      path: "/profile",
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
      ),
    },
    {
      id: "event_logs",
      label: "Event Logs",
      path: "/profile/event-logs",
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      ),
    },
    {
      id: "event_debugger",
      label: "Event Debugger",
      path: "/profile/event-debugger",
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      ),
    },
  ];

  const adminNavItems = [
    {
      id: "agent-management",
      label: "Agent Management",
      path: "/profile/agent-management",
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
      ),
    },
    {
      id: "network-profile",
      label: "Network Profile",
      path: "/profile/network-profile",
      icon: (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
        {/* New Project Button - only shown when project mode is enabled */}
        {projectModeEnabled && (
          <button
            onClick={() => setShowProjectDialog(true)}
            className="mb-5 w-full flex items-center justify-center px-4 py-3 rounded-lg text-sm font-medium text-white transition-all bg-gradient-to-r from-purple-600 via-purple-500 to-purple-400 hover:from-purple-700 hover:via-purple-600 hover:to-purple-500 shadow-md hover:shadow-lg mt-2"
          >
            <span>New Project</span>
          </button>
        )}
        {/* Section Header */}
        <div className="flex items-center px-2 mb-2">
          <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
          <span className="px-3 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
            Profile
          </span>
          <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
        </div>

        {/* Profile Section */}
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => navigate(item.path)}
            className={`w-full flex items-center px-4 py-3 rounded-lg text-sm font-medium transition-all ${
              isActive(item.path)
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                : "text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {item.icon}
            <span className="ml-3">{item.label}</span>
          </button>
        ))}
      </div>

      {/* Project Template Selection Dialog */}
      {showProjectDialog && (
        <ProjectTemplateDialog
          onClose={() => setShowProjectDialog(false)}
          healthData={healthData}
        />
      )}

      {/* Network Management Section - Only visible for admin */}
      {(!isLoading && isAdmin)  && (
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          {/* Section Header */}
          <div className="flex items-center px-2 mb-2">
            <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
            <span className="px-3 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              Network Management
            </span>
            <div className="flex-1 border-t border-gray-300 dark:border-gray-600"></div>
          </div>

          {/* Admin Navigation Items */}
          <div className="space-y-1">
            {adminNavItems.map((item) => (
              <button
                key={item.id}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                  isActive(item.path)
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {item.icon}
                <span className="ml-3">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-center py-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
            <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
              Checking permissions...
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfileSidebar;
