import React, { useState, useEffect, useContext } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useInterviewStore } from "@/stores/interviewStore";
import MarkdownRenderer from "@/components/common/MarkdownRenderer";
import InterviewCommentThread from "./components/InterviewCommentThread";
import InterviewAddCommentModal from "./components/InterviewAddCommentModal";
import { OpenAgentsContext } from "@/context/OpenAgentsProvider";

interface InterviewTopicDetailProps {}

const InterviewTopicDetail: React.FC<InterviewTopicDetailProps> = () => {
  const context = useContext(OpenAgentsContext);
  const { topicId } = useParams<{ topicId: string }>();
  const navigate = useNavigate();

  const [isAddCommentModalOpen, setIsAddCommentModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

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
    resetSelectedTopic,
    getTotalComments,
  } = useInterviewStore();

  // Use real-time calculated total comments
  const totalComments = getTotalComments();

  // Set connection
  useEffect(() => {
    if (openAgentsService) {
      console.log("InterviewTopicDetail: Setting connection");
      setConnection(openAgentsService);
    }
  }, [openAgentsService, setConnection]);

  // Load topic detail (wait for connection to be established)
  useEffect(() => {
    if (topicId && openAgentsService && isConnected) {
      console.log(
        "InterviewTopicDetail: Connection ready, loading topic detail for:",
        topicId
      );
      loadTopicDetail(topicId);
    } else {
      console.log(
        "InterviewTopicDetail: Waiting for connection or missing topicId",
        {
          topicId,
          hasService: !!openAgentsService,
          isConnected,
        }
      );
    }
  }, [topicId, openAgentsService, isConnected, loadTopicDetail]);

  // Use embedded blob if available (no need to download)
  useEffect(() => {
    if (selectedTopic?.resume_blob && !pdfBlobUrl) {
      console.log("InterviewTopicDetail: Using embedded resume blob");
      try {
        // Convert base64 to blob
        const binaryString = atob(selectedTopic.resume_blob);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(blob);
        setPdfBlobUrl(blobUrl);
        console.log("InterviewTopicDetail: PDF blob URL created from embedded data");
      } catch (error) {
        console.error("InterviewTopicDetail: Failed to create blob from embedded data:", error);
        setPdfError("Failed to load PDF from embedded data");
      }
    }
  }, [selectedTopic, pdfBlobUrl]);

  // Reset selected topic when component unmounts
  useEffect(() => {
    return () => {
      console.log("InterviewTopicDetail: Cleanup - resetting selected topic");
      // Clean up blob URL
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl);
      }
      resetSelectedTopic();
    };
  }, [resetSelectedTopic, pdfBlobUrl]);

  // Open PDF preview modal
  const handleTogglePdfPreview = async () => {
    // If blob URL already exists (from embedded blob or previous download), just open modal
    if (pdfBlobUrl) {
      setShowPdfPreview(true);
      return;
    }

    // Otherwise, need to download PDF from file system
    if (!pdfLoading) {
      await loadPdfBlob();
    }
    // Open modal
    setShowPdfPreview(true);
  };

  const handleBack = () => {
    navigate("/interview");
  };

  const handleAddComment = async (content: string) => {
    if (!content.trim() || !topicId) return false;

    setIsSubmitting(true);
    const success = await addComment(topicId, content.trim());
    setIsSubmitting(false);

    return success;
  };

  const loadPdfBlob = async () => {
    if (!selectedTopic?.resume_url || !openAgentsService) return;

    // Extract file_id from file:// URL
    const fileId = selectedTopic.resume_url.replace('file://', '');

    setPdfLoading(true);
    setPdfError(null);

    try {
      // Download file via send event
      const response = await openAgentsService.sendEvent({
        event_name: 'interview.file.download',
        destination_id: 'mod:openagents.mods.workspace.interview',
        payload: {
          file_id: fileId
        }
      });

      if (response.success && response.data?.file_content) {
        // Decode base64 and create blob URL
        const base64Content = response.data.file_content;
        const binaryString = atob(base64Content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(blob);
        setPdfBlobUrl(blobUrl);
      } else {
        throw new Error(response.message || 'Failed to download PDF');
      }
    } catch (error: any) {
      console.error('Failed to load PDF:', error);
      setPdfError(error.message || 'Failed to load PDF');
    } finally {
      setPdfLoading(false);
    }
  };

  // Show connection waiting state
  if (!openAgentsService || !isConnected) {
    return (
      <div className="flex-1 flex items-center justify-center dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">
            {!openAgentsService
              ? "Connecting to network..."
              : "Establishing connection..."}
          </p>
        </div>
      </div>
    );
  }

  // Show loading state
  if (commentsLoading && !selectedTopic) {
    return (
      <div className="flex-1 flex items-center justify-center dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading interview session...</p>
        </div>
      </div>
    );
  }

  // Show error state
  if (commentsError || !selectedTopic) {
    return (
      <div className="flex-1 flex items-center justify-center">
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
            {commentsError || "Interview session not found"}
          </p>
          <button
            onClick={handleBack}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Back to Interview List
          </button>
        </div>
      </div>
    );
  }

  const timeAgo = new Date(selectedTopic.timestamp * 1000).toLocaleString();

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header navigation */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
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
          <span>Back to Interview List</span>
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto dark:bg-gray-900">
        <div className="flex flex-col">
          <div className="flex flex-col">
            {/* Topic content */}
            <div className="p-6 border-b bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700">
              {/* Topic title */}
              <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
                {selectedTopic.title}
              </h1>

              {/* Topic meta info */}
              <div className="flex items-center justify-between mb-4 text-sm text-gray-600 dark:text-gray-400">
                <div className="flex items-center space-x-3">
                  <span>by {selectedTopic.owner_id}</span>
                  <span>•</span>
                  <span>{timeAgo}</span>
                  <span>•</span>
                  <div className="flex items-center space-x-1">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <span>Private</span>
                  </div>
                </div>
                <span>{totalComments} comments</span>
              </div>

              {/* Topic content */}
              <div className="mb-4">
                <MarkdownRenderer content={selectedTopic.content} />
              </div>

              {/* PDF Preview Button */}
              <div className="mb-4">
                <button
                  onClick={handleTogglePdfPreview}
                  disabled={pdfLoading}
                  className="flex items-center space-x-2 px-4 py-2 rounded-md transition-colors bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  {pdfLoading ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-700 dark:border-gray-300" />
                  ) : (
                    <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                    </svg>
                  )}
                  <span className="text-sm font-medium">
                    {pdfLoading ? 'Loading...' : 'View Resume (PDF)'}
                  </span>
                </button>
              </div>

              {/* Add comment button */}
              <div className="flex items-center justify-end">
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
                  <span className="text-sm font-medium">Add Comment</span>
                </button>
              </div>
            </div>

            {/* Comments title */}
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Comments ({totalComments})
              </h2>
            </div>

            {/* Comments list - scrollable middle area */}
            <div className="py-4 pb-6">
              {commentsLoading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
                  <p className="text-gray-600 dark:text-gray-400">
                    Loading comments...
                  </p>
                </div>
              ) : comments.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-600 dark:text-gray-400">
                    No comments yet. Be the first to comment!
                  </p>
                </div>
              ) : (
                <InterviewCommentThread
                  comments={comments}
                  topicId={selectedTopic.topic_id}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add comment modal */}
      <InterviewAddCommentModal
        isOpen={isAddCommentModalOpen}
        onClose={() => setIsAddCommentModalOpen(false)}
        onSubmit={handleAddComment}
        isSubmitting={isSubmitting}
      />

      {/* PDF Preview Modal */}
      {showPdfPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75">
          <div className="relative w-full h-full max-w-6xl max-h-[90vh] m-4 bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Resume Preview
              </h3>
              <button
                onClick={() => setShowPdfPreview(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Content */}
            <div className="h-[calc(100%-4rem)] overflow-hidden">
              {pdfError ? (
                <div className="flex flex-col items-center justify-center h-full">
                  <div className="text-red-500 mb-4">
                    <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{pdfError}</p>
                  <button
                    onClick={loadPdfBlob}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Retry
                  </button>
                </div>
              ) : pdfBlobUrl ? (
                <iframe
                  src={pdfBlobUrl}
                  className="w-full h-full"
                  title="Resume PDF"
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mb-4" />
                  <p className="text-sm text-gray-600 dark:text-gray-400">Loading resume...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InterviewTopicDetail;
