import React, { useState, useEffect, useContext } from "react"
import { useInterviewStore } from "@/stores/interviewStore"
import InterviewTopicItem from "@/components/interview/components/InterviewTopicItem"
import InterviewCreateModal from "@/components/interview/components/InterviewCreateModal"
import InterviewCommentThread from "@/components/interview/components/InterviewCommentThread"
import InterviewAddCommentModal from "@/components/interview/components/InterviewAddCommentModal"
import MarkdownRenderer from "@/components/common/MarkdownRenderer"
import { OpenAgentsContext } from "@/context/OpenAgentsProvider"

const DiscussionView: React.FC = () => {
  const context = useContext(OpenAgentsContext)
  const openAgentsService = context?.connector
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null)
  const [isAddCommentModalOpen, setIsAddCommentModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPdfPreview, setShowPdfPreview] = useState(false)
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const isConnected = context?.isConnected

  const {
    topics,
    topicsLoading,
    topicsError,
    selectedTopic,
    comments,
    commentsLoading,
    commentsError,
    setConnection,
    setGroupsData,
    setAgentId,
    loadTopics,
    loadTopicDetail,
    addComment,
    resetSelectedTopic,
    getTotalComments,
  } = useInterviewStore()

  // Use real-time calculated total comments
  const totalComments = selectedTopic ? getTotalComments() : 0

  // Set connection
  useEffect(() => {
    if (openAgentsService) {
      setConnection(openAgentsService)
    }
  }, [openAgentsService, setConnection])

  // Initialize permission data
  useEffect(() => {
    const initializePermissions = async () => {
      if (!openAgentsService) return

      try {
        // Get current agent ID
        const agentId = openAgentsService.getAgentId()
        if (agentId) {
          console.log("DiscussionView: Setting agentId:", agentId)
          setAgentId(agentId)
        }

        // Get groups data
        const healthData = await openAgentsService.getNetworkHealth()
        if (healthData && healthData.groups) {
          console.log("DiscussionView: Setting groupsData:", healthData.groups)
          setGroupsData(healthData.groups)
        }
      } catch (error) {
        console.error(
          "DiscussionView: Failed to initialize permissions:",
          error
        )
      }
    }

    initializePermissions()
  }, [openAgentsService, setGroupsData, setAgentId])

  // Load topics (wait for connection to be established)
  useEffect(() => {
    if (openAgentsService && isConnected) {
      console.log("DiscussionView: Connection ready, loading topics")
      loadTopics()
    }
  }, [openAgentsService, isConnected, loadTopics])

  // Load topic detail when selectedTopicId changes
  useEffect(() => {
    if (selectedTopicId && openAgentsService && isConnected) {
      console.log(
        "DiscussionView: Connection ready, loading topic detail for:",
        selectedTopicId
      )
      loadTopicDetail(selectedTopicId)
    } else if (!selectedTopicId) {
      resetSelectedTopic()
    }
  }, [
    selectedTopicId,
    openAgentsService,
    isConnected,
    loadTopicDetail,
    resetSelectedTopic,
  ])

  // Use embedded blob if available (no need to download)
  useEffect(() => {
    if (selectedTopic?.resume_blob && !pdfBlobUrl) {
      console.log("DiscussionView: Using embedded resume blob")
      try {
        // Convert base64 to blob
        const binaryString = atob(selectedTopic.resume_blob)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        const blob = new Blob([bytes], { type: "application/pdf" })
        const blobUrl = URL.createObjectURL(blob)
        setPdfBlobUrl(blobUrl)
        console.log("DiscussionView: PDF blob URL created from embedded data")
      } catch (error) {
        console.error(
          "DiscussionView: Failed to create blob from embedded data:",
          error
        )
        setPdfError("Failed to load PDF from embedded data")
      }
    }
  }, [selectedTopic, pdfBlobUrl])

  // Reset selected topic when component unmounts or topicId changes
  useEffect(() => {
    return () => {
      console.log("DiscussionView: Cleanup - resetting selected topic")
      // Clean up blob URL
      if (pdfBlobUrl) {
        URL.revokeObjectURL(pdfBlobUrl)
      }
      resetSelectedTopic()
    }
  }, [resetSelectedTopic, pdfBlobUrl])

  // Handle topic item click
  const handleTopicClick = (topicId: string) => {
    setSelectedTopicId(topicId)
  }

  // Handle back to list
  const handleBack = () => {
    setSelectedTopicId(null)
    if (pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl)
      setPdfBlobUrl(null)
    }
    setPdfError(null)
  }

  // Handle add comment
  const handleAddComment = async (content: string) => {
    if (!content.trim() || !selectedTopicId) return false

    setIsSubmitting(true)
    const success = await addComment(selectedTopicId, content.trim())
    setIsSubmitting(false)

    return success
  }

  // Open PDF preview modal
  const handleTogglePdfPreview = async () => {
    // If blob URL already exists (from embedded blob or previous download), just open modal
    if (pdfBlobUrl) {
      setShowPdfPreview(true)
      return
    }

    // Otherwise, need to download PDF from file system
    if (!pdfLoading) {
      await loadPdfBlob()
    }
    // Open modal
    setShowPdfPreview(true)
  }

  const loadPdfBlob = async () => {
    if (!selectedTopic?.resume_url || !openAgentsService) return

    // Extract file_id from file:// URL
    const fileId = selectedTopic.resume_url.replace("file://", "")

    setPdfLoading(true)
    setPdfError(null)

    try {
      // Download file via send event
      const response = await openAgentsService.sendEvent({
        event_name: "interview.file.download",
        destination_id: "mod:openagents.mods.workspace.interview",
        payload: {
          file_id: fileId,
        },
      })

      if (response.success && response.data?.file_content) {
        // Decode base64 and create blob URL
        const base64Content = response.data.file_content
        const binaryString = atob(base64Content)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        const blob = new Blob([bytes], { type: "application/pdf" })
        const blobUrl = URL.createObjectURL(blob)
        setPdfBlobUrl(blobUrl)
      } else {
        throw new Error(response.message || "Failed to download PDF")
      }
    } catch (error: any) {
      console.error("Failed to load PDF:", error)
      setPdfError(error.message || "Failed to load PDF")
    } finally {
      setPdfLoading(false)
    }
  }

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
    )
  }

  // Show loading state for list
  if (topicsLoading && topics.length === 0 && !selectedTopicId) {
    return (
      <div className="flex-1 flex items-center justify-center dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">
            Loading interview sessions...
          </p>
        </div>
      </div>
    )
  }

  // Show error state for list
  if (topicsError && !selectedTopicId) {
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
          <p className="mb-4 text-gray-700 dark:text-gray-300">{topicsError}</p>
          <button
            onClick={loadTopics}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  // Show detail view if topic is selected
  if (selectedTopicId) {
    // Show loading state for detail (when topic is loading or comments are loading)
    if (
      (commentsLoading && !selectedTopic) ||
      (commentsLoading && comments.length === 0 && !selectedTopic)
    ) {
      return (
        <div className="flex-1 flex flex-col h-full">
          {/* Header navigation */}
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center bg-gray-50 dark:bg-gray-800">
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

          <div className="flex-1 flex items-center justify-center dark:bg-gray-900">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400">
                Loading interview session...
              </p>
            </div>
          </div>
        </div>
      )
    }
    console.log("selectedTopic", selectedTopic)
    console.log("commentsError", commentsError)
    console.log("commentsLoading", commentsLoading)
    console.log("selectedTopicId", selectedTopicId)
    console.log("comments", comments)
    console.log("commentsLoading", commentsLoading)
    console.log("commentsError", commentsError)
    console.log("selectedTopicId", selectedTopicId)
    console.log("selectedTopic", selectedTopic)

    const timeAgo = new Date(
      selectedTopic?.timestamp ?? 0 * 1000
    ).toLocaleString()

    return (
      <div className="flex-1 flex flex-col h-full">
        {/* Header navigation */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center bg-gray-50 dark:bg-gray-800">
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
                  {selectedTopic?.title}
                </h1>

                {/* Topic meta info */}
                <div className="flex items-center justify-between mb-4 text-sm text-gray-600 dark:text-gray-400">
                  <div className="flex items-center space-x-3">
                    <span>by {selectedTopic?.owner_id}</span>
                    <span>•</span>
                    <span>{timeAgo}</span>
                    <span>•</span>
                    <div className="flex items-center space-x-1">
                      <svg
                        className="w-4 h-4 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                        />
                      </svg>
                      <span>Private</span>
                    </div>
                  </div>
                  <span>{totalComments} comments</span>
                </div>

                {/* Topic content */}
                <div className="mb-4">
                  <MarkdownRenderer content={selectedTopic?.content} />
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
                      <svg
                        className="w-5 h-5 text-red-500"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                    <span className="text-sm font-medium">
                      {pdfLoading ? "Loading..." : "View Resume (PDF)"}
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
                    topicId={selectedTopic?.topic_id}
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
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Modal Content */}
              <div className="h-[calc(100%-4rem)] overflow-hidden">
                {pdfError ? (
                  <div className="flex flex-col items-center justify-center h-full">
                    <div className="text-red-500 mb-4">
                      <svg
                        className="w-16 h-16 mx-auto"
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
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                      {pdfError}
                    </p>
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
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Loading resume...
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Show list view
  return (
    <div className="flex-1 flex flex-col h-full ">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Interview Sessions
          </h1>
          <p className="text-sm mt-1 text-gray-600 dark:text-gray-400">
            {topics.length} private interview session
            {topics.length !== 1 ? "s" : ""} available
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Create session button */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
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
            <span>New Interview Session</span>
          </button>
        </div>
      </div>

      {/* Interview session list */}
      <div className="flex-1 overflow-y-hidden py-6 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        {topics.length === 0 ? (
          <div className="text-center py-12 h-full flex flex-col items-center justify-center">
            <div className="mb-4 text-gray-500 dark:text-gray-400">
              <svg
                className="w-16 h-16 mx-auto"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium mb-2 text-gray-700 dark:text-gray-300">
              No interview sessions yet
            </h3>
            <p className="mb-4 text-gray-600 dark:text-gray-400">
              Create your first interview session with your resume!
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Create First Interview Session
            </button>
          </div>
        ) : (
          <div className="h-full px-6 overflow-y-auto space-y-4">
            {topics.map((topic) => (
              <InterviewTopicItem
                key={topic.topic_id}
                topic={topic}
                onClick={handleTopicClick}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create interview session modal */}
      <InterviewCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={(topicId) => {
          // Automatically navigate to the newly created topic
          console.log("DiscussionView: Topic created, navigating to:", topicId)
          setSelectedTopicId(topicId)
        }}
      />
    </div>
  )
}

export default DiscussionView
