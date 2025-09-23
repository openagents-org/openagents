import React from "react";

// Default Sidebar Props
export interface DefaultSidebarProps {
  message?: string;
  icon?: React.ReactNode;
}

// Default Sidebar Content Component - 用于没有特定侧边栏内容的路由
const DefaultSidebar: React.FC<DefaultSidebarProps> = ({
  message = "Navigation content will appear here",
  icon,
}) => {
  return (
    <div className="flex-1 flex flex-col justify-center items-center overflow-hidden">
      <div className="flex-1 flex items-center justify-center px-4 py-3">
        <div className="flex items-center justify-center text-center text-gray-400 dark:text-gray-500">
          {/* {icon && <div className="mb-3">{icon}</div>} */}
          <p className="text-sm">{message}</p>
        </div>
      </div>
    </div>
  );
};

export default React.memo(DefaultSidebar);
