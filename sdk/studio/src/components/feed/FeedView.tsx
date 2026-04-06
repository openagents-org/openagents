import React, { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { OpenAgentsContext } from "@/context/OpenAgentsProvider";
import { useFeedStore } from "@/stores/feedStore";
import FeedCreateModal from "./FeedCreateModal";
import FeedPostCard from "./components/FeedPostCard";
import { FEED_SORT_FIELDS } from "@/types/feed";
import { Badge } from "@/components/layout/ui/badge";
import { Button } from "@/components/layout/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardHeading, CardTitle, CardToolbar } from "@/components/layout/ui/card";
import { ScrollArea } from "@/components/layout/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/layout/ui/select';
import { RefreshCw, Plus, Filter, ChevronLeft, ChevronRight } from "lucide-react";

const INITIAL_FILTER_RESET = {
  author: undefined,
  tags: [] as string[],
  startDate: undefined,
  endDate: undefined,
  sortBy: "recent" as const,
  sortDirection: "desc" as const,
};

const baseInputClasses =
  "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none transition-colors";
const fullInputClass = `w-full ${baseInputClasses}`;
const flexInputClass = `flex-1 ${baseInputClasses}`;

const FeedView: React.FC = () => {
  const { t } = useTranslation('feed');
  const navigate = useNavigate();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [filterTagInput, setFilterTagInput] = useState("");
  const [searchTagInput, setSearchTagInput] = useState("");
  const [authorDraft, setAuthorDraft] = useState("");
  const { connector, isConnected } = useContext(OpenAgentsContext);

  const {
    posts,
    postsLoading,
    postsError,
    totalPosts,
    page,
    pageSize,
    filters,
    loadPosts,
    refreshPosts,
    setPage,
    setPageSize,
    applyFilters,
    setConnection,
    setAgentId,
    setupEventListeners,
    cleanupEventListeners,
    searchQuery,
    setSearchQuery,
    searchTags,
    setSearchTags,
    searchResults,
    searchLoading,
    searchError,
    searchPosts,
    clearSearch,
    recentPosts,
    recentLoading,
    fetchRecentPosts,
    newPostCount,
    consumeIncomingPosts,
    createPost,
    createStatus,
    createError,
    incomingPosts,
    markPostsChecked,
  } = useFeedStore();

  useEffect(() => {
    if (connector) {
      setConnection(connector);
      setAgentId(connector.getAgentId ? connector.getAgentId() : null);
      setupEventListeners();
      return () => {
        cleanupEventListeners();
      };
    }
  }, [
    connector,
    setConnection,
    setAgentId,
    setupEventListeners,
    cleanupEventListeners,
  ]);

  useEffect(() => {
    if (connector && isConnected) {
      loadPosts();
    }
  }, [connector, isConnected, loadPosts]);

  useEffect(() => {
    setAuthorDraft(filters.author || "");
  }, [filters.author]);

  const visiblePosts = searchResults ?? posts;
  const listLoading = searchResults ? searchLoading : postsLoading;
  const totalPages = Math.max(1, Math.ceil(totalPosts / pageSize));

  const handleAddFilterTag = () => {
    const value = filterTagInput.trim();
    if (!value || filters.tags.includes(value)) return;
    applyFilters({ tags: [...filters.tags, value] });
    setFilterTagInput("");
  };

  const handleRemoveFilterTag = (tag: string) => {
    applyFilters({
      tags: filters.tags.filter((item) => item !== tag),
    });
  };

  const handleFilterTagKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      handleAddFilterTag();
    }
  };

  const handleAddSearchTag = () => {
    const value = searchTagInput.trim();
    if (!value || searchTags.includes(value)) return;
    setSearchTags([...searchTags, value]);
    setSearchTagInput("");
  };

  const handleSearchTagKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      handleAddSearchTag();
    }
  };

  const handleRemoveSearchTag = (tag: string) => {
    setSearchTags(searchTags.filter((item) => item !== tag));
  };

  const handleAuthorCommit = () => {
    applyFilters({ author: authorDraft || undefined });
  };

  const handleSearch = (event?: React.FormEvent) => {
    event?.preventDefault();
    searchPosts();
  };

  const resetFilters = () => {
    applyFilters(INITIAL_FILTER_RESET);
    setAuthorDraft("");
  };

  const filtersActive = useMemo(() => {
    return (
      !!filters.author ||
      filters.tags.length > 0 ||
      filters.startDate ||
      filters.endDate ||
      filters.sortBy !== "recent" ||
      filters.sortDirection !== "desc"
    );
  }, [filters]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-6 bg-gray-50 dark:bg-gray-900">
      <Card variant="default" className="flex-1 flex flex-col overflow-hidden">
        <CardHeader>
          <CardHeading>
            <CardTitle className="flex items-center gap-3">
              {t('header.title')}
              <Badge variant="secondary" appearance="light" size="sm">
                {t('stats.posts', { count: totalPosts })}
              </Badge>
            </CardTitle>
            <CardDescription>
              {t('stats.page', { current: page, total: totalPages })}
            </CardDescription>
          </CardHeading>
          <CardToolbar>
            <Button
              type="button"
              onClick={() => setFiltersExpanded((prev) => !prev)}
              variant={filtersExpanded ? "secondary" : "outline"}
              size="sm"
            >
              <Filter className="w-4 h-4 mr-1" />
              {filtersExpanded ? t('filters.hide') : t('filters.show')}
            </Button>
            <Button
              onClick={() => refreshPosts()}
              variant="outline"
              size="sm"
              disabled={postsLoading}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${postsLoading ? 'animate-spin' : ''}`} />
              {t('actions.refresh')}
            </Button>
            <Button
              onClick={() => setIsCreateOpen(true)}
              variant="primary"
              size="sm"
            >
              <Plus className="w-4 h-4 mr-1" />
              {t('actions.newPost')}
            </Button>
          </CardToolbar>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col overflow-hidden p-0">

      {filtersExpanded && (
        <Card className="mx-5 mt-4 border-gray-200 dark:border-gray-700">
          <CardContent className="p-4 space-y-4">
            <form
              className="flex flex-col lg:flex-row lg:flex-wrap gap-4"
              onSubmit={handleSearch}
            >
              <div className="flex-1 min-w-[280px]">
                <label className="text-xs font-semibold text-gray-500 uppercase">
                  {t('filters.fullTextSearch')}
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('filters.searchPlaceholder')}
                    className={flexInputClass}
                  />
                </div>
                {searchTags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {searchTags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="info"
                        appearance="light"
                        size="sm"
                      >
                        #{tag}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="ml-2 h-auto w-auto p-0 hover:text-indigo-900 dark:hover:text-indigo-100"
                          onClick={() => handleRemoveSearchTag(tag)}
                        >
                          ×
                        </Button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-[220px]">
                <label className="text-xs font-semibold text-gray-500 uppercase">
                  {t('filters.tagSearch')}
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    value={searchTagInput}
                    onChange={(e) => setSearchTagInput(e.target.value)}
                    onKeyDown={handleSearchTagKeyDown}
                    className={flexInputClass}
                    placeholder={t('filters.tagFilterPlaceholder')}
                  />
                  <Button
                    type="button"
                    onClick={handleAddSearchTag}
                    variant="outline"
                    size="sm"
                  >
                    {t('filters.add')}
                  </Button>
                </div>
              </div>
              <div className="w-full lg:w-auto flex flex-col justify-end min-w-[360px]">
                <span className="text-xs font-semibold uppercase text-gray-500 mb-1">
                  {t('filters.actions')}
                </span>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    variant="primary"
                    className="flex-1"
                    disabled={searchLoading}
                  >
                    {t('filters.search')}
                  </Button>
                  <Button
                    type="button"
                    onClick={clearSearch}
                    variant="outline"
                    className="flex-1"
                  >
                    {t('filters.clearSearch')}
                  </Button>
                </div>
              </div>
            </form>

            <div className="space-y-4">
              <div className="flex flex-col lg:flex-row lg:flex-wrap gap-4">
                <div className="flex-1 min-w-[220px]">
                  <label className="text-xs font-semibold text-gray-500 uppercase">
                    {t('filters.author')}
                  </label>
                  <input
                    type="text"
                    value={authorDraft}
                    onChange={(e) => setAuthorDraft(e.target.value)}
                    onBlur={handleAuthorCommit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAuthorCommit();
                      }
                    }}
                    className={`mt-1 ${fullInputClass}`}
                    placeholder={t('filters.authorPlaceholder')}
                  />
                </div>
                <div className="flex flex-1 min-w-[220px] gap-3">
                  <div className="flex-1">
                    <label className="text-xs font-semibold text-gray-500 uppercase">
                      {t('filters.fromDate')}
                    </label>
                    <input
                      type="text"
                      lang="en"
                      placeholder="YYYY-MM-DD"
                      onFocus={(e) => {
                        e.target.type = "date";
                        e.target.showPicker?.();
                      }}
                      onBlur={(e) => {
                        if (!e.target.value) {
                          e.target.type = "text";
                        }
                      }}
                      value={filters.startDate || ""}
                      onChange={(e) =>
                        applyFilters({ startDate: e.target.value || undefined })
                      }
                      className={`mt-1 ${fullInputClass}`}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs font-semibold text-gray-500 uppercase">
                      {t('filters.toDate')}
                    </label>
                    <input
                      type="text"
                      lang="en"
                      placeholder="YYYY-MM-DD"
                      onFocus={(e) => {
                        e.target.type = "date";
                        e.target.showPicker?.();
                      }}
                      onBlur={(e) => {
                        if (!e.target.value) {
                          e.target.type = "text";
                        }
                      }}
                      value={filters.endDate || ""}
                      onChange={(e) =>
                        applyFilters({ endDate: e.target.value || undefined })
                      }
                      className={`mt-1 ${fullInputClass}`}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col lg:flex-row lg:flex-wrap gap-4">
                <div className="flex-[2] min-w-[280px]">
                  <label className="text-xs font-semibold text-gray-500 uppercase">
                    Tag filters
                  </label>
                  <div className="mt-1 flex gap-2">
                    <input
                      type="text"
                      value={filterTagInput}
                      onChange={(e) => setFilterTagInput(e.target.value)}
                      onKeyDown={handleFilterTagKeyDown}
                      className={flexInputClass}
                      placeholder="Press Enter to add"
                    />
                    <Button
                      type="button"
                      onClick={handleAddFilterTag}
                      variant="outline"
                      size="sm"
                    >
                      Add
                    </Button>
                  </div>
                  {filters.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {filters.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          appearance="light"
                          size="sm"
                        >
                          #{tag}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="ml-2 h-auto w-auto p-0 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                            onClick={() => handleRemoveFilterTag(tag)}
                          >
                            ×
                          </Button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-[220px]">
                  <label className="text-xs font-semibold text-gray-500 uppercase">
                    Sort
                  </label>
                  <div className="mt-1 flex gap-2">
                    <Select
                      value={filters.sortBy}
                      onValueChange={(value) =>
                        applyFilters({ sortBy: value as any })
                      }
                    >
                      <SelectTrigger size="lg" className={flexInputClass}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FEED_SORT_FIELDS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={filters.sortDirection}
                      onValueChange={(value) =>
                        applyFilters({
                          sortDirection: value as "asc" | "desc",
                        })
                      }
                    >
                      <SelectTrigger size="lg" className={`w-28 ${baseInputClasses}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="desc">{t('filters.desc')}</SelectItem>
                        <SelectItem value="asc">{t('filters.asc')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {filtersActive ? t('filters.appliedShort') : t('filters.none')}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => fetchRecentPosts()}
                    variant="outline"
                    size="sm"
                    disabled={recentLoading}
                  >
                    {recentLoading ? t('filters.checking') : t('filters.checkNewPosts')}
                  </Button>
                  <Button
                    type="button"
                    onClick={resetFilters}
                    variant="outline"
                    size="sm"
                  >
                    {t('filters.resetFilters')}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {newPostCount > 0 && (
        <Card className="mx-5 mt-4 border-amber-300 dark:border-amber-500/60 bg-amber-50 dark:bg-amber-900/20">
          <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-100">
              {newPostCount} new post{newPostCount > 1 ? "s" : ""} arrived
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-200">
              Insert them into the feed to keep your list fresh.
            </p>
          </div>
            <Button
              onClick={consumeIncomingPosts}
              variant="primary"
              size="sm"
              className="bg-amber-500 hover:bg-amber-400 dark:hover:bg-amber-400/90"
            >
              Show latest posts
            </Button>
          </CardContent>
        </Card>
      )}

      {recentPosts.length > 0 && (
        <Card className="mx-5 mt-4 border-emerald-200 dark:border-emerald-500/50 bg-emerald-50 dark:bg-emerald-900/20">
          <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-emerald-800 dark:text-emerald-100">
                Recent posts since your last check
              </h3>
              <p className="text-xs text-emerald-700 dark:text-emerald-200">
                {recentPosts.length} items ready for review
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={markPostsChecked}
                variant="outline"
                size="sm"
                className="border-emerald-300 dark:border-emerald-500/60 text-emerald-800 dark:text-emerald-100"
              >
                Mark as reviewed
              </Button>
            </div>
          </div>
            <div className="grid gap-3 md:grid-cols-2">
              {recentPosts.slice(0, 4).map((post) => (
                <FeedPostCard
                  key={post.post_id}
                  post={post}
                  onOpen={(id) => navigate(`/feed/${id}`)}
                  isRecent
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <ScrollArea className="flex-1 px-5 py-4">
        {searchResults && (
          <div className="text-sm text-gray-600 dark:text-gray-300">
            Showing {searchResults.length} search result
            {searchResults.length !== 1 ? "s" : ""}.
            {searchError && (
              <span className="text-red-600 dark:text-red-300 ml-2">
                {searchError}
              </span>
            )}
          </div>
        )}
        {postsError && !searchResults && (
          <div className="rounded-lg border border-red-200 dark:border-red-500/60 bg-red-50 dark:bg-red-950/40 px-4 py-2 text-sm text-red-700 dark:text-red-200">
            {postsError}
          </div>
        )}

        {listLoading ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-12">
            Loading feed...
          </div>
        ) : visiblePosts.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-gray-300 dark:border-gray-700 rounded-2xl bg-gray-50 dark:bg-gray-800/50">
            <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-100">
              No posts match your filters
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Try adjusting filters or run a different search query.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {visiblePosts.map((post) => (
              <FeedPostCard
                key={post.post_id}
                post={post}
                showScore={Boolean(searchResults)}
                onOpen={(id) => navigate(`/feed/${id}`)}
                isRecent={incomingPosts.some((p) => p.post_id === post.post_id)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {!searchResults && visiblePosts.length > 0 && (
        <div className="flex-shrink-0 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm text-muted-foreground">
              Page {page} / {totalPages}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
              <Select
                value={pageSize.toString()}
                onValueChange={(value) => setPageSize(Number(value))}
              >
                <SelectTrigger size="lg" className="rounded-lg border border-gray-300 dark:border-gray-700 bg-background text-sm text-foreground px-2 py-2 focus:ring-2 focus:ring-blue-500 outline-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 30, 50].map((size) => (
                    <SelectItem key={size} value={size.toString()}>
                      {size} / page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}
        </CardContent>
      </Card>

      <FeedCreateModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreate={createPost}
        isSubmitting={createStatus === "loading"}
        error={createError}
        connector={connector || null}
      />
    </div>
  );
};

export default FeedView;
