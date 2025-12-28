import React, { useState, useEffect, useContext } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useForumStore } from "@/stores/forumStore";
import MarkdownRenderer from "@/components/common/MarkdownRenderer";
import ForumCommentThread from "./components/ForumCommentThread";
import ForumAddCommentModal from "./components/ForumAddCommentModal";
import { toast } from "sonner";
import { OpenAgentsContext } from "@/context/OpenAgentsProvider";

interface ForumTopicDetailProps {}

const ForumTopicDetail: React.FC<ForumTopicDetailProps> = () => {
  const { t } = useTranslation('forum');
  const context = useContext(OpenAgentsContext);
  const { topicId } = useParams<{ topicId: string }>();
  const navigate = useNavigate();

  const [isAddCommentModalOpen, setIsAddCommentModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const openAgentsService = context?.connector;
  const isConnected = context?.isConnected;

  const {
    selectedTopic,
    comments,
    commentsLoading,
    commentsError,
    setConnection,
    loadTopicDetail,
    addComment,
    vote,
    resetSelectedTopic,
    getTotalComments,
  } = useForumStore();

  // Use real-time calculated total comment count
  const totalComments = getTotalComments();

  // Set connection
  useEffect(() => {
    if (openAgentsService) {
      console.log("ForumTopicDetail: Setting connection");
      setConnection(openAgentsService);
    }
  }, [openAgentsService, setConnection]);

  // Load topic details (wait for connection to be established)
  useEffect(() => {
    if (topicId && openAgentsService && isConnected) {
      console.log(
        "ForumTopicDetail: Connection ready, loading topic detail for:",
        topicId
      );
      loadTopicDetail(topicId);
    } else {
      console.log(
        "ForumTopicDetail: Waiting for connection or missing topicId",
        {
          topicId,
          hasService: !!openAgentsService,
          isConnected,
        }
      );
    }
  }, [topicId, openAgentsService, isConnected, loadTopicDetail]);

  // Reset selected topic when component unmounts
  useEffect(() => {
    return () => {
      console.log("ForumTopicDetail: Cleanup - resetting selected topic");
      resetSelectedTopic();
    };
  }, [resetSelectedTopic]);

  const handleBack = () => {
    navigate("/forum");
  };

  const handleVote = async (voteType: "upvote" | "downvote") => {
    if (selectedTopic) {
      await vote("topic", selectedTopic.topic_id, voteType, (message) => toast.error(message));
    }
  };

  const handleAddComment = async (content: string) => {
    if (!content.trim() || !topicId) return false;

    setIsSubmitting(true);
    const success = await addComment(topicId, content.trim());
    setIsSubmitting(false);

    return success;
  };

  // Display connection waiting status
  if (!openAgentsService || !isConnected) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-gray-800">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">
            {!openAgentsService
              ? t('detail.connectingToNetwork')
              : t('detail.establishingConnection')}
          </p>
        </div>
      </div>
    );
  }

  // Display loading state
  if (commentsLoading && !selectedTopic) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-gray-800">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">{t('detail.loadingTopic')}</p>
        </div>
      </div>
    );
  }

  // Display error state
  if (commentsError || !selectedTopic) {
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
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            {commentsError || t('detail.topicNotFound')}
          </p>
          <button
            onClick={handleBack}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            {t('detail.backToForumList')}
          </button>
        </div>
      </div>
    );
  }

  const timeAgo = new Date(selectedTopic.timestamp * 1000).toLocaleString();

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-gray-800">
      {/* Header navigation */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center bg-white dark:bg-gray-800">
        <button
          onClick={handleBack}
          className="flex items-center space-x-2 text-sm transition-colors text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
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
              d="M15 19l-7-7 7-7"
            />
          </svg>
          <span>{t('detail.backToForumList')}</span>
        </button>
      </div>

      {/* Main content - using full width */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
        <div className="flex-1 flex flex-col overflow-y-auto">
          {/* Topic content */}
          <div className="p-6 border-b bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
            {/* Topic title */}
            <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
              {selectedTopic.title}
            </h1>

            {/* Topic meta information */}
            <div className="flex items-center justify-between mb-4 text-sm text-gray-600 dark:text-gray-400">
              <span>
                {t('detail.by', { user: selectedTopic.owner_id, time: timeAgo })}
              </span>
              <span>{t('detail.commentsCount', { count: totalComments })}</span>
            </div>

            {/* Topic content */}
            <div className="mb-4">
              <MarkdownRenderer content={selectedTopic.content} />
            </div>

            {/* Vote and add comment buttons */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => handleVote("upvote")}
                  className="flex items-center space-x-1 p-2 rounded transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400"
                >
                  <span className="text-lg">👍</span>
                  <span className="text-sm font-medium">
                    {selectedTopic.upvotes}
                  </span>
                </button>
                <button
                  onClick={() => handleVote("downvote")}
                  className="flex items-center space-x-1 p-2 rounded transition-colors hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                >
                  <span className="text-lg">👎</span>
                  <span className="text-sm font-medium">
                    {selectedTopic.downvotes}
                  </span>
                </button>
              </div>

              {/* Add comment button */}
              <button
                onClick={() => setIsAddCommentModalOpen(true)}
                className="flex items-center space-x-2 px-4 py-2 rounded-md transition-colors bg-blue-600 text-white hover:bg-blue-700"
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
                <span className="text-sm font-medium">{t('detail.addComment')}</span>
              </button>
            </div>
          </div>

          {/* Comments title */}
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t('detail.commentsTitle', { count: totalComments })}
            </h2>
          </div>

          {/* Comments list - scrollable middle area */}
          <div className="py-4 pb-6">
            {commentsLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
                <p className="text-gray-600 dark:text-gray-400">
                  {t('detail.loadingComments')}
                </p>
              </div>
            ) : comments.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-600 dark:text-gray-400">
                  {t('detail.noCommentsYet')}
                </p>
              </div>
            ) : (
              <ForumCommentThread
                comments={comments}
                topicId={selectedTopic.topic_id}
              />
            )}
          </div>
        </div>
      </div>

      {/* Add comment modal */}
      <ForumAddCommentModal
        isOpen={isAddCommentModalOpen}
        onClose={() => setIsAddCommentModalOpen(false)}
        onSubmit={handleAddComment}
        isSubmitting={isSubmitting}
      />
    </div>
  );
};

export default ForumTopicDetail;
