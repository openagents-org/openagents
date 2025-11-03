import React, { useEffect, useMemo, useContext } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useInterviewStore } from "@/stores/interviewStore";
import { OpenAgentsContext } from "@/context/OpenAgentsProvider";

// Section Header Component
const SectionHeader: React.FC<{ title: string }> = React.memo(({ title }) => (
  <div className="px-5 my-3">
    <div className="flex items-center">
      <div className="text-xs font-bold text-gray-400 tracking-wide select-none">
        {title}
      </div>
      <div className="ml-2 h-px bg-gray-200 dark:bg-gray-700 flex-1"></div>
    </div>
  </div>
));
SectionHeader.displayName = "SectionHeader";

// Recent Interview Item Component
const RecentTopicItem: React.FC<{
  topic: {
    topic_id: string;
    title: string;
    comment_count: number;
    timestamp: number;
  };
  isActive: boolean;
  onClick: () => void;
}> = React.memo(({ topic, isActive, onClick }) => {
  // Format relative time
  const getRelativeTime = (timestamp: number) => {
    const now = Date.now() / 1000;
    const diff = now - timestamp;

    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return `${Math.floor(diff / 604800)}w ago`;
  };

  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full text-left text-sm px-2 py-2 font-medium rounded transition-colors
          ${
            isActive
              ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 border-l-2 border-indigo-500 dark:border-indigo-400 pl-2 shadow-sm"
              : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 pl-2.5"
          }
        `}
        title={topic.title}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-start min-w-0 flex-1">
            <div className="min-w-0 flex-1">
              <div className="flex items-center truncate font-medium overflow-hidden">
                <div className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {topic.title}
                </div>
              </div>
              <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400 mt-1">
                <span className="flex items-center space-x-1">
                  💬 {topic.comment_count}
                </span>
                <span>•</span>
                <span>{getRelativeTime(topic.timestamp)}</span>
              </div>
            </div>
          </div>
        </div>
      </button>
    </li>
  );
});
RecentTopicItem.displayName = "RecentTopicItem";

// Interview Sidebar Content Component
const InterviewSidebar: React.FC = () => {
  const context = useContext(OpenAgentsContext);
  const openAgentsService = context?.connector;
  const isConnected = context?.isConnected;
  const navigate = useNavigate();
  const location = useLocation();

  const { topics, groupsData, setConnection, loadTopics, getRecentTopics } =
    useInterviewStore();

  // Get recent topics (cached result)
  const recentTopics = useMemo(() => {
    const recent = getRecentTopics();
    console.log(
      "InterviewSidebar: Recent topics recalculated. Total topics:",
      topics.length,
      "Recent count:",
      recent.length,
      "groupsData:",
      groupsData
    );
    console.log(
      "InterviewSidebar: Recent topics:",
      recent.map((t) => ({
        id: t.topic_id,
        title: t.title,
        timestamp: t.timestamp,
      }))
    );
    return recent;
  }, [topics, getRecentTopics, groupsData]);

  // Check if currently on a topic detail page
  const currentTopicId = location.pathname.match(/^\/interview\/([^/]+)$/)?.[1];

  // Set connection
  useEffect(() => {
    if (openAgentsService) {
      setConnection(openAgentsService);
    }
  }, [openAgentsService, setConnection]);

  // Load topics (wait for connection to be established)
  useEffect(() => {
    if (openAgentsService && isConnected && topics.length === 0) {
      console.log("InterviewSidebar: Connection ready, loading topics");
      loadTopics();
    }
  }, [openAgentsService, isConnected, topics.length, loadTopics]);

  // Handle topic click
  const handleTopicClick = (topicId: string) => {
    console.log("InterviewSidebar: Navigating to topic:", topicId);
    navigate(`/interview/${topicId}`);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Recent Interviews Section */}
      <div className="flex-1 overflow-y-auto">
        <SectionHeader title="RECENT INTERVIEWS" />
        {recentTopics.length > 0 ? (
          <ul className="space-y-1 px-3">
            {recentTopics.map((topic) => (
              <RecentTopicItem
                key={topic.topic_id}
                topic={topic}
                isActive={currentTopicId === topic.topic_id}
                onClick={() => handleTopicClick(topic.topic_id)}
              />
            ))}
          </ul>
        ) : (
          <div className="px-5 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
            No interviews yet
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(InterviewSidebar);
