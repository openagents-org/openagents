import React, { useEffect, useMemo, useContext } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useForumStore } from "@/stores/forumStore";
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

// Forum Category Item Component
// const ForumCategoryItem: React.FC<{
//   name: string;
//   isActive: boolean;
//   onClick: () => void;
// }> = React.memo(({ name, isActive, onClick }) => (
//   <li>
//     <button
//       onClick={onClick}
//       className={`w-full text-left text-sm truncate px-2 py-2 font-medium rounded transition-colors
//         ${
//           isActive
//             ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 border-l-2 border-indigo-500 dark:border-indigo-400 pl-2 shadow-sm"
//             : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 pl-2.5"
//         }
//       `}
//       title={name}
//     >
//       <div className="flex items-center min-w-0">
//         <span className="mr-2 text-gray-400">💬</span>
//         <span className="truncate">{name}</span>
//       </div>
//     </button>
//   </li>
// ));
// ForumCategoryItem.displayName = "ForumCategoryItem";

// Popular Topic Item Component
const PopularTopicItem: React.FC<{
  topic: {
    topic_id: string;
    title: string;
    upvotes: number;
    downvotes: number;
    comment_count: number;
  };
  isActive: boolean;
  onClick: () => void;
}> = React.memo(({ topic, isActive, onClick }) => {
  const totalVotes = topic.upvotes + topic.downvotes;

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
                <span className="mr-2 text-gray-400">🔥</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {totalVotes}
                </span>
              </div>
              {/* <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400 mt-1">
                <span className="flex items-center space-x-1">💬{topic.comment_count}</span>
              </div> */}
            </div>
          </div>
        </div>
      </button>
    </li>
  );
});
PopularTopicItem.displayName = "PopularTopicItem";

// Forum Sidebar Content Component
const ForumSidebar: React.FC = () => {
  const context = useContext(OpenAgentsContext);
  const openAgentsService = context?.connector;
  const isConnected = context?.isConnected;
  const navigate = useNavigate();
  const location = useLocation();

  const {
    topics,
    groupsData,
    setConnection,
    loadTopics,
    getPopularTopics,
    setupEventListeners,
    cleanupEventListeners,
  } = useForumStore();

  // Get hot topics (cached calculation result)
  const popularTopics = useMemo(() => {
    const popular = getPopularTopics();
    console.log(
      "ForumSidebar: Popular topics recalculated. Total topics:",
      topics.length,
      "Popular count:",
      popular.length,
      "groupsData:",
      groupsData
    );
    console.log(
      "ForumSidebar: Popular topics:",
      popular.map((t) => ({
        id: t.topic_id,
        title: t.title,
        score: t.upvotes - t.downvotes,
      }))
    );
    return popular;
  }, [topics, getPopularTopics, groupsData]);

  // Check if currently on a topic detail page
  const currentTopicId = location.pathname.match(/^\/forum\/([^/]+)$/)?.[1];

  // Set connection
  useEffect(() => {
    if (openAgentsService) {
      setConnection(openAgentsService);
    }
  }, [openAgentsService, setConnection]);

  // Load topics (wait for connection to be established)
  useEffect(() => {
    if (openAgentsService && isConnected && topics.length === 0) {
      console.log("ForumSidebar: Connection ready, loading topics");
      loadTopics();
    }
  }, [openAgentsService, isConnected, loadTopics, topics.length]);

  // Set up forum event listeners
  useEffect(() => {
    if (openAgentsService) {
      console.log("ForumSidebar: Setting up forum event listeners");
      setupEventListeners();

      return () => {
        console.log("ForumSidebar: Cleaning up forum event listeners");
        cleanupEventListeners();
      };
    }
  }, [openAgentsService, setupEventListeners, cleanupEventListeners]);

  // // Category data (static)
  // const forumCategories = [
  //   { name: "General Discussion", id: "general" },
  //   { name: "Q&A", id: "qa" },
  //   { name: "Feature Requests", id: "features" },
  //   { name: "Bug Reports", id: "bugs" },
  // ];

  // // Category selection handling
  // const onCategorySelect = (categoryId: string) => {
  //   // Navigate to forum list page (can add category filter in future)
  //   navigate('/forum');
  // };

  // Topic selection handling
  const onTopicSelect = (topicId: string) => {
    navigate(`/forum/${topicId}`);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Forum Categories Section */}
      {/* <SectionHeader title="CATEGORIES" />
      <div className="px-3">
        <ul className="flex flex-col gap-1">
          {forumCategories.map((category) => (
            <ForumCategoryItem
              key={category.id}
              name={category.name}
              isActive={false} // Category filtering not supported yet, so none are highlighted
              onClick={() => onCategorySelect(category.id)}
            />
          ))}
        </ul>
      </div> */}

      {/* Popular Topics Section */}
      <SectionHeader title="POPULAR 10 TOPICS" />
      <div className="flex-1 overflow-y-auto px-3 custom-scrollbar">
        {!groupsData ? (
          <div className="text-center py-4">
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Loading...
            </p>
          </div>
        ) : popularTopics.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              No topics yet
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {popularTopics.map((topic) => (
              <PopularTopicItem
                key={topic.topic_id}
                topic={topic}
                isActive={currentTopicId === topic.topic_id}
                onClick={() => onTopicSelect(topic.topic_id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default React.memo(ForumSidebar);
