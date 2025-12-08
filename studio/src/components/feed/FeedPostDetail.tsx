import React, { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import MarkdownRenderer from "@/components/common/MarkdownRenderer";
import AttachmentDisplay from "@/pages/messaging/components/AttachmentDisplay";
import { useFeedStore } from "@/stores/feedStore";
import { useOpenAgents } from "@/context/OpenAgentsProvider";

const toMilliseconds = (timestamp: number) =>
  timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;

const FeedPostDetail: React.FC = () => {
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

  const createdAt = post
    ? new Date(toMilliseconds(post.created_at)).toLocaleString()
    : "";

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-white dark:bg-gray-950">
      <div className="px-8 py-6 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
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
            Back to feed
          </button>
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Immutable announcement
          </div>
        </div>

        {selectedPostLoading && (
          <div className="mt-6 text-gray-500 dark:text-gray-400 text-sm">
            Loading post...
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
              {post.category && (
                <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 text-xs font-semibold px-3 py-1">
                  {post.category}
                </span>
              )}
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {createdAt} • by {post.author_id}
              </span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-50">
              {post.title}
            </h1>
            {post.tags && post.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full bg-gray-200 dark:bg-gray-800 px-3 py-1 text-xs font-medium text-gray-700 dark:text-gray-300"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
            {post.allowed_groups && post.allowed_groups.length > 0 && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Restricted to: {post.allowed_groups.join(", ")}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6 bg-white dark:bg-gray-950">
        {post ? (
          <>
            <div className="prose prose-slate max-w-none dark:prose-invert">
              <MarkdownRenderer content={post.content} />
            </div>
            {attachments && attachments.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
                  Attachments
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
              Post not found.
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default FeedPostDetail;

