import React, { useState, useEffect, useContext } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useInterviewStore } from "@/stores/interviewStore";
import MarkdownRenderer from "@/components/common/MarkdownRenderer";
import InterviewCommentThread from "./components/InterviewCommentThread";
import InterviewAddCommentModal from "./components/InterviewAddCommentModal";
import { OpenAgentsContext } from "@/context/OpenAgentsProvider";
import { Document, Page, pdfjs } from 'react-pdf';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface InterviewTopicDetailProps {}

const InterviewTopicDetail: React.FC<InterviewTopicDetailProps> = () => {
  const context = useContext(OpenAgentsContext);
  const { topicId } = useParams<{ topicId: string }>();
  const navigate = useNavigate();

  const [isAddCommentModalOpen, setIsAddCommentModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [showPdf, setShowPdf] = useState(true);
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

  // Reset selected topic when component unmounts
  useEffect(() => {
    return () => {
      console.log("InterviewTopicDetail: Cleanup - resetting selected topic");
      resetSelectedTopic();
    };
  }, [resetSelectedTopic]);

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

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPdfError(null);
  };

  const onDocumentLoadError = (error: Error) => {
    console.error("Error loading PDF:", error);
    setPdfError("Failed to load resume PDF");
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

      {/* Main content - split view */}
      <div className="flex-1 flex overflow-hidden dark:bg-gray-900">
        {/* Left side - Topic and Comments */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-gray-200 dark:border-gray-700">
          <div className="flex-1 flex flex-col overflow-y-auto">
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

        {/* Right side - PDF Resume Preview */}
        <div className="w-96 flex flex-col bg-gray-50 dark:bg-gray-800">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
              </svg>
              <h3 className="font-medium text-gray-900 dark:text-gray-100">Resume</h3>
            </div>
            <button
              onClick={() => setShowPdf(!showPdf)}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={showPdf ? "M19 9l-7 7-7-7" : "M5 15l7-7 7 7"} />
              </svg>
            </button>
          </div>

          {showPdf && (
            <div className="flex-1 overflow-y-auto p-4">
              {pdfError ? (
                <div className="text-center py-8">
                  <div className="text-red-500 mb-4">
                    <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{pdfError}</p>
                  <a
                    href={selectedTopic.resume_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-4 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Open in new tab
                  </a>
                </div>
              ) : (
                <div className="space-y-4">
                  <Document
                    file={selectedTopic.resume_url}
                    onLoadSuccess={onDocumentLoadSuccess}
                    onLoadError={onDocumentLoadError}
                    loading={
                      <div className="text-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
                        <p className="text-sm text-gray-600 dark:text-gray-400">Loading resume...</p>
                      </div>
                    }
                  >
                    <Page
                      pageNumber={pageNumber}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      width={320}
                      className="shadow-lg"
                    />
                  </Document>

                  {numPages && numPages > 1 && (
                    <div className="flex items-center justify-center space-x-4 py-2">
                      <button
                        onClick={() => setPageNumber(Math.max(1, pageNumber - 1))}
                        disabled={pageNumber <= 1}
                        className="px-3 py-1 text-sm rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        Page {pageNumber} of {numPages}
                      </span>
                      <button
                        onClick={() => setPageNumber(Math.min(numPages, pageNumber + 1))}
                        disabled={pageNumber >= numPages}
                        className="px-3 py-1 text-sm rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  )}

                  <div className="text-center">
                    <a
                      href={selectedTopic.resume_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Open in new tab
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add comment modal */}
      <InterviewAddCommentModal
        isOpen={isAddCommentModalOpen}
        onClose={() => setIsAddCommentModalOpen(false)}
        onSubmit={handleAddComment}
        isSubmitting={isSubmitting}
      />
    </div>
  );
};

export default InterviewTopicDetail;
