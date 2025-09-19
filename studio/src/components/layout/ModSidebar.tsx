import React, { useMemo } from "react";
import { PLUGIN_NAME_ENUM } from "@/types/plugins";
import ModIcon from "./ModIcon";
import { useViewStore } from "@/stores/viewStore";

interface ModIconConfig {
  key: PLUGIN_NAME_ENUM;
  label: string;
  icon: React.ReactNode;
  condition?: (props: {
    hasSharedDocuments: boolean;
    hasThreadMessaging: boolean;
  }) => boolean;
}

interface ModSidebarProps {
  hasSharedDocuments: boolean;
  hasThreadMessaging: boolean;
}

// 缓存的 Icon 组件
const MessageIcon = React.memo(() => (
  <svg
    className="w-6 h-6"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
    />
  </svg>
));
MessageIcon.displayName = "MessageIcon";

const DocumentIcon = React.memo(() => (
  <svg
    className="w-6 h-6"
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
));
DocumentIcon.displayName = "DocumentIcon";

const SettingsIcon = React.memo(() => (
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
));
SettingsIcon.displayName = "SettingsIcon";

const ProfileIcon = React.memo(() => (
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
));
ProfileIcon.displayName = "ProfileIcon";

const McpIcon = React.memo(() => (
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
      d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
    />
  </svg>
));
McpIcon.displayName = "McpIcon";

const ModSidebar: React.FC<ModSidebarProps> = ({
  hasSharedDocuments,
  hasThreadMessaging,
}) => {
  // 使用视图 store
  const { activeView, setActiveView } = useViewStore();
  // 缓存图标配置数组 - 只有条件依赖变化时才重新创建
  const iconGroups: [ModIconConfig[], ModIconConfig[]] = useMemo(
    () => [
      // Top items (主要功能)
      [
        {
          key: PLUGIN_NAME_ENUM.CHAT,
          label: "Messages",
          icon: <MessageIcon />,
          condition: (props) => props.hasThreadMessaging,
        },
        {
          key: PLUGIN_NAME_ENUM.DOCUMENTS,
          label: "Documents",
          icon: <DocumentIcon />,
          condition: (props) => props.hasSharedDocuments,
        },
      ],
      // Bottom items (设置相关)
      [
        {
          key: PLUGIN_NAME_ENUM.SETTINGS,
          label: "Settings",
          icon: <SettingsIcon />,
        },
        {
          key: PLUGIN_NAME_ENUM.PROFILE,
          label: "Profile",
          icon: <ProfileIcon />,
        },
        {
          key: PLUGIN_NAME_ENUM.MCP,
          label: "MCP",
          icon: <McpIcon />,
        },
      ],
    ],
    []
  ); // 图标配置是静态的，不需要依赖

  // 缓存当前 props - 避免每次渲染都创建新对象
  const currentProps = useMemo(
    () => ({
      hasSharedDocuments,
      hasThreadMessaging,
    }),
    [hasSharedDocuments, hasThreadMessaging]
  );

  // 缓存过滤后的图标组 - 避免重复过滤计算
  const [topIcons, bottomIcons] = useMemo(
    () => [
      iconGroups[0].filter(
        (iconConfig) =>
          !iconConfig.condition || iconConfig.condition(currentProps)
      ),
      iconGroups[1].filter(
        (iconConfig) =>
          !iconConfig.condition || iconConfig.condition(currentProps)
      ),
    ],
    [iconGroups, currentProps]
  );
  return (
    <div
      className="
      w-16 h-full flex flex-col items-center py-4 border-r transition-colors duration-200
      bg-gray-100 border-gray-200 dark:bg-gray-900 dark:border-gray-700
    "
    >
      {/* Logo/Brand Icon */}
      <div className="mb-6">
        <div
          className="
          w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg
          bg-gradient-to-br from-blue-600 to-purple-600 text-white
          shadow-lg
        "
        >
          OA
        </div>
      </div>

      {/* Top Icons - 主要功能 */}
      <div className="flex flex-col space-y-3 flex-1">
        {topIcons.map((iconConfig) => (
          <ModIcon
            key={iconConfig.key}
            isActive={activeView === iconConfig.key}
            onClick={() => setActiveView(iconConfig.key)}
            label={iconConfig.label}
            icon={iconConfig.icon}
          />
        ))}
      </div>

      {/* Bottom Icons - 设置相关 */}
      <div className="flex flex-col space-y-3 mt-auto">
        {bottomIcons.map((iconConfig) => (
          <ModIcon
            key={iconConfig.key}
            isActive={activeView === iconConfig.key}
            onClick={() => setActiveView(iconConfig.key)}
            label={iconConfig.label}
            icon={iconConfig.icon}
          />
        ))}
      </div>
    </div>
  );
};

// 缓存整个 ModSidebar 组件
export default React.memo(ModSidebar);
