import React, { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import MarkdownRenderer from "@/components/common/MarkdownRenderer";
import AttachmentDisplay from "@/pages/messaging/components/AttachmentDisplay";
import { useFeedStore } from "@/stores/feedStore";
import { useOpenAgents } from "@/context/OpenAgentsProvider";
import { Badge } from "@/components/layout/ui/badge";

const toMilliseconds = (timestamp: number) =>
  timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;

// Extract image URLs from content
const extractImageUrls = (content: string): string[] => {
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?[^)\s]*)?$/i;
  const urlPattern = /https?:\/\/[^\s<>"')\]]+/g;
  const urls = content.match(urlPattern) || [];
  return Array.from(new Set(urls.filter((url) => imageExtensions.test(url))));
};

// Remove image URLs from content for cleaner display
const removeImageUrls = (content: string): string => {
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?[^)\s]*)?$/i;
  const urlPattern = /https?:\/\/[^\s<>"')\]]+/g;
  return content.replace(urlPattern, (url) =>
    imageExtensions.test(url) ? '' : url
  ).trim();
};

const FeedPostDetail: React.FC = () => {
  const { t } = useTranslation('feed');
  const { postId } = useParams();
  const navigate = useNavigate();
  const { connector, connectionStatus } = useOpenAgents();
  const {
    posts,
    selectedPost,
    selectedPostLoading,
    selectedPostError,
    fetchPostById,
    resetSelectedPost,
  } = useFeedStore();

  useEffect(() => {
    if (!postId) return;
    fetchPostById(postId);
    return () => resetSelectedPost();
  }, [postId, fetchPostById, resetSelectedPost]);

  const post =
    posts.find((item) => item.post_id === postId) || selectedPost || null;

  const attachments = post?.attachments?.map((attachment) => ({
    fileId: attachment.file_id,
    filename: attachment.filename,
    size: attachment.size,
  }));

  const imageUrls = useMemo(() => {
    if (!post?.content) return [];
    return extractImageUrls(post.content);
  }, [post?.content]);

  const cleanedContent = useMemo(() => {
    if (!post?.content) return '';
    return removeImageUrls(post.content);
  }, [post?.content]);

  const createdAt = post
    ? new Date(toMilliseconds(post.created_at)).toLocaleString()
    : "";

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-white dark:bg-gray-800">
      <div className="px-8 py-6 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
          >
            <svg
              className="w-4 h-4 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            {t('detail.backToFeed')}
          </button>
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t('detail.immutableAnnouncement')}
          </div>
        </div>

        {selectedPostLoading && (
          <div className="mt-6 text-gray-500 dark:text-gray-400 text-sm">
            {t('detail.loading')}
          </div>
        )}
        {selectedPostError && (
          <div className="mt-6 text-red-600 dark:text-red-400 text-sm">
            {selectedPostError}
          </div>
        )}
        {post && (
          <div className="mt-6 space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {createdAt} • {t('detail.postedBy', { author: post.author_id })}
              </span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-50 break-words">
              {post.title}
            </h1>
            {post.tags && post.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {post.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    appearance="light"
                    size="sm"
                  >
                    #{tag}
                  </Badge>
                ))}
              </div>
            )}
            {post.allowed_groups && post.allowed_groups.length > 0 && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {t('detail.restrictedTo', { groups: post.allowed_groups.join(", ") })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6 bg-white dark:bg-gray-800">
        {post ? (
          <>
            <div className="prose prose-slate max-w-none dark:prose-invert break-words [&_a]:break-all [&_p]:break-words">
              <MarkdownRenderer content={cleanedContent} />
            </div>
            {imageUrls.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {imageUrls.map((url, index) => (
                  <a
                    key={index}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                  >
                    <img
                      src={url}
                      alt={`Attachment ${index + 1}`}
                      className="w-full h-auto object-cover"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </a>
                ))}
              </div>
            )}
            {attachments && attachments.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
                  {t('detail.attachments')}
                </h2>
                <AttachmentDisplay
                  attachments={attachments}
                  networkHost={connector?.getHost()}
                  networkPort={connector?.getPort()}
                  agentId={connectionStatus.agentId}
                  agentSecret={connector?.getSecret()}
                />
              </div>
            )}
          </>
        ) : (
          !selectedPostLoading && (
            <div className="text-center text-gray-500 dark:text-gray-400">
              {t('detail.notFound')}
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default FeedPostDetail;

