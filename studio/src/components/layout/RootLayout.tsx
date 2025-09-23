import React, { ReactNode } from "react";
import ModSidebar from "./ModSidebar";
import Sidebar from "./Sidebar";

interface RootLayoutProps {
  children: ReactNode;
}

/**
 * 根布局组件 - 负责整体布局结构
 * 包含：左侧模块导航 + 中间内容区域（侧边栏 + 主内容）
 *
 * 注意：现在 Sidebar 组件是自管理的，不需要从这里传递业务数据
 * 每个页面组件会通过自己的 hooks 获取需要的数据
 */
const RootLayout: React.FC<RootLayoutProps> = ({ children }) => {

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-slate-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* 左侧模块导航栏 */}
      <ModSidebar />

      {/* 中间内容区域：侧边栏 + 主内容 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 功能侧边栏 - 现在是自管理的，会根据路由自动显示相应内容 */}
        <Sidebar />

        {/* 主内容区域 */}
        <main className="flex-1 flex flex-col overflow-hidden m-1 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 bg-gradient-to-br from-white via-blue-50 to-purple-50 dark:bg-gray-800">
          {children}
        </main>
      </div>
    </div>
  );
};

export default RootLayout;
