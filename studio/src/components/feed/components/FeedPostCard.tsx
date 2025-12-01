import React, { useMemo } from "react";
import { FeedPost } from "@/types/feed";

interface FeedPostCardProps {
  post: FeedPost;
  onOpen: (postId: string) => void;
  isRecent?: boolean;
  showScore?: boolean;
}

const formatTimestamp = (timestamp: number) => {
  const ms = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  const date = new Date(ms);
  return date.toLocaleString();
};

const FeedPostCard: React.FC<FeedPostCardProps> = ({
  post,
  onOpen,
  isRecent,
  showScore,
}) => {
  const attachmentsCount = post.attachments?.length || 0;

  const snippet = useMemo(() => {
    if (post.summary) return post.summary;
    const text = post.content.replace(/[#*_`>\-[\]()*~]/g, "");
    if (text.length <= 200) return text;
    return `${text.slice(0, 200)}...`;
  }, [post.summary, post.content]);

  return (
    <article
      className={`rounded-2xl border transition-all duration-200 cursor-pointer bg-white dark:bg-gray-900 ${
        isRecent
          ? "border-amber-400 shadow-lg shadow-amber-100/40"
          : "border-gray-200 dark:border-gray-800 hover:shadow-lg"
      }`}
      onClick={() => onOpen(post.post_id)}
    >
      <div className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {post.title}
            </h3>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>by {post.author_id}</span>
              <span>•</span>
              <span>{formatTimestamp(post.created_at)}</span>
              {showScore && post.relevance_score !== undefined && (
                <>
                  <span>•</span>
                  <span className="font-semibold text-emerald-600">
                    score: {post.relevance_score.toFixed(2)}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {post.category && (
              <span className="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-900/40 px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-200">
                {post.category}
              </span>
            )}
            {isRecent && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                NEW
              </span>
            )}
          </div>
        </div>

        <p className="text-sm text-gray-700 dark:text-gray-200 leading-6">
          {snippet || "No summary available."}
        </p>

        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
          {post.tags?.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-1 text-gray-600 dark:text-gray-300"
            >
              #{tag}
            </span>
          ))}
          {attachmentsCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-1">
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13.828 10.172a4 4 0 015.656 5.656l-4.95 4.95a4 4 0 01-5.656-5.656l1.414-1.414"
                />
              </svg>
              {attachmentsCount} attachment{attachmentsCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
    </article>
  );
};

export default FeedPostCard;

