import React, { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { useWikiStore } from "@/stores/wikiStore";
import { useRecentPagesStore } from "@/stores/recentPagesStore";
import WikiCreateModal from "./components/WikiCreateModal";
import MarkdownRenderer from "@/components/common/MarkdownRenderer";
import { formatDateTime } from "@/utils/utils";
import { OpenAgentsContext } from "@/context/OpenAgentsProvider";

const WikiPageList: React.FC = () => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  const context = useContext(OpenAgentsContext);
  const openAgentsService = context?.connector;
  const isConnected = context?.isConnected;
  const { addRecentPage } = useRecentPagesStore();

  const {
    pages,
    proposals,
    pagesLoading,
    pagesError,
    setConnection,
    loadPages,
    loadProposals,
    searchPages,
    setupEventListeners,
    cleanupEventListeners,
  } = useWikiStore();

  // Set connection
  useEffect(() => {
    if (openAgentsService) {
      setConnection(openAgentsService);
    }
  }, [openAgentsService, setConnection]);

  // Load pages (wait for connection to be established)
  useEffect(() => {
    if (openAgentsService && isConnected) {
      console.log("WikiPageList: Connection ready, loading pages");
      loadPages();
      loadProposals();
    }
  }, [openAgentsService, isConnected, loadPages, loadProposals]);

  // Set up wiki event listeners
  useEffect(() => {
    if (openAgentsService) {
      console.log("WikiPageList: Setting up wiki event listeners");
      setupEventListeners();

      return () => {
        console.log("WikiPageList: Cleaning up wiki event listeners");
        cleanupEventListeners();
      };
    }
  }, [openAgentsService, setupEventListeners, cleanupEventListeners]);

  // Handle search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      searchPages(searchQuery);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, searchPages]);

  const handlePageClick = (pagePath: string) => {
    // First find the corresponding page object
    const page = pages.find((p) => p.page_path === pagePath);

    // If page found, record to recent pages
    if (page) {
      console.log("WikiPageList: Adding page to recent pages:", page.title);
      addRecentPage(page);
    }

    console.log(
      "WikiPageList: Navigating to page:",
      pagePath,
      "URL:",
      `/wiki/detail/${encodeURIComponent(pagePath)}`
    );
    navigate(`/wiki/detail/${encodeURIComponent(pagePath)}`);
  };

  if (pagesLoading && pages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">
            Loading wiki pages...
          </p>
        </div>
      </div>
    );
  }

  if (pagesError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className={`text-red-500 mb-4`}>
            <svg
              className="w-12 h-12 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="mb-4 text-gray-700 dark:text-gray-300">{pagesError}</p>
          <button
            onClick={loadPages}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Wiki
          </h1>
          <p className="text-sm mt-1 text-gray-600 dark:text-gray-400">
            {pages.length} pages available
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Pending proposals button */}
          {proposals.filter((p) => p.status === "pending").length > 0 && (
            <button
              onClick={() => navigate("/wiki/proposals")}
              className="flex items-center space-x-2 px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>
                Proposals (
                {proposals.filter((p) => p.status === "pending").length})
              </span>
            </button>
          )}

          {/* Create page button */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            <span>New Page</span>
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search wiki pages..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
          />
          <svg
            className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      </div>

      {/* Page list */}
      <div className="flex-1 overflow-y-hidden py-6 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        {pages.length === 0 ? (
          <div className="text-center py-12 h-full flex flex-col items-center justify-center">
            <div className="mb-4 text-gray-500 dark:text-gray-400">
              <svg
                className="w-16 h-16 mx-auto"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium mb-2 text-gray-700 dark:text-gray-300">
              {searchQuery ? "No pages found" : "No pages yet"}
            </h3>
            <p className="mb-4 text-gray-600 dark:text-gray-400">
              {searchQuery
                ? "No pages found matching your search"
                : "Create your first wiki page to get started!"}
            </p>
            {!searchQuery && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Create First Page
              </button>
            )}
          </div>
        ) : (
          <div className="h-full px-6 overflow-y-auto space-y-4">
            {pages.map((page) => (
              <div
                key={page.page_path}
                onClick={() => handlePageClick(page.page_path)}
                className="p-4 rounded-lg border cursor-pointer transition-all hover:shadow-lg bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 hover:border-gray-300 dark:hover:border-gray-600"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold mb-2 line-clamp-2 text-gray-900 dark:text-gray-100">
                      {page.title || "Untitled"}
                    </h3>
                    <div className="text-sm mb-3 line-clamp-3 text-gray-600 dark:text-gray-400 wiki-list-preview">
                      <MarkdownRenderer
                        content={page.wiki_content || "No content"}
                        className="prose-sm max-w-none"
                      />
                    </div>
                    <div className="flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400">
                      <span>{page.page_path || "Unknown path"}</span>
                      <span>by {page.creator_id || "Unknown"}</span>
                      <span>v{page.version || 1}</span>
                      <span>{formatDateTime(page.last_modified)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create page modal */}
      <WikiCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </div>
  );
};

export default WikiPageList;
