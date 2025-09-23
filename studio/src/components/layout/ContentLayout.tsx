import React, { ReactNode } from "react";

interface ContentLayoutProps {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
}

/**
 * 内容区域布局组件
 * 结构：上中下三部分
 * - 上：固定头部（可选）
 * - 中：主要内容区域（二级路由内容）
 * - 下：固定底部（可选）
 */
const ContentLayout: React.FC<ContentLayoutProps> = ({
  children,
  header,
  footer,
}) => {
  return (
    <div className="h-full flex flex-col">
      {/* 固定头部区域 */}
      {header && (
        <header className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700">
          {header}
        </header>
      )}

      {/* 主要内容区域 - 二级路由内容 */}
      <main className="flex-1 overflow-hidden">{children}</main>

      {/* 固定底部区域 */}
      {footer && (
        <footer className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700">
          {footer}
        </footer>
      )}
    </div>
  );
};

export default ContentLayout;