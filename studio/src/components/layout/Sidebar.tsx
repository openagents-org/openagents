import React from "react";
import { useNavigate } from "react-router-dom";
// import OpenAgentsLogo from "@/components/icons/OpenAgentsLogo";
import { useNetworkStore } from "@/stores/networkStore";
import { useThreadStore } from "@/stores/threadStore";
import { useConversationStore } from "@/stores/conversationStore";
import { clearAllOpenAgentsDataForLogout } from "@/utils/cookies";
import { useConfirm } from "@/context/ConfirmContext";
// import { getVisibleQuickActions } from "@/config/routeConfig";
import { useThemeStore } from "@/stores/themeStore";
import SidebarContent from "./SidebarContent";

// Header Component - 缓存组件，因为内容是静态的
const SidebarHeader: React.FC = React.memo(() => (
  <div className="flex flex-col px-4 py-2">
    <div className="flex items-center justify-center">
      {/* <OpenAgentsLogo className="w-10 h-10 mr-2 text-gray-900 dark:text-white" /> */}
      <span className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent dark:bg-none dark:text-white">
        OpenAgents Studio
      </span>
    </div>
  </div>
));
SidebarHeader.displayName = "SidebarHeader";

// // Quick Action Button Component - 缓存组件，避免不必要的重新渲染
// const QuickActionButton: React.FC<{
//   isActive: boolean;
//   onClick: () => void;
//   icon: React.ReactNode;
//   title: string;
//   subtitle: string;
//   gradient: string;
//   hoverGradient: string;
//   backgroundImage?: string;
// }> = React.memo(
//   ({
//     isActive,
//     onClick,
//     icon,
//     title,
//     subtitle,
//     gradient,
//     hoverGradient,
//     backgroundImage,
//   }) => (
//     <button
//       onClick={onClick}
//       className={`relative group flex items-center w-full rounded-lg px-4 py-3.5 text-sm transition-all overflow-hidden
//       ${isActive ? gradient : hoverGradient}
//     `}
//       style={{ backgroundImage: !isActive ? backgroundImage : undefined }}
//     >
//       <div className="flex items-center">
//         <div className="mr-3 p-1.5 rounded-md bg-white/20">{icon}</div>
//         <div className="flex flex-col items-start">
//           <span className="font-medium">{title}</span>
//           <span className="text-xs opacity-75">{subtitle}</span>
//         </div>
//       </div>
//       <div className="ml-auto">
//         <svg
//           className="w-4 h-4 opacity-50 group-hover:opacity-75 transition-opacity"
//           fill="none"
//           stroke="currentColor"
//           viewBox="0 0 24 24"
//         >
//           <path
//             strokeLinecap="round"
//             strokeLinejoin="round"
//             strokeWidth={2}
//             d="M9 5l7 7-7 7"
//           />
//         </svg>
//       </div>
//     </button>
//   )
// );
// QuickActionButton.displayName = "QuickActionButton";

// Footer Component - 缓存组件，只有主题改变时才重新渲染
const SidebarFooter: React.FC<{
  toggleTheme: () => void;
  theme: string;
}> = React.memo(({ toggleTheme, theme }) => {
  const navigate = useNavigate();
  const { agentName, selectedNetwork, clearNetwork, clearAgentName } =
    useNetworkStore();
  const { setThreadState } = useThreadStore();
  const { clearAllConversations } = useConversationStore();
  const { confirm } = useConfirm();

  // 登出处理函数
  const handleLogout = async () => {
    console.log("🚪 Logout button clicked - showing confirmation dialog");

    try {
      // 显示确认对话框
      const confirmed = await confirm(
        'Logout Confirmation',
        'Are you sure you want to logout? You will need to reconnect to continue using the application.',
        {
          confirmText: 'Logout',
          cancelText: 'Cancel',
          type: 'warning'
        }
      );

      if (!confirmed) {
        console.log("🚫 Logout cancelled by user");
        return;
      }

      console.log("✅ Logout confirmed - starting logout process");

      // 清空网络状态
      clearNetwork();
      clearAgentName();
      console.log("🧹 Network state cleared");

      // 重置 ThreadStore 的内存状态（这是关键！）
      setThreadState(null);
      console.log("🧹 Thread store memory state reset");

      // 清空对话 store
      clearAllConversations();
      console.log("🧹 Conversations store cleared");

      // 清空 OpenAgents 相关的所有数据（保留主题设置）
      clearAllOpenAgentsDataForLogout();

      // 跳转到网络选择页面
      console.log("🔄 Navigating to network selection");
      navigate("/network-selection", { replace: true });

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
          {/* 主题切换按钮 */}
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

          {/* 登出按钮 */}
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

// 简化的 Sidebar Props - 只包含基础的UI状态，不包含业务数据
interface SidebarProps {
  // 基础UI状态 - 如果需要的话
  className?: string;
}

const Sidebar: React.FC<SidebarProps> = ({ className }) => {
  // const navigate = useNavigate();
  const { theme, toggleTheme } = useThemeStore();

  // 获取动态的快捷操作配置
  // const quickActions = getVisibleQuickActions();

  return (
    <div
      className={`sidebar h-full flex flex-col transition-all duration-200 bg-slate-100 dark:bg-gray-900 ${
        className || ""
      }`}
      style={{ width: "19rem" }}
    >
      {/* 上：Header */}
      <SidebarHeader />

      {/* 中：Dynamic Content - 由 SidebarContent 根据路由自动管理 */}
      <div className="flex-1">
        <SidebarContent />
      </div>

      {/* Quick Actions - 动态渲染 */}
      {/* {quickActions.map((action) => (
        <div key={action.id} className="px-4 pt-2">
          <QuickActionButton
            isActive={false}
            onClick={() => navigate(action.route)}
            icon={action.icon}
            title={action.title}
            subtitle={action.subtitle}
            gradient={action.style.gradient}
            hoverGradient={action.style.hoverGradient}
            backgroundImage={action.style.backgroundImage}
          />
        </div>
      ))} */}

      {/* 下：Footer */}
      <SidebarFooter toggleTheme={toggleTheme} theme={theme} />
    </div>
  );
};

export default Sidebar;
