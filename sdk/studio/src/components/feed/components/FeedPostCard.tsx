import React, { useMemo, useState } from "react";
import { FeedPost } from "@/types/feed";
import { Badge } from "@/components/layout/ui/badge";

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

// Extract the first image URL from content for preview
const extractFirstImageUrl = (content: string): string | null => {
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?[^)\s]*)?$/i;
  const urlPattern = /https?:\/\/[^\s<>"')\]]+/g;
  const urls = content.match(urlPattern) || [];
  return urls.find((url) => imageExtensions.test(url)) || null;
};

// Remove image URLs from content for cleaner display
const removeImageUrls = (content: string): string => {
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?[^)\s]*)?$/i;
  const urlPattern = /https?:\/\/[^\s<>"')\]]+/g;
  return content.replace(urlPattern, (url) =>
    imageExtensions.test(url) ? '' : url
  ).replace(/\s+/g, ' ').trim();
};

const FeedPostCard: React.FC<FeedPostCardProps> = ({
  post,
  onOpen,
  isRecent,
  showScore,
}) => {
  const attachmentsCount = post.attachments?.length || 0;
  const [imageError, setImageError] = useState(false);

  const previewImageUrl = useMemo(() => {
    return extractFirstImageUrl(post.content);
  }, [post.content]);

  const snippet = useMemo(() => {
    const textWithoutImages = removeImageUrls(post.content);
    const text = textWithoutImages.replace(/[#*_`>\-[\]()*~]/g, "");
    if (text.length <= 200) return text;
    return `${text.slice(0, 200)}...`;
  }, [post.content]);

  return (
    <article
      className={`rounded-2xl border transition-all duration-200 cursor-pointer bg-white dark:bg-gray-800 ${
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
          {isRecent && (
            <Badge variant="warning" appearance="light" size="sm">
              NEW
            </Badge>
          )}
        </div>

        <p className="text-sm text-gray-700 dark:text-gray-200 leading-6">
          {snippet || "No content available."}
        </p>

        {previewImageUrl && !imageError && (
          <img
            src={previewImageUrl}
            alt="Preview"
            className="max-h-64 rounded-lg"
            loading="lazy"
            onError={() => setImageError(true)}
          />
        )}

        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
          {post.tags?.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              appearance="light"
              size="sm"
            >
              #{tag}
            </Badge>
          ))}
          {attachmentsCount > 0 && (
            <Badge variant="secondary" appearance="light" size="sm">
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
            </Badge>
          )}
        </div>
      </div>
    </article>
  );
};

export default FeedPostCard;

