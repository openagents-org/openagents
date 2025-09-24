import React, { useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useWikiStore } from "@/stores/wikiStore";
import { useOpenAgentsService } from "@/contexts/OpenAgentsServiceContext";
import useConnectedStatus from "@/hooks/useConnectedStatus";

// Section Header Component
const SectionHeader: React.FC<{ title: string }> = React.memo(({ title }) => (
  <div className="px-5 my-3">
    <div className="flex items-center">
      <div className="text-xs font-bold text-gray-400 tracking-wide select-none">
        {title}
      </div>
      <div className="ml-2 h-px bg-gray-200 dark:bg-gray-700 flex-1"></div>
    </div>
  </div>
));
SectionHeader.displayName = "SectionHeader";

// Wiki Page Item Component
const WikiPageItem: React.FC<{
  page: {
    page_path: string;
    title: string;
    last_modified: number;
  };
  isActive: boolean;
  onClick: () => void;
}> = React.memo(({ page, isActive, onClick }) => {
  const isRecentlyUpdated = Date.now() - page.last_modified * 1000 < 7 * 24 * 60 * 60 * 1000;

  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full text-left text-sm px-2 py-2 font-medium rounded transition-colors
          ${
            isActive
              ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 border-l-2 border-indigo-500 dark:border-indigo-400 pl-2 shadow-sm"
              : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 pl-2.5"
          }
        `}
        title={page.title}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-start min-w-0 flex-1">
            <span className="mr-2 text-gray-400 mt-0.5">📄</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center truncate font-medium overflow-hidden">
                <div className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{page.title}</div>
              </div>
            </div>
          </div>
          {isRecentlyUpdated && (
            <span className="ml-2 w-2 h-2 bg-green-500 rounded-full flex-shrink-0 mt-1.5"></span>
          )}
        </div>
      </button>
    </li>
  );
});
WikiPageItem.displayName = "WikiPageItem";

// Wiki Sidebar Content Component
const WikiSidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { service: openAgentsService } = useOpenAgentsService();
  const { isConnected } = useConnectedStatus();

  const {
    pages,
    setConnection,
    loadPages,
    setupEventListeners,
    cleanupEventListeners
  } = useWikiStore();

  // 获取最近页面（按最后修改时间排序，取前10个）
  const recentPages = useMemo(() => {
    const sortedPages = [...pages].sort((a, b) => b.last_modified - a.last_modified);
    console.log('WikiSidebar: Recent pages recalculated. Total pages:', pages.length, 'Recent count:', Math.min(10, sortedPages.length));
    return sortedPages.slice(0, 10);
  }, [pages]);

  // 检查当前是否在某个页面详情页
  const currentPagePath = location.pathname.match(/^\/wiki\/detail\/(.+)$/)?.[1];
  const decodedCurrentPagePath = currentPagePath ? decodeURIComponent(currentPagePath) : null;

  // 设置连接
  useEffect(() => {
    if (openAgentsService) {
      setConnection(openAgentsService);
    }
  }, [openAgentsService, setConnection]);

  // 加载页面（等待连接建立）
  useEffect(() => {
    if (openAgentsService && isConnected && pages.length === 0) {
      console.log('WikiSidebar: Connection ready, loading pages');
      loadPages();
    }
  }, [openAgentsService, isConnected, loadPages, pages.length]);

  // 设置wiki事件监听器
  useEffect(() => {
    if (openAgentsService) {
      console.log('WikiSidebar: Setting up wiki event listeners');
      setupEventListeners();

      return () => {
        console.log('WikiSidebar: Cleaning up wiki event listeners');
        cleanupEventListeners();
      };
    }
  }, [openAgentsService, setupEventListeners, cleanupEventListeners]);

  // 页面选择处理
  const onPageSelect = (pagePath: string) => {
    navigate(`/wiki/detail/${encodeURIComponent(pagePath)}`);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Recent Pages Section */}
      <SectionHeader title="RECENT PAGES" />
      <div className="flex-1 overflow-y-auto px-3 custom-scrollbar">
        {recentPages.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              No pages yet
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {recentPages.map((page) => (
              <WikiPageItem
                key={page.page_path}
                page={page}
                isActive={decodedCurrentPagePath === page.page_path}
                onClick={() => onPageSelect(page.page_path)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default React.memo(WikiSidebar);