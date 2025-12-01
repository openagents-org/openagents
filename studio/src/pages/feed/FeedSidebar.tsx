import React, { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useFeedStore } from "@/stores/feedStore";
import { FEED_CATEGORY_OPTIONS } from "@/types/feed";

const FeedSidebar: React.FC = () => {
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
    <div className="h-full flex flex-col bg-slate-50 dark:bg-gray-950 border-r border-gray-200 dark:border-gray-800">
      <div className="px-4 py-4 border-b border-gray-200 dark:border-gray-800">
        <p className="text-xs uppercase tracking-wide text-blue-600 dark:text-blue-300 font-semibold">
          Feed Console
        </p>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Quick Actions
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        <section className="space-y-3">
          <button
            onClick={() => navigate("/feed")}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-900"
          >
            Open Feed Overview
          </button>
          <button
            onClick={() => fetchRecentPosts()}
            disabled={recentLoading}
            className="w-full px-3 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 disabled:opacity-60"
          >
            {recentLoading ? "Checking..." : "Fetch New Posts"}
          </button>
          {newPostCount > 0 && (
            <div className="text-xs text-amber-700 dark:text-amber-100 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/50 rounded-xl px-3 py-2">
              {newPostCount} incoming post{newPostCount > 1 ? "s" : ""} pending
              merge.
            </div>
          )}
        </section>

        <section>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
            Quick category filters
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {FEED_CATEGORY_OPTIONS.map((category) => (
              <button
                key={category.value}
                className="px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
                onClick={() => {
                  applyFilters({ category: category.value });
                  navigate("/feed");
                }}
              >
                {category.label}
              </button>
            ))}
            <button
              className="px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800"
              onClick={() => {
                applyFilters({ category: "all" });
                navigate("/feed");
              }}
            >
              Show all
            </button>
          </div>
        </section>

        <section>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
            Latest posts
          </h3>
          <div className="space-y-3">
            {recentList.map((post) => (
              <button
                key={post.post_id}
                onClick={() => navigate(`/feed/${post.post_id}`)}
                className="w-full text-left px-3 py-2 rounded-xl border border-gray-200 hover:bg-white dark:border-gray-700 dark:hover:bg-gray-900"
              >
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                  {post.title}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                  {new Date(
                    post.created_at < 1_000_000_000_000
                      ? post.created_at * 1000
                      : post.created_at
                  ).toLocaleString()}
                </p>
              </button>
            ))}
            {recentList.length === 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                No posts yet.
              </p>
            )}
          </div>
        </section>

        <section>
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
            Trending tags
          </h3>
          <div className="flex flex-wrap gap-2">
            {topTags.length > 0 ? (
              topTags.map(([tag, count]) => (
                <button
                  key={tag}
                  className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-800 px-3 py-1 text-xs font-medium text-gray-700 dark:text-gray-200"
                  onClick={() => {
                    applyFilters({ tags: [tag] });
                    navigate("/feed");
                  }}
                >
                  #{tag}
                  <span className="ml-1 text-gray-500 dark:text-gray-400">
                    {count}
                  </span>
                </button>
              ))
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Tags will appear here.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default FeedSidebar;

