import React from "react";

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

// Wiki Category Item Component
const WikiCategoryItem: React.FC<{
  name: string;
  isActive: boolean;
  pageCount?: number;
  onClick: () => void;
}> = React.memo(({ name, isActive, pageCount = 0, onClick }) => (
  <li>
    <button
      onClick={onClick}
      className={`w-full text-left text-sm truncate px-2 py-2 font-medium rounded transition-colors
        ${
          isActive
            ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 border-l-2 border-indigo-500 dark:border-indigo-400 pl-2 shadow-sm"
            : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 pl-2.5"
        }
      `}
      title={name}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center min-w-0">
          <span className="mr-2 text-gray-400">📚</span>
          <span className="truncate">{name}</span>
        </div>
        {pageCount > 0 && (
          <span className="ml-2 bg-blue-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
            {pageCount > 99 ? "99+" : pageCount}
          </span>
        )}
      </div>
    </button>
  </li>
));
WikiCategoryItem.displayName = "WikiCategoryItem";

// Wiki Page Item Component
const WikiPageItem: React.FC<{
  name: string;
  isActive: boolean;
  isUpdated?: boolean;
  onClick: () => void;
}> = React.memo(({ name, isActive, isUpdated = false, onClick }) => (
  <li>
    <button
      onClick={onClick}
      className={`w-full text-left text-sm truncate px-2 py-2 font-medium rounded transition-colors
        ${
          isActive
            ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 border-l-2 border-indigo-500 dark:border-indigo-400 pl-2 shadow-sm"
            : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 pl-2.5"
        }
      `}
      title={name}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center min-w-0">
          <span className="mr-2 text-gray-400">📄</span>
          <span className="truncate">{name}</span>
        </div>
        {isUpdated && (
          <span className="ml-2 w-2 h-2 bg-green-500 rounded-full"></span>
        )}
      </div>
    </button>
  </li>
));
WikiPageItem.displayName = "WikiPageItem";

// Wiki Sidebar Content Component
const WikiSidebar: React.FC = () => {
  // TODO: 这里应该从 wikiStore 或相关的 store 获取Wiki数据
  // 目前使用模拟数据
  const wikiCategories = [
    { name: "Getting Started", id: "getting-started", pageCount: 8 },
    { name: "User Guide", id: "user-guide", pageCount: 15 },
    { name: "Developer Docs", id: "dev-docs", pageCount: 12 },
    { name: "API Reference", id: "api-ref", pageCount: 25 },
    { name: "FAQ", id: "faq", pageCount: 6 },
  ];

  const recentPages = [
    { name: "Installation Guide", id: "install", isUpdated: true },
    { name: "Quick Start", id: "quickstart", isUpdated: false },
    { name: "Configuration", id: "config", isUpdated: true },
    { name: "Troubleshooting", id: "troubleshoot", isUpdated: false },
  ];

  const [activeCategory, setActiveCategory] = React.useState<string | null>("getting-started");
  const [activePage, setActivePage] = React.useState<string | null>(null);

  // 分类选择处理
  const onCategorySelect = (categoryId: string) => {
    setActiveCategory(categoryId);
    setActivePage(null); // 切换分类时清除页面选择
    // TODO: 触发分类页面列表的加载
  };

  // 页面选择处理
  const onPageSelect = (pageId: string) => {
    setActivePage(pageId);
    setActiveCategory(null); // 切换页面时清除分类选择
    // TODO: 触发页面内容的加载
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Wiki Categories Section */}
      <SectionHeader title="CATEGORIES" />
      <div className="px-3">
        <ul className="flex flex-col gap-1">
          {wikiCategories.map((category) => (
            <WikiCategoryItem
              key={category.id}
              name={category.name}
              isActive={activeCategory === category.id}
              pageCount={category.pageCount}
              onClick={() => onCategorySelect(category.id)}
            />
          ))}
        </ul>
      </div>

      {/* Recent Pages Section */}
      <SectionHeader title="RECENT PAGES" />
      <div className="flex-1 overflow-y-auto px-3 custom-scrollbar">
        <ul className="flex flex-col gap-1">
          {recentPages.map((page) => (
            <WikiPageItem
              key={page.id}
              name={page.name}
              isActive={activePage === page.id}
              isUpdated={page.isUpdated}
              onClick={() => onPageSelect(page.id)}
            />
          ))}
        </ul>
      </div>
    </div>
  );
};

export default React.memo(WikiSidebar);