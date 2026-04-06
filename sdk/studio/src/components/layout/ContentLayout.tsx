import React, { ReactNode } from "react";

interface ContentLayoutProps {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
}

/**
 * Content area layout component
 * Structure: three parts - top, middle, bottom
 * - Top: Fixed header (optional)
 * - Middle: Main content area (secondary route content)
 * - Bottom: Fixed footer (optional)
 */
const ContentLayout: React.FC<ContentLayoutProps> = ({
  children,
  header,
  footer,
}) => {
  return (
    <div className="h-full flex flex-col">
      {/* Fixed header area */}
      {header && (
        <header className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700">
          {header}
        </header>
      )}

      {/* Main content area - secondary route content */}
      <main className="flex-1 overflow-hidden">{children}</main>

      {/* Fixed footer area */}
      {footer && (
        <footer className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700">
          {footer}
        </footer>
      )}
    </div>
  );
};

export default ContentLayout;