import React, { useState, useEffect, useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useWikiStore } from "@/stores/wikiStore";
import { useRecentPagesStore } from "@/stores/recentPagesStore";
import WikiCreateModal from "./components/WikiCreateModal";
import MarkdownRenderer from "@/components/common/MarkdownRenderer";
import { formatDateTime } from "@/utils/utils";
import { OpenAgentsContext } from "@/context/OpenAgentsProvider";
import { Button } from "@/components/layout/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardHeading,
  CardTitle,
  CardToolbar,
} from "@/components/layout/ui/card";
import { EmptyState } from "@/components/layout/ui/empty-state";
import { Plus, RefreshCw, Clock, Search, FileText, History } from "lucide-react";
import { Input } from "@/components/layout/ui/input";

const WikiPageList: React.FC = () => {
  const { t } = useTranslation("wiki");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  const context = useContext(OpenAgentsContext);
  const openAgentsService = context?.connector;
  const isConnected = context?.isConnected;
  const { recentPages: recentPagesData, addRecentPage } = useRecentPagesStore();

  const {
    pages,
    proposals,
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

  // Get recently visited pages
  const recentPages = useMemo(() => {
    const currentPagePaths = new Set(pages.map((p) => p.page_path));
    const validRecentPages = recentPagesData.filter((recentPage) =>
      currentPagePaths.has(recentPage.page_path)
    );

    // Convert recent page data to WikiPage format
    const recentWikiPages = validRecentPages.map((recentPage) => {
      const fullPageData = pages.find(
        (p) => p.page_path === recentPage.page_path
      );
      return (
        fullPageData || {
          page_path: recentPage.page_path,
          title: recentPage.title,
          last_modified: recentPage.visited_at / 1000,
          wiki_content: recentPage.preview_content || "",
          creator_id: "unknown",
          created_at: recentPage.visited_at / 1000,
          version: 1,
        }
      );
    });

    return recentWikiPages;
  }, [recentPagesData, pages]);

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

  // if (pagesLoading && pages.length === 0) {
  //   return (
  //     <div className="flex-1 flex items-center justify-center dark:bg-gray-800">
  //       <div className="text-center">
  //         <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
  //         <p className="text-gray-600 dark:text-gray-400">
  //           {t('list.loading')}
  //         </p>
  //       </div>
  //     </div>
  //   );
  // }

  if (pagesError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-gray-800">
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
            {t("list.tryAgain")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white dark:bg-gray-800">
      <Card variant="default" className="h-full flex flex-col border-0 rounded-none shadow-none">
        <CardHeader>
          <CardHeading>
            <CardTitle>{t("list.title")}</CardTitle>
            <CardDescription>
              {t("list.pagesAvailable", { count: pages.length })}
            </CardDescription>
          </CardHeading>
          <CardToolbar>
            {/* Pending proposals button */}
            {proposals.filter((p) => p.status === "pending").length > 0 && (
              <Button
                onClick={() => navigate("/wiki/proposals")}
                size="md"
                className="bg-yellow-500 text-white hover:bg-yellow-600 shadow-xs shadow-black/5"
              >
                <Clock className="w-4 h-4 mr-1.5" />
                {t("list.proposals", {
                  count: proposals.filter((p) => p.status === "pending").length,
                })}
              </Button>
            )}
            <Button onClick={loadPages} variant="outline" size="md">
              <RefreshCw className="w-4 h-4 mr-1.5" />
              {t("list.refresh")}
            </Button>
            <Button onClick={() => setShowCreateModal(true)} variant="primary" size="md">
              <Plus className="w-4 h-4 mr-1.5" />
              {t("list.newPage")}
            </Button>
          </CardToolbar>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden flex flex-col">
          {/* Search bar */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
            <Input
              type="text"
              variant="lg"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("list.searchPlaceholder")}
              className="pl-10"
            />
          </div>

          {/* Recent Pages Section */}
          {recentPages.length > 0 && (
            <Card variant="default" className="border border-gray-200 dark:border-gray-700 mb-4">
              <CardHeader>
                <CardHeading>
                  <CardTitle className="text-base">
                    最近访问
                  </CardTitle>
                </CardHeading>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2">
                  {recentPages.map((page) => (
                    <button
                      key={page.page_path}
                      onClick={() => handlePageClick(page.page_path)}
                      className="text-left p-2 rounded-md border bg-white dark:bg-zinc-950 border-gray-200 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all duration-200 group"
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-900 dark:text-gray-100 line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                            {page.title || t("list.untitled")}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="inline-flex items-center text-xs text-gray-500 dark:text-gray-400">
                              <History className="w-3 h-3 mr-0.5" />
                              {formatDateTime(page.last_modified)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Page list */}
          <div className="flex-1 overflow-auto">
            {pages.length === 0 ? (
            <EmptyState
              icon={<FileText className="w-16 h-16" />}
              title={searchQuery ? t("list.noPagesFound") : t("list.noPages")}
              description={
                searchQuery
                  ? t("list.noPagesFoundSearch")
                  : t("list.createFirst")
              }
              action={
                !searchQuery ? (
                  <Button
                    onClick={() => setShowCreateModal(true)}
                    size="sm"
                    className="bg-blue-500 text-white"
                  >
                    {t("list.createFirstButton")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-4">
              {pages.map((page) => (
                <div
                  key={page.page_path}
                  onClick={() => handlePageClick(page.page_path)}
                  className="p-4 rounded-lg border cursor-pointer transition-all hover:shadow-lg bg-white dark:bg-zinc-950 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-zinc-900 hover:border-gray-300 dark:hover:border-gray-600"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold mb-2 line-clamp-2 text-gray-900 dark:text-gray-100">
                        {page.title || t("list.untitled")}
                      </h3>
                      <div className="text-sm mb-3 line-clamp-3 text-gray-600 dark:text-gray-400 wiki-list-preview">
                        <MarkdownRenderer
                          content={page.wiki_content || t("list.noContent")}
                          className="prose-sm max-w-none"
                        />
                      </div>
                      <div className="flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400">
                        <span>{page.page_path || t("list.unknownPath")}</span>
                        <span>
                          {t("list.by", {
                            user: page.creator_id || t("list.unknownCreator"),
                          })}
                        </span>
                        <span>
                          {t("list.version", { version: page.version || 1 })}
                        </span>
                        <span>{formatDateTime(page.last_modified)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
        </CardContent>
      </Card>

      {/* Create page modal */}
      <WikiCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </div>
  );
};

export default WikiPageList;
