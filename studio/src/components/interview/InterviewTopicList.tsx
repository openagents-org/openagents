import React, { useState, useEffect, useContext } from "react";
import { useInterviewStore } from "@/stores/interviewStore";
import InterviewTopicItem from "./components/InterviewTopicItem";
import InterviewCreateModal from "./components/InterviewCreateModal";
import { OpenAgentsContext } from "@/context/OpenAgentsProvider";

const InterviewTopicList: React.FC = () => {
  const context = useContext(OpenAgentsContext);
  const openAgentsService = context?.connector;
  const [showCreateModal, setShowCreateModal] = useState(false);
  const isConnected = context?.isConnected;

  const {
    topics,
    topicsLoading,
    topicsError,
    setConnection,
    setGroupsData,
    setAgentId,
    loadTopics,
  } = useInterviewStore();

  // Set connection
  useEffect(() => {
    if (openAgentsService) {
      setConnection(openAgentsService);
    }
  }, [openAgentsService, setConnection]);

  // Initialize permission data
  useEffect(() => {
    const initializePermissions = async () => {
      if (!openAgentsService) return;

      try {
        // Get current agent ID
        const agentId = openAgentsService.getAgentId();
        if (agentId) {
          console.log("InterviewTopicList: Setting agentId:", agentId);
          setAgentId(agentId);
        }

        // Get groups data
        const healthData = await openAgentsService.getNetworkHealth();
        if (healthData && healthData.groups) {
          console.log("InterviewTopicList: Setting groupsData:", healthData.groups);
          setGroupsData(healthData.groups);
        }
      } catch (error) {
        console.error("InterviewTopicList: Failed to initialize permissions:", error);
      }
    };

    initializePermissions();
  }, [openAgentsService, setGroupsData, setAgentId]);

  // Load topics (wait for connection to be established)
  useEffect(() => {
    if (openAgentsService && isConnected) {
      console.log("InterviewTopicList: Connection ready, loading topics");
      loadTopics();
    }
  }, [openAgentsService, isConnected, loadTopics]);

  if (topicsLoading && topics.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading interview sessions...</p>
        </div>
      </div>
    );
  }

  if (topicsError) {
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
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full ">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Interview Sessions
          </h1>
          <p className="text-sm mt-1 text-gray-600 dark:text-gray-400">
            {topics.length} private interview session{topics.length !== 1 ? 's' : ''} available
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
              <InterviewTopicItem key={topic.topic_id} topic={topic} />
            ))}
          </div>
        )}
      </div>

      {/* Create interview session modal */}
      <InterviewCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </div>
  );
};

export default InterviewTopicList;
