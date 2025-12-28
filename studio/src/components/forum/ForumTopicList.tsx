import React, { useState, useEffect, useContext } from "react";
import { useTranslation } from "react-i18next";
import { useForumStore } from "@/stores/forumStore";
import ForumTopicItem from "./components/ForumTopicItem";
import ForumCreateModal from "./components/ForumCreateModal";
import { OpenAgentsContext } from "@/context/OpenAgentsProvider";

const ForumTopicList: React.FC = () => {
  const { t } = useTranslation('forum');
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
    setupEventListeners,
    cleanupEventListeners,
  } = useForumStore();

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
          console.log("ForumTopicList: Setting agentId:", agentId);
          setAgentId(agentId);
        }

        // Get groups data
        const healthData = await openAgentsService.getNetworkHealth();
        if (healthData && healthData.groups) {
          console.log("ForumTopicList: Setting groupsData:", healthData.groups);
          setGroupsData(healthData.groups);
        }
      } catch (error) {
        console.error("ForumTopicList: Failed to initialize permissions:", error);
      }
    };

    initializePermissions();
  }, [openAgentsService, setGroupsData, setAgentId]);

  // Load topics (wait for connection to be established)
  useEffect(() => {
    if (openAgentsService && isConnected) {
      console.log("ForumTopicList: Connection ready, loading topics");
      loadTopics();
    }
  }, [openAgentsService, isConnected, loadTopics]);

  // Set up forum event listeners
  useEffect(() => {
    if (openAgentsService) {
      console.log("ForumTopicList: Setting up forum event listeners");
      setupEventListeners();

      return () => {
        console.log("ForumTopicList: Cleaning up forum event listeners");
        cleanupEventListeners();
      };
    }
  }, [openAgentsService, setupEventListeners, cleanupEventListeners]);

  if (topicsLoading && topics.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-gray-800">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">{t('list.loading')}</p>
        </div>
      </div>
    );
  }

  if (topicsError) {
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
          <p className="mb-4 text-gray-700 dark:text-gray-300">{topicsError}</p>
          <button
            onClick={loadTopics}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            {t('list.tryAgain')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-gray-800">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-white dark:bg-gray-800">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('list.title')}
          </h1>
          <p className="text-sm mt-1 text-gray-600 dark:text-gray-400">
            {t('list.topicsAvailable', { count: topics.length })}
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Create topic button */}
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
            <span>{t('list.newTopic')}</span>
          </button>
        </div>
      </div>

      {/* Topic list */}
      <div className="flex-1 overflow-y-hidden py-6 dark:border-gray-700 bg-white dark:bg-gray-800">
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
                  d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium mb-2 text-gray-700 dark:text-gray-300">
              {t('list.noTopics')}
            </h3>
            <p className="mb-4 text-gray-600 dark:text-gray-400">
              {t('list.createFirst')}
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              {t('list.createFirstButton')}
            </button>
          </div>
        ) : (
          <div className="h-full px-6 overflow-y-auto space-y-4">
            {topics.map((topic) => (
              <ForumTopicItem key={topic.topic_id} topic={topic} />
            ))}
          </div>
        )}
      </div>

      {/* Create topic modal */}
      <ForumCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </div>
  );
};

export default ForumTopicList;
