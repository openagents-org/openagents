import React, { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useFeedStore } from "@/stores/feedStore";
import { Button } from "@/components/layout/ui/button";
import { Badge } from "@/components/layout/ui/badge";
import { Rss, RefreshCw, FileText, Hash } from "lucide-react";

const FeedSidebar: React.FC = () => {
  const { t } = useTranslation('feed');
  const navigate = useNavigate();
  const {
    posts,
    newPostCount,
    recentPosts,
    fetchRecentPosts,
    recentLoading,
    applyFilters,
    filters,
  } = useFeedStore();

  // Cache topTags so they don't disappear when filters are applied
  const [cachedTopTags, setCachedTopTags] = useState<[string, number][]>([]);

  // Update cached topTags only when posts are loaded without tag filters
  useEffect(() => {
    if (posts.length > 0 && (!filters.tags || filters.tags.length === 0)) {
      const counts: Record<string, number> = {};
      posts.slice(0, 50).forEach((post) => {
        (post.tags || []).forEach((tag) => {
          counts[tag] = (counts[tag] || 0) + 1;
        });
      });
      const newTopTags = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);
      setCachedTopTags(newTopTags);
    }
  }, [posts, filters.tags]);

  // Use cached topTags if available, otherwise calculate from current posts
  const topTags = useMemo(() => {
    if (cachedTopTags.length > 0) {
      return cachedTopTags;
    }
    // Fallback: calculate from current posts if cache is empty
    const counts: Record<string, number> = {};
    posts.slice(0, 50).forEach((post) => {
      (post.tags || []).forEach((tag) => {
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [cachedTopTags, posts]);

  const recentList = useMemo(() => {
    const combined = [...recentPosts, ...posts];
    const unique: Record<string, boolean> = {};
    const sorted = combined
      .filter((post) => {
        if (unique[post.post_id]) return false;
        unique[post.post_id] = true;
        return true;
      })
      .sort((a, b) => b.created_at - a.created_at);
    return sorted.slice(0, 4);
  }, [recentPosts, posts]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto">
        {/* Quick Actions Section */}
        <div className="py-3">
          <div className="px-4 mb-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
              {t('sidebar.quickActions')}
            </span>
          </div>
          <div className="px-2 space-y-0.5">
            <Button
              variant="ghost"
              style={{ justifyContent: 'flex-start' }}
              className="w-full h-9 px-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
              onClick={() => navigate("/feed")}
            >
              <Rss className="w-4 h-4 flex-shrink-0 mr-2" />
              <span className="text-left truncate text-sm">{t('sidebar.openOverview')}</span>
            </Button>
            <Button
              variant="ghost"
              style={{ justifyContent: 'flex-start' }}
              className="w-full h-9 px-2 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
              onClick={() => fetchRecentPosts()}
              disabled={recentLoading}
            >
              <RefreshCw className={`w-4 h-4 flex-shrink-0 mr-2 ${recentLoading ? 'animate-spin' : ''}`} />
              <span className="text-left truncate text-sm">
                {recentLoading ? t('sidebar.checking') : t('sidebar.fetchNew')}
              </span>
            </Button>
          </div>
          {newPostCount > 0 && (
            <div className="mt-3 mx-4 text-xs text-amber-700 dark:text-amber-100 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/50 rounded-lg px-3 py-2">
              {t(newPostCount > 1 ? 'sidebar.incomingPostsPlural' : 'sidebar.incomingPosts', { count: newPostCount })}
            </div>
          )}
        </div>

        {/* Latest Posts Section */}
        <div className="border-t border-gray-200 dark:border-gray-700">
          <div className="py-3">
            <div className="px-4 mb-2">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                {t('sidebar.latestPosts')}
              </span>
            </div>
            <div className="px-2 space-y-0.5">
              {recentList.map((post) => (
                <Button
                  key={post.post_id}
                  variant="ghost"
                  style={{ justifyContent: 'flex-start', alignItems: 'flex-start' }}
                  className="w-full h-auto px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                  onClick={() => navigate(`/feed/${post.post_id}`)}
                >
                  <FileText className="w-4 h-4 flex-shrink-0 mr-2 mt-0.5 text-gray-400" />
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-medium break-words whitespace-normal leading-snug">
                      {post.title}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {new Date(
                        post.created_at < 1_000_000_000_000
                          ? post.created_at * 1000
                          : post.created_at
                      ).toLocaleString()}
                    </p>
                  </div>
                </Button>
              ))}
              {recentList.length === 0 && (
                <p className="px-2 text-xs text-gray-500 dark:text-gray-400">
                  {t('sidebar.noPosts')}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Trending Tags Section */}
        <div className="border-t border-gray-200 dark:border-gray-700">
          <div className="py-3">
            <div className="px-4 mb-2">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                {t('sidebar.trendingTags')}
              </span>
            </div>
            <div className="px-4 flex flex-wrap gap-1.5">
              {topTags.length > 0 ? (
                topTags.map(([tag, count]) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    appearance="light"
                    size="sm"
                    className="cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600"
                    onClick={() => {
                      applyFilters({ tags: [tag] });
                      navigate("/feed");
                    }}
                  >
                    <Hash className="w-3 h-3" />
                    {tag}
                    <span className="ml-1 text-gray-500 dark:text-gray-400">
                      {count}
                    </span>
                  </Badge>
                ))
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('sidebar.tagsPlaceholder')}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FeedSidebar;
