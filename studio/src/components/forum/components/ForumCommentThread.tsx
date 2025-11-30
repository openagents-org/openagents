import React, { useState } from 'react';
import MarkdownRenderer from '@/components/common/MarkdownRenderer';
import { ForumComment } from '@/stores/forumStore';
import { useForumStore } from '@/stores/forumStore';
import { toast } from "sonner";

interface ForumCommentThreadProps {
  comments: ForumComment[];
  topicId: string;
  maxDepth?: number;
}

const ForumCommentThread: React.FC<ForumCommentThreadProps> = ({
  comments,
  topicId,
  maxDepth = 5
}) => {
  return (
    <div className="space-y-3">
      {comments.map((comment) => (
        <ForumCommentItem
          key={comment.comment_id}
          comment={comment}
          topicId={topicId}
          maxDepth={maxDepth}
        />
      ))}
    </div>
  );
};

interface ForumCommentItemProps {
  comment: ForumComment;
  topicId: string;
  maxDepth: number;
}

const ForumCommentItem: React.FC<ForumCommentItemProps> = React.memo(({
  comment,
  topicId,
  maxDepth
}) => {
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { vote, addComment } = useForumStore();

  const handleVote = async (voteType: 'upvote' | 'downvote') => {
    await vote('comment', comment.comment_id, voteType, (message) => toast.error(message));
  };

  const handleReply = async () => {
    if (!replyContent.trim()) return;

    setIsSubmitting(true);
    const success = await addComment(topicId, replyContent.trim(), comment.comment_id);

    if (success) {
      setReplyContent('');
      setShowReplyForm(false);
      setShowPreview(false);
    }
    setIsSubmitting(false);
  };

  const timeAgo = new Date(comment.timestamp * 1000).toLocaleString();

  return (
    <div
      className={`border-l-2 pl-4 ${
        comment.thread_level > 0
          ? 'border-gray-300 dark:border-gray-600'
          : 'border-transparent'
      }`}
      style={{
        marginLeft: `${Math.min(comment.thread_level, maxDepth) * 20}px`
      }}
    >
      <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800">
        {/* Comment header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {comment.author_id}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {timeAgo}
            </span>
          </div>

          {/* Vote buttons */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleVote('upvote')}
              className="flex items-center space-x-1 p-1 rounded transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400"
            >
              <span className="text-sm">👍</span>
              <span className="text-xs font-medium">
                {comment.upvotes}
              </span>
            </button>
            <button
              onClick={() => handleVote('downvote')}
              className="flex items-center space-x-1 p-1 rounded transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400"
            >
              <span className="text-sm">👎</span>
              <span className="text-xs font-medium">
                {comment.downvotes}
              </span>
            </button>
          </div>
        </div>

        {/* Comment content */}
        <div className="mb-3">
          <MarkdownRenderer
            content={comment.content}
          />
        </div>

        {/* Reply button */}
        {comment.thread_level < maxDepth && (
          <button
            onClick={() => setShowReplyForm(!showReplyForm)}
            className="text-sm transition-colors text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
          >
            Reply
          </button>
        )}

        {/* Reply form */}
        {showReplyForm && (
          <div className="mt-4 p-3 rounded-lg border border-dashed border-gray-400">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                Reply (Markdown supported)
              </label>
              <button
                type="button"
                onClick={() => setShowPreview(!showPreview)}
                className={`text-xs px-2 py-1 rounded transition-colors ${
                  showPreview
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {showPreview ? 'Edit' : 'Preview'}
              </button>
            </div>

            {showPreview ? (
              <div className="w-full p-2 rounded border min-h-[60px] mb-3 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600">
                {replyContent.trim() ? (
                  <MarkdownRenderer
                    content={replyContent}
                  />
                ) : (
                  <p className="text-gray-400 dark:text-gray-500">
                    Preview will appear here...
                  </p>
                )}
              </div>
            ) : (
              <textarea
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder="Write your reply..."
                rows={3}
                className="w-full p-2 rounded border mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
              />
            )}

            <div className="flex justify-end space-x-2">
              <button
                onClick={() => {
                  setShowReplyForm(false);
                  setReplyContent('');
                  setShowPreview(false);
                }}
                disabled={isSubmitting}
                className="px-3 py-1 text-sm rounded transition-colors bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReply}
                disabled={!replyContent.trim() || isSubmitting}
                className={`px-3 py-1 text-sm text-white rounded transition-colors ${
                  !replyContent.trim() || isSubmitting
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {isSubmitting ? 'Posting...' : 'Post Reply'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Recursively render child comments */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-3">
          <ForumCommentThread
            comments={comment.replies}
            topicId={topicId}
            maxDepth={maxDepth}
          />
        </div>
      )}
    </div>
  );
});

ForumCommentItem.displayName = 'ForumCommentItem';

export default ForumCommentThread;